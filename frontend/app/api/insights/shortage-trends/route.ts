import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// 10-min cache. Aggregates the full per-country shortage_events history into a
// monthly time series; the underlying table is only updated by scrapers every
// 4h+, so a fresh recompute per request would be wasted work. Each ?country
// variant caches separately (mirrors /api/predictive-signals). For the all-
// markets path (country=ALL) the row set is ~30k, so the cache matters more.
export const revalidate = 600;

/**
 * GET /api/insights/shortage-trends?country=AU&months=12&forward=6
 *
 * Returns a monthly time series of how shortages have changed over time and
 * what is coming, for one market (or ALL markets):
 *
 *   - onsets      new shortages that STARTED that month (declared history)
 *   - resolved    shortages that ENDED that month
 *   - active      shortages open at that month-end (reconstructed stock)
 *   - anticipated shortages regulators have flagged to START that month, for
 *                 FUTURE months only (status='anticipated', a real forward
 *                 signal — not a statistical projection)
 *
 * Past months carry onsets/resolved/active; future months carry anticipated.
 * This is the honest split: everything left of "now" is observed history,
 * everything to the right is regulator-published anticipated onsets.
 */

type Ev = {
  country_code: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  anticipated_start_date: string | null;
};

// One row per month from the shortage_trends_monthly() Postgres function.
type RpcRow = {
  month: string; // date (YYYY-MM-DD, first of month)
  onsets: number;
  resolved: number;
  active: number;
  anticipated: number;
};

interface MonthBucket {
  month: string; // YYYY-MM
  label: string; // e.g. "Aug" / "Jan '26"
  future: boolean;
  current: boolean;
  onsets: number | null;
  resolved: number | null;
  active: number | null;
  anticipated: number | null;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Zero-padded YYYY-MM for a given UTC year/month (month is 0-indexed).
function ym(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// Last calendar day of a month as a YYYY-MM-DD string. DATE columns are stored
// as YYYY-MM-DD, so string comparison against this is a correct date compare.
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month + 1, 0)); // day 0 of next month = last day
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") ?? "AU").toUpperCase();
  const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? "12"), 3), 36);
  const forward = Math.min(Math.max(Number(url.searchParams.get("forward") ?? "6"), 0), 12);
  const allMarkets = country === "ALL" || country === "GLOBAL";

  const sb = getSupabaseAdmin();

  // Build the month axis first: `months` past-through-current, then `forward`
  // future. Both the fast (in-DB) and fallback (drain) paths fill these buckets.
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth();
  const buckets: MonthBucket[] = [];
  const indexByMonth = new Map<string, number>();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(curY, curM - i, 1));
    const key = ym(d.getUTCFullYear(), d.getUTCMonth());
    indexByMonth.set(key, buckets.length);
    buckets.push({
      month: key,
      label: monthLabel(d, curY),
      future: false,
      current: i === 0,
      onsets: 0,
      resolved: 0,
      active: 0,
      anticipated: null,
    });
  }
  for (let i = 1; i <= forward; i++) {
    const d = new Date(Date.UTC(curY, curM + i, 1));
    const key = ym(d.getUTCFullYear(), d.getUTCMonth());
    indexByMonth.set(key, buckets.length);
    buckets.push({
      month: key,
      label: monthLabel(d, curY),
      future: true,
      current: false,
      onsets: null,
      resolved: null,
      active: null,
      anticipated: 0,
    });
  }

  const jsonMeta = {
    country,
    all_markets: allMarkets,
    generated: now.toISOString().slice(0, 10),
    window: { past_months: months, forward_months: forward },
  };
  const fromDate = `${buckets[0].month}-01`;
  const [ly, lm] = buckets[buckets.length - 1].month.split("-").map(Number);
  const toDate = lastDayOfMonth(ly, lm - 1);

  // ── Fast path: aggregate in Postgres via the shortage_trends_monthly RPC ──
  // One indexed scan returns ~18 rows instead of shipping ~30k to Node. Falls
  // through to the drain below if the function isn't applied yet (migration
  // 065) or errors.
  const rpc = await sb.rpc("shortage_trends_monthly", {
    p_country: allMarkets ? "ALL" : country,
    p_from: fromDate,
    p_to: toDate,
  });
  if (!rpc.error && Array.isArray(rpc.data)) {
    const byMonth = new Map<string, RpcRow>(
      (rpc.data as RpcRow[]).map((r) => [String(r.month).slice(0, 7), r]),
    );
    for (const b of buckets) {
      const r = byMonth.get(b.month);
      if (b.future) {
        b.anticipated = r ? Number(r.anticipated) : 0;
      } else {
        b.onsets = r ? Number(r.onsets) : 0;
        b.resolved = r ? Number(r.resolved) : 0;
        b.active = r ? Number(r.active) : 0;
      }
    }
    return NextResponse.json({ ...jsonMeta, degraded: false, partial: false, source: "rpc", months: buckets });
  }

  // ── Fallback: drain the table and aggregate in JS ──
  // Used until the RPC is applied. Two constraints (see the disk-IO / index-
  // drift incident notes): (1) NEVER filter by country_code — it is not
  // usefully indexed, so a WHERE country_code = … forces a full seq scan that
  // hits the statement timeout (57014); we drain UNFILTERED and filter in JS.
  // (2) Tolerate a mid-drain timeout: partial data still charts, and a drain
  // that yields nothing degrades gracefully rather than showing false zeros.
  const PAGE = 1000;
  const MAX_PAGES = 60; // safety cap (60k rows) — well above the ~30k table
  const events: Ev[] = [];
  const cols = "country_code, status, start_date, end_date, anticipated_start_date";
  let drainError = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("shortage_events")
      .select(cols)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      drainError = true;
      break; // keep whatever we already have; partial history still charts
    }
    if (!data || data.length === 0) break;
    events.push(...(data as Ev[]));
    if (data.length < PAGE) break;
  }

  if (events.length === 0 && drainError) {
    return NextResponse.json({ ...jsonMeta, degraded: true, months: [] }, { status: 200 });
  }

  // Precompute each past month-end cutoff for the active-stock reconstruction.
  const monthEndCutoff = buckets
    .filter((b) => !b.future)
    .map((b) => {
      const [y, m] = b.month.split("-").map(Number);
      // Current month's "end" is today, so we don't count as active anything
      // that will only start later this month.
      const isCurrent = y === curY && m - 1 === curM;
      return { idx: indexByMonth.get(b.month)!, cutoff: isCurrent ? now.toISOString().slice(0, 10) : lastDayOfMonth(y, m - 1) };
    });

  for (const e of events) {
    if (!allMarkets && e.country_code !== country) continue; // country filtered in JS, not SQL
    const isAnticipated = e.status === "anticipated";

    // Future anticipated onsets — the forward signal.
    if (isAnticipated && e.anticipated_start_date) {
      const key = e.anticipated_start_date.slice(0, 7);
      const idx = indexByMonth.get(key);
      if (idx != null && buckets[idx].future) {
        buckets[idx].anticipated = (buckets[idx].anticipated ?? 0) + 1;
      }
      continue; // anticipated rows don't contribute to observed history
    }

    // Onsets — new shortages that started in a tracked past month.
    if (e.start_date) {
      const idx = indexByMonth.get(e.start_date.slice(0, 7));
      if (idx != null && !buckets[idx].future) {
        buckets[idx].onsets = (buckets[idx].onsets ?? 0) + 1;
      }
    }
    // Resolutions — shortages that ended in a tracked past month.
    if (e.end_date) {
      const idx = indexByMonth.get(e.end_date.slice(0, 7));
      if (idx != null && !buckets[idx].future) {
        buckets[idx].resolved = (buckets[idx].resolved ?? 0) + 1;
      }
    }
    // Active stock — open at each past month-end (start ≤ cutoff, not yet ended).
    if (e.start_date) {
      for (const { idx, cutoff } of monthEndCutoff) {
        if (e.start_date <= cutoff && (!e.end_date || e.end_date > cutoff)) {
          buckets[idx].active = (buckets[idx].active ?? 0) + 1;
        }
      }
    }
  }

  return NextResponse.json({
    ...jsonMeta,
    degraded: false,
    partial: drainError, // some pages timed out; series is built from what drained
    source: "drain",
    months: buckets,
  });
}

// Short month label; disambiguate January (or any month in a non-current year)
// with a two-digit year so a 12-month window reading across a year boundary is
// unambiguous.
function monthLabel(d: Date, curYear: number): string {
  const m = MONTH_ABBR[d.getUTCMonth()];
  const y = d.getUTCFullYear();
  return d.getUTCMonth() === 0 || y !== curYear ? `${m} '${String(y).slice(2)}` : m;
}
