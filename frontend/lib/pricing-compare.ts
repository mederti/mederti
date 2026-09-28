// Cost-vs-alternatives comparison for the drug page (hospital-pharmacist
// feedback #4). A single "trade price" doesn't help a substitution decision —
// the pharmacist needs to see, at a glance, which alternative is close in cost
// and which is dramatically more expensive.
//
// Honesty rules baked in:
//   • Compare ONLY like-for-like: same market, same currency, same price basis
//     (per-unit vs per-pack), same price_type. A price on a different basis is
//     reported as "not directly comparable", never silently rebased.
//   • Prefer the per-unit price — the fair comparator across differing pack
//     sizes. Fall back to per-pack only when both sides are per-pack.
//   • The headline signal is a coarse BAND ("Similar", "~3× higher"), not a
//     false-precise percentage. The underlying figure is shown alongside,
//     labelled with its basis, so the number never stands alone.
//   • When several strengths/packs of one product have comparable prices, show
//     the range rather than an arbitrary single value.

export type PriceRow = {
  drug_id?: string | null;
  price_type?: string | null;
  currency?: string | null;
  pack_price?: number | string | null;
  unit_price?: number | string | null;
  pack_description?: string | null;
  product_name?: string | null;
  effective_date?: string | null;
  source?: string | null;
};

export type CompareBand =
  | "lower" | "similar" | "higher" | "much_higher" | "far_higher";

export const BAND_LABEL: Record<CompareBand, string> = {
  lower: "Lower cost",
  similar: "Similar price",
  higher: "Higher",
  much_higher: "Much higher",
  far_higher: "Far higher",
};

export type CompareRow = {
  drug_id: string;
  name: string;
  relationship: string | null;
  // Comparable = a like-for-like price exists in this market. When false, value
  // fields are null and the UI shows "no comparable price".
  comparable: boolean;
  value: number | null;   // representative (median) per-basis price
  min: number | null;     // range low  (equals value when a single price)
  max: number | null;     // range high
  ratio: number | null;   // value / current-drug value; null for the anchor
  band: CompareBand | null;
  source: string | null;
};

export type CompareResult = {
  currency: string;
  basis: "unit" | "pack";       // the basis every comparable row shares
  basisLabel: string;           // "per unit" | "per pack"
  priceTypeLabel: string;       // human label for the shared price_type
  anchor: CompareRow;           // the current drug
  alternatives: CompareRow[];   // comparable first (cheap→dear), then non-comparable
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Per-basis value for a row given the chosen basis. Returns null if the row
// carries no price on that basis.
function basisValue(r: PriceRow, basis: "unit" | "pack"): number | null {
  return basis === "unit" ? num(r.unit_price) : num(r.pack_price);
}

function bandFor(ratio: number): CompareBand {
  if (ratio < 0.8) return "lower";
  if (ratio <= 1.25) return "similar";
  if (ratio <= 3) return "higher";
  if (ratio <= 8) return "much_higher";
  return "far_higher";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Latest row per price_type for a drug (rows must be date-desc already).
function latestByType(rows: PriceRow[]): Map<string, PriceRow> {
  const out = new Map<string, PriceRow>();
  for (const r of rows) {
    const t = r.price_type ?? "";
    if (t && !out.has(t)) out.set(t, r);
  }
  return out;
}

/**
 * Build the comparison. `headlinePriority` and `priceTypeLabels` are passed in
 * so this stays decoupled from the page's constants (and unit-testable).
 *
 * `rowsByDrug` maps drug_id → that drug's price rows in the user's market,
 * date-desc. `anchorId` is the current drug; `meta` supplies display names +
 * relationships for every id.
 */
export function buildPriceComparison(
  anchorId: string,
  rowsByDrug: Map<string, PriceRow[]>,
  meta: Map<string, { name: string; relationship: string | null }>,
  headlinePriority: string[],
  priceTypeLabels: Record<string, string>,
): CompareResult | null {
  const anchorRows = rowsByDrug.get(anchorId) ?? [];
  if (anchorRows.length === 0) return null;

  const anchorLatest = latestByType(anchorRows);

  // Choose the anchor's comparator: first price_type (by priority) that yields
  // a value, preferring the per-unit basis so alternatives compare fairly.
  let chosen: { type: string; basis: "unit" | "pack"; currency: string } | null = null;
  for (const basis of ["unit", "pack"] as const) {
    for (const type of headlinePriority) {
      const r = anchorLatest.get(type);
      const v = r ? basisValue(r, basis) : null;
      if (r && v != null && v > 0) {
        chosen = { type, basis, currency: (r.currency ?? "").toUpperCase() };
        break;
      }
    }
    if (chosen) break;
  }
  if (!chosen) return null;

  // Collect every comparable value for a drug: same price_type, same currency,
  // same basis. Multiple strengths/packs → a range.
  const valuesFor = (rows: PriceRow[]): number[] => {
    const vals: number[] = [];
    for (const r of rows) {
      if ((r.price_type ?? "") !== chosen!.type) continue;
      if ((r.currency ?? "").toUpperCase() !== chosen!.currency) continue;
      const v = basisValue(r, chosen!.basis);
      if (v != null && v > 0) vals.push(v);
    }
    return vals;
  };

  const anchorVals = valuesFor(anchorRows);
  const anchorMed = median(anchorVals);
  const anchorSrc = anchorLatest.get(chosen.type)?.source ?? null;

  const makeRow = (id: string): CompareRow => {
    const m = meta.get(id) ?? { name: id, relationship: null };
    if (id === anchorId) {
      return {
        drug_id: id, name: m.name, relationship: m.relationship,
        comparable: true, value: anchorMed,
        min: Math.min(...anchorVals), max: Math.max(...anchorVals),
        ratio: null, band: null, source: anchorSrc,
      };
    }
    const vals = valuesFor(rowsByDrug.get(id) ?? []);
    if (vals.length === 0) {
      return {
        drug_id: id, name: m.name, relationship: m.relationship,
        comparable: false, value: null, min: null, max: null,
        ratio: null, band: null, source: null,
      };
    }
    const med = median(vals);
    const ratio = anchorMed > 0 ? med / anchorMed : null;
    return {
      drug_id: id, name: m.name, relationship: m.relationship,
      comparable: true, value: med,
      min: Math.min(...vals), max: Math.max(...vals),
      ratio, band: ratio != null ? bandFor(ratio) : null,
      source: (rowsByDrug.get(id) ?? []).find((r) => r.price_type === chosen!.type)?.source ?? null,
    };
  };

  const anchor = makeRow(anchorId);
  const altIds = [...rowsByDrug.keys()].filter((id) => id !== anchorId);
  const alternatives = altIds.map(makeRow).sort((a, b) => {
    // Comparable first, then cheapest→dearest; non-comparable keep name order.
    if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
    if (a.comparable && b.comparable) return (a.value ?? 0) - (b.value ?? 0);
    return a.name.localeCompare(b.name);
  });

  return {
    currency: chosen.currency,
    basis: chosen.basis,
    basisLabel: chosen.basis === "unit" ? "per unit" : "per pack",
    priceTypeLabel: priceTypeLabels[chosen.type] ?? chosen.type,
    anchor,
    alternatives,
  };
}
