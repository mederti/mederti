import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { forecastPrice } from "@/lib/forecast/holt";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// 1-hour cache: prices update at most weekly/monthly, and the fit is a little
// CPU (grid-search × rolling backtest), so recomputing per request is wasted.
// Each ?drug_id×?country variant caches separately.
export const revalidate = 3600;

/**
 * GET /api/insights/price-trends?drug_id=<uuid>&country=GB&months=24&forward=6
 *
 * Builds ONE consistent monthly price series for a drug in a market and, when
 * the series clears an honesty gate, a Holt forecast with an 80% prediction
 * interval. The whole point is defensibility:
 *
 *  - Series pick: drug_pricing_history is a molecule rollup mixing strengths,
 *    packs and price bases, so a naive per-month average is noise. We pick the
 *    single strength with the most month-coverage (the representative SKU),
 *    prefer a consistent pack-price basis, and take the monthly median.
 *  - Regularisation: reimbursement prices are step functions — a price holds
 *    until it's amended. So we forward-fill gaps between observations rather
 *    than interpolating (which would invent intermediate movements).
 *  - Forecast gate: rendered only when there's enough real history AND a
 *    rolling backtest shows the model actually predicts this series (see
 *    lib/forecast/holt.ts). Otherwise we return history alone.
 *
 * Everything left of "now" is observed price history; the forecast block, when
 * present, is an explicit statistical projection with a stated backtest error.
 */

type Row = {
  country: string | null;
  price_type: string | null;
  category: string | null;
  pack_price: number | null;
  unit_price: number | null;
  currency: string | null;
  pack_description: string | null;
  product_name: string | null;
  effective_date: string | null;
  source: string | null;
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PRICE_TYPE_LABEL: Record<string, string> = {
  drug_tariff: "Reimbursement (Drug Tariff)", reimbursement: "Reimbursement",
  retail_public: "Retail price", pharmacy_purchase: "Acquisition cost",
  list: "List price", wholesale: "Wholesale", ex_factory: "Ex-factory",
  amp: "AMP", wac: "WAC", reference_price: "Reference price", concession: "Concession",
};

/** Normalised strength token ("...20mg tablets" → "20mg"). */
function strengthOf(label: string | null | undefined): string | null {
  const m = (label ?? "").match(/(\d+(?:\.\d+)?)\s?(mg|mcg|microgram|micrograms|g|ml|%|units?|iu)/i);
  return m ? `${m[1]}${m[2]}`.toLowerCase().replace("micrograms", "mcg").replace("microgram", "mcg") : null;
}

function monthLabel(key: string, curYear: number): string {
  const [y, m] = key.split("-").map(Number);
  const abbr = MONTH_ABBR[m - 1];
  return m === 1 || y !== curYear ? `${abbr} '${String(y).slice(2)}` : abbr;
}
/** All month keys from `from` to `to` inclusive (YYYY-MM). */
function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "strict");
  if (limited) return limited;

  const url = new URL(req.url);
  const drugId = url.searchParams.get("drug_id") ?? "";
  const country = (url.searchParams.get("country") ?? "GB").toUpperCase();
  // Coerce defensively: Number("abc")→NaN would propagate through the clamps to
  // segMonths[NaN]→undefined and crash monthRange(undefined) with a 500. Round
  // so fractional values (?months=10.5) can't produce a fractional index.
  const rawMonths = Number(url.searchParams.get("months") ?? "24");
  const displayMonths = Number.isFinite(rawMonths) ? Math.min(Math.max(Math.round(rawMonths), 6), 60) : 24;
  const rawForward = Number(url.searchParams.get("forward") ?? "6");
  const forward = Number.isFinite(rawForward) ? Math.min(Math.max(Math.round(rawForward), 1), 12) : 6;

  const empty = (reason: string) =>
    NextResponse.json({ drug_id: drugId, country, available: false, reason, history: [], forecast: null, concessions: [] });

  if (!/^[0-9a-f-]{36}$/i.test(drugId)) return empty("invalid drug_id");

  const sb = getSupabaseAdmin();

  // Match buildMarketPricing: drug_id plus a filter-safe generic_name fallback,
  // so canonical + variant-spelled price rows both come in.
  let genericName = "";
  try {
    const { data } = await sb.from("drugs").select("generic_name").eq("id", drugId).single();
    genericName = (data?.generic_name ?? "").trim();
  } catch { /* no drug row — drug_id-only filter still works */ }
  const innSafe = genericName && /^[a-z0-9 .\-/]+$/i.test(genericName) ? genericName : "";

  // Two-step fetch. A single `or(drug_id.eq…, generic_name.ilike…)` filter
  // can't use any index once the table is large (post NADAC backfill: ~500k
  // US rows) and dies on the Postgres statement timeout (57014) — which
  // supabase-js surfaces as a soft `error`, NOT a throw, so it silently reads
  // as "no rows". So: (1) query by drug_id (indexed) and treat an error as
  // unreachable-not-empty; (2) only when that finds nothing, best-effort name
  // fallback for rows that never resolved to a drug_id (unlinked-variant
  // case), tolerating a timeout as "no extra rows". Migration 067 (trigram
  // index on generic_name) makes the fallback fast once applied.
  const COLS = "country, price_type, category, pack_price, unit_price, currency, pack_description, product_name, effective_date, source";
  let rows: Row[] = [];
  {
    // Order DESCENDING then reverse in memory: high-volume markets (post-NADAC
    // ~500k US rows, and the ~1000-row PostgREST response cap) overflow the
    // limit, and ascending+limit would keep the OLDEST rows — dropping recent
    // prices, showing a stale "latest", and falsely tripping the recency gate.
    const { data, error } = await sb
      .from("drug_pricing_history")
      .select(COLS)
      .eq("drug_id", drugId)
      .eq("country", country)
      .not("effective_date", "is", null)
      .order("effective_date", { ascending: false })
      .limit(4000);
    if (error) return empty("pricing layer unreachable");
    rows = ((data ?? []) as Row[]).reverse();
  }
  if (rows.length === 0 && innSafe) {
    const { data } = await sb
      .from("drug_pricing_history")
      .select(COLS)
      .ilike("generic_name", innSafe)
      .eq("country", country)
      .not("effective_date", "is", null)
      .order("effective_date", { ascending: false })
      .limit(4000);
    rows = ((data ?? []) as Row[]).reverse(); // error here (likely 57014) → just no fallback rows
  }
  if (rows.length === 0) return empty("no price history for this market");

  // ── Pick the representative series ──────────────────────────────────────
  // Group priceable rows by strength; keep the strength with the most distinct
  // months. Prefer pack_price as the basis — it's consistently populated and
  // comparable; fall back to unit_price only for a strength that never has one.
  type PriceRow = Row & { strength: string; month: string; basisPack: boolean };
  const priceable: PriceRow[] = [];
  for (const r of rows) {
    if (r.price_type === "concession") continue; // concessions handled as overlay
    const strength = strengthOf(r.product_name) ?? "(unspecified)";
    const month = (r.effective_date ?? "").slice(0, 7);
    if (!month) continue;
    const hasPack = r.pack_price != null;
    const hasUnit = r.unit_price != null;
    if (!hasPack && !hasUnit) continue;
    priceable.push({ ...r, strength, month, basisPack: hasPack });
  }
  if (priceable.length === 0) return empty("no priceable rows");

  const byStrength = new Map<string, PriceRow[]>();
  for (const r of priceable) {
    const arr = byStrength.get(r.strength) ?? [];
    arr.push(r);
    byStrength.set(r.strength, arr);
  }
  let chosenStrength = "";
  let chosenRows: PriceRow[] = [];
  let bestMonths = -1;
  for (const [strength, arr] of byStrength) {
    const months = new Set(arr.map((r) => r.month)).size;
    if (months > bestMonths) { bestMonths = months; chosenStrength = strength; chosenRows = arr; }
  }

  // Lock to ONE category basis. drug_pricing_history mixes "Cat M" (the true
  // quarterly reimbursement baseline) with "VIIIA in-month amendment" prices —
  // two different price concepts. A month-to-month series that flips between
  // them fabricates jumps (and a spurious forecast trend). Keep the category
  // with the most month-coverage for this strength; the other is dropped.
  const catKey = (c: string | null): string => ((c ?? "").toLowerCase().includes("cat m") ? "cat_m" : "amendment");
  const byCat = new Map<string, PriceRow[]>();
  for (const r of chosenRows) {
    const k = catKey(r.category);
    (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(r);
  }
  // Among the strength's categories, restrict to those that are RECENT (latest
  // observation within ~12 months of the freshest data we hold), then take the
  // best-covered of those. This avoids two failure modes: locking to a stale
  // long series when fresher data exists (would show months-old history), and
  // locking to a fresh-but-tiny series when a rich recent one exists.
  const strengthLatest = chosenRows.reduce((a, r) => (r.month > a ? r.month : a), "");
  const [oy, om] = strengthLatest.split("-").map(Number);
  let cy2 = oy, cm2 = om - 12;
  while (cm2 <= 0) { cm2 += 12; cy2--; }
  const recencyCutoff = `${cy2}-${String(cm2).padStart(2, "0")}`;
  const catEntries = [...byCat.values()].map((arr) => ({
    arr,
    months: new Set(arr.map((r) => r.month)).size,
    latest: arr.reduce((a, r) => (r.month > a ? r.month : a), ""),
  }));
  const recent = catEntries.filter((e) => e.latest >= recencyCutoff);
  const pool = recent.length > 0 ? recent : catEntries;
  chosenRows = pool.reduce((best, e) => (e.months > best.months ? e : best)).arr;

  // Basis: pack price if the chosen strength predominantly carries it, else unit.
  const packShare = chosenRows.filter((r) => r.basisPack).length / chosenRows.length;
  const usePack = packShare >= 0.5;
  const valueOf = (r: PriceRow): number | null =>
    usePack ? (r.pack_price != null ? Number(r.pack_price) : null)
            : (r.unit_price != null ? Number(r.unit_price) : null);

  // Monthly median for the chosen strength+basis.
  const monthVals = new Map<string, number[]>();
  let currency = "";
  let priceType = "";
  const perParts = new Set<string>();
  for (const r of chosenRows) {
    const v = valueOf(r);
    if (v == null) continue;
    (monthVals.get(r.month) ?? monthVals.set(r.month, []).get(r.month)!).push(v);
    currency ||= r.currency ?? "";
    priceType ||= r.price_type ?? "";
    if (r.pack_description) perParts.add(r.pack_description);
  }
  const observedMonths = [...monthVals.keys()].sort();
  if (observedMonths.length === 0) return empty("no priced months");

  // Restrict to the latest CONTIGUOUS segment. Reimbursement prices are a step
  // function we forward-fill between amendments — but only across small gaps.
  // A long gap (here >3 months) means we lost the thread entirely; filling it
  // would invent a flat plateau that both misrepresents history AND games the
  // backtest (a fake-flat run is trivially "predictable"). So we walk back from
  // the latest observation and cut the series where a gap exceeds MAX_GAP.
  const MAX_GAP = 3;
  const monthDiff = (a: string, b: string): number => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  };
  let segmentStart = observedMonths[observedMonths.length - 1];
  for (let i = observedMonths.length - 2; i >= 0; i--) {
    if (monthDiff(observedMonths[i], segmentStart) <= MAX_GAP) segmentStart = observedMonths[i];
    else break;
  }
  const segMonths = observedMonths.filter((m) => m >= segmentStart);

  // Trim to the display window (last N observed months of the segment), then
  // forward-fill the month grid so the smoother sees a regular series.
  const windowStart = segMonths[Math.max(0, segMonths.length - displayMonths)];
  const lastObserved = observedMonths[observedMonths.length - 1];
  const grid = monthRange(windowStart, lastObserved);
  const now = new Date();
  const curYear = now.getUTCFullYear();

  const filled: { month: string; label: string; value: number; observed: boolean }[] = [];
  let lastVal: number | null = null;
  const observedInWindow = new Set(observedMonths.filter((m) => m >= windowStart));
  for (const month of grid) {
    if (monthVals.has(month)) lastVal = median(monthVals.get(month)!);
    if (lastVal == null) continue; // no leading value yet
    filled.push({ month, label: monthLabel(month, curYear), value: Number(lastVal.toFixed(4)), observed: monthVals.has(month) });
  }

  // ── Concession overlay ──────────────────────────────────────────────────
  const concessions: { month: string; label: string; price: number }[] = [];
  for (const r of rows) {
    if (r.price_type !== "concession") continue;
    const month = (r.effective_date ?? "").slice(0, 7);
    if (!month || month < windowStart) continue;
    const v = r.pack_price != null ? Number(r.pack_price) : r.unit_price != null ? Number(r.unit_price) : null;
    if (v == null) continue;
    concessions.push({ month, label: monthLabel(month, curYear), price: Number(v.toFixed(4)) });
  }

  // ── Forecast (gated) ────────────────────────────────────────────────────
  // Recency gate: only project when the series reaches (nearly) the present —
  // otherwise a "forecast" would start in the past. Allow a 4-month scrape lag.
  const lastDate = new Date(`${lastObserved}-01T00:00:00Z`);
  const ageMonths = (now.getUTCFullYear() - lastDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - lastDate.getUTCMonth());
  let forecast: {
    eligible: boolean; reason: string | null; mapePct: number | null;
    points: { month: string; label: string; mid: number; lo: number; hi: number }[];
  } | null = null;

  if (ageMonths > 4) {
    forecast = { eligible: false, reason: `latest price is ${ageMonths} months old`, mapePct: null, points: [] };
  } else if (filled.length >= 4) {
    const values = filled.map((f) => f.value);
    const fc = forecastPrice(values, forward, { observedCount: observedInWindow.size });
    const points: { month: string; label: string; mid: number; lo: number; hi: number }[] = [];
    if (fc.eligible) {
      let y = lastDate.getUTCFullYear();
      let m = lastDate.getUTCMonth() + 1; // 0-indexed → next month below
      for (let k = 0; k < fc.mid.length; k++) {
        m++; if (m > 12) { m = 1; y++; }
        const key = `${y}-${String(m).padStart(2, "0")}`;
        points.push({
          month: key, label: monthLabel(key, curYear),
          mid: Number(fc.mid[k].toFixed(4)), lo: Number(fc.lo[k].toFixed(4)), hi: Number(fc.hi[k].toFixed(4)),
        });
      }
    }
    forecast = { eligible: fc.eligible, reason: fc.reason, mapePct: fc.mapePct, points };
  }

  return NextResponse.json({
    drug_id: drugId,
    country,
    available: true,
    strength: chosenStrength === "(unspecified)" ? null : chosenStrength,
    pack: perParts.size === 1 ? [...perParts][0] : null,
    price_type: priceType,
    price_type_label: PRICE_TYPE_LABEL[priceType] ?? priceType,
    currency,
    source: rows[rows.length - 1]?.source ?? null,
    generated: now.toISOString().slice(0, 10),
    history: filled,
    forecast,
    concessions,
  });
}
