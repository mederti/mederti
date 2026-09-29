import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// 10-min cache. The underlying table is only updated by scrapers every 4h+, so
// a fresh recompute per request would be wasted work. Each query-string
// variant (country × drug × range) caches separately.
export const revalidate = 600;
export const maxDuration = 60;

/**
 * GET /api/insights/shortage-trends?country=AU&range=1Y
 * GET /api/insights/shortage-trends?drug_id=<uuid>&range=MAX
 *
 * A time series of how shortages have changed and what is coming, for one
 * market, ALL markets, or one drug (across every market):
 *
 *   - onsets      new shortages that STARTED in the period (declared history)
 *   - resolved    shortages that ENDED in the period
 *   - active      shortages open at the period end (reconstructed stock)
 *   - anticipated shortages regulators have flagged to START in the period,
 *                 FUTURE periods only (status='anticipated', a real forward
 *                 signal — not a statistical projection)
 *
 * `range` works like a stock chart's range selector: 1M, 3M, 6M, YTD, 1Y, 3Y,
 * 5Y, MAX. The bucket size follows the range so bar counts stay readable —
 * weekly up to 3M, monthly up to 3Y, quarterly for 5Y/MAX. Legacy `months=` /
 * `forward=` params still work (monthly grain).
 *
 * Past periods carry onsets/resolved/active; future periods carry anticipated.
 * Everything left of "now" is observed history, everything to the right is
 * regulator-published anticipated onsets.
 *
 * Aggregation happens here rather than in the shortage_trends_monthly RPC
 * (migration 065): that function's per-month correlated subqueries hit the
 * statement timeout once shortage_events passed ~100k rows, even for 18
 * months. Scoped fetches (country / drug) are index scans; the ALL-markets
 * path drains in parallel pages.
 */

type Grain = "week" | "month" | "quarter";
type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "MAX";
const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"];

type Ev = {
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  anticipated_start_date: string | null;
};

interface Bucket {
  month: string; // period key: YYYY-MM-DD of the period's first day
  label: string;
  future: boolean;
  current: boolean;
  onsets: number | null;
  resolved: number | null;
  active: number | null;
  anticipated: number | null;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Earliest period MAX shows for market views. A handful of stray pre-2010 rows
// would otherwise stretch the axis over a decade of empty bars.
const MAX_FLOOR = "2010-01-01";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m, day));

// First day of the period containing `d`.
function periodStart(d: Date, grain: Grain): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (grain === "month") return utc(y, m);
  if (grain === "quarter") return utc(y, m - (m % 3));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return utc(y, m, d.getUTCDate() - dow);
}

function addPeriods(d: Date, grain: Grain, n: number): Date {
  if (grain === "week") return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7 * n);
  return utc(d.getUTCFullYear(), d.getUTCMonth() + (grain === "quarter" ? 3 * n : n));
}

function periodLabel(d: Date, grain: Grain, curYear: number): string {
  const y = d.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (grain === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${yy}`;
  if (grain === "week") return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;
  const m = MONTH_ABBR[d.getUTCMonth()];
  return d.getUTCMonth() === 0 || y !== curYear ? `${m} ${yy}` : m;
}

// Count of sorted values ≤ x (ISO date strings compare correctly as strings).
function countLE(sorted: string[], x: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function resolveWindow(url: URL, now: Date): { range: Range | null; grain: Grain; from: Date | "max"; forward: number } {
  const r = (url.searchParams.get("range") ?? "").toUpperCase() as Range;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (r) {
    case "1M": return { range: r, grain: "week", from: utc(y, m - 1, d), forward: 4 };
    case "3M": return { range: r, grain: "week", from: utc(y, m - 3, d), forward: 8 };
    case "6M": return { range: r, grain: "month", from: utc(y, m - 5), forward: 3 };
    case "YTD": return { range: r, grain: "month", from: utc(y, 0), forward: 6 };
    case "1Y": return { range: r, grain: "month", from: utc(y, m - 11), forward: 6 };
    case "3Y": return { range: r, grain: "month", from: utc(y, m - 35), forward: 6 };
    case "5Y": return { range: r, grain: "quarter", from: utc(y - 5, m + 3), forward: 2 };
    case "MAX": return { range: r, grain: "quarter", from: "max", forward: 2 };
  }
  // Legacy: months back (monthly grain) + forward months.
  const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? "12") || 12, 3), 36);
  const forward = Math.min(Math.max(Number(url.searchParams.get("forward") ?? "6") || 0, 0), 12);
  return { range: null, grain: "month", from: utc(y, m - (months - 1)), forward };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const drugId = url.searchParams.get("drug_id");
  const country = (url.searchParams.get("country") ?? (drugId ? "ALL" : "AU")).toUpperCase();
  const allMarkets = country === "ALL" || country === "GLOBAL";
  const now = new Date();
  const today = iso(now);
  const { range, grain, from, forward } = resolveWindow(url, now);
  const meta = { country, drug_id: drugId, all_markets: allMarkets, generated: today, range, grain };

  const sb = getSupabaseAdmin();

  // ── Fetch the event rows for this scope ──
  // Ordered by id so parallel pages never overlap or skip. Synthetic
  // (recall-derived) rows are excluded — they are not regulator-declared
  // shortages.
  const cols = "status, start_date, end_date, anticipated_start_date";
  const scoped = (withCount = false) => {
    let q = sb
      .from("shortage_events")
      .select(cols, withCount ? { count: "exact" } : undefined)
      .eq("synthetic", false);
    if (drugId) q = q.eq("drug_id", drugId);
    if (!allMarkets) q = q.eq("country_code", country);
    return q.order("id", { ascending: true });
  };

  const PAGE = 1000;
  const CONCURRENCY = 8;
  const MAX_PAGES = 200; // 200k-row safety cap (table is ~100k)
  const events: Ev[] = [];
  let partial = false;

  const first = await scoped(true).range(0, PAGE - 1);
  if (first.error) {
    return NextResponse.json({ ...meta, degraded: true, months: [] });
  }
  events.push(...((first.data ?? []) as Ev[]));
  const needed = Math.ceil((first.count ?? events.length) / PAGE);
  const pages = Math.min(needed, MAX_PAGES);
  if (needed > pages) partial = true;

  for (let p = 1; p < pages; p += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pages - p) }, (_, i) =>
        scoped().range((p + i) * PAGE, (p + i) * PAGE + PAGE - 1),
      ),
    );
    for (const r of batch) {
      if (r.error) partial = true; // keep going; partial history still charts
      else events.push(...((r.data ?? []) as Ev[]));
    }
  }

  // ── Aggregate ──
  // Active at a period end = (# started on/before it) − (# ended on/before
  // it), via binary search over sorted start / end dates. End is clamped ≥
  // start so a malformed row can't make "active" negative.
  const observed = events.filter((e) => e.status !== "anticipated" && e.start_date);
  const starts = observed.map((e) => e.start_date!.slice(0, 10)).sort();
  const ends = observed
    .filter((e) => e.end_date)
    .map((e) => {
      const s = e.start_date!.slice(0, 10);
      const en = e.end_date!.slice(0, 10);
      return en < s ? s : en;
    })
    .sort();

  let fromDate: Date;
  if (from === "max") {
    const earliest = starts[0] ?? today;
    // Drug views show their full history; market views floor at MAX_FLOOR.
    const floored = !drugId && earliest < MAX_FLOOR ? MAX_FLOOR : earliest;
    fromDate = new Date(`${floored}T00:00:00Z`);
  } else {
    fromDate = from;
  }

  const buckets: Bucket[] = [];
  const index = new Map<string, number>();
  const curStart = periodStart(now, grain);
  for (let p = periodStart(fromDate, grain); p <= curStart; p = addPeriods(p, grain, 1)) {
    const key = iso(p);
    index.set(key, buckets.length);
    // Period end = day before the next period starts; for the current period
    // it's today, so we don't count as active anything starting later.
    const isCurrent = p.getTime() === curStart.getTime();
    const endKey = isCurrent ? today : iso(new Date(addPeriods(p, grain, 1).getTime() - 86400000));
    buckets.push({
      month: key,
      label: periodLabel(p, grain, now.getUTCFullYear()),
      future: false,
      current: isCurrent,
      onsets: 0,
      resolved: 0,
      active: countLE(starts, endKey) - countLE(ends, endKey),
      anticipated: null,
    });
  }
  for (let i = 1; i <= forward; i++) {
    const p = addPeriods(curStart, grain, i);
    const key = iso(p);
    index.set(key, buckets.length);
    buckets.push({
      month: key,
      label: periodLabel(p, grain, now.getUTCFullYear()),
      future: true,
      current: false,
      onsets: null,
      resolved: null,
      active: null,
      anticipated: 0,
    });
  }

  const bucketOf = (date: string) =>
    index.get(iso(periodStart(new Date(`${date.slice(0, 10)}T00:00:00Z`), grain)));

  for (const e of events) {
    if (e.status === "anticipated") {
      if (!e.anticipated_start_date) continue;
      const i = bucketOf(e.anticipated_start_date);
      if (i != null && buckets[i].future) buckets[i].anticipated = (buckets[i].anticipated ?? 0) + 1;
      continue; // anticipated rows don't contribute to observed history
    }
    if (e.start_date) {
      const i = bucketOf(e.start_date);
      if (i != null && !buckets[i].future) buckets[i].onsets = (buckets[i].onsets ?? 0) + 1;
    }
    if (e.end_date && e.end_date.slice(0, 10) <= today) {
      const i = bucketOf(e.end_date);
      if (i != null && !buckets[i].future) buckets[i].resolved = (buckets[i].resolved ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ...meta,
    window: { past_periods: buckets.length - forward, forward_periods: forward },
    degraded: false,
    partial,
    source: "drain",
    months: buckets,
  });
}
