/**
 * Per-unit price normalisation for parallel-trade spreads.
 *
 * National pricing rows mix granularity: some carry a per-unit price
 * (unit_price), some only a pack price (pack_price) for a pack of N. Comparing
 * a per-pack price in one country to a per-unit price in another is the classic
 * apples-to-oranges error that makes a "spread" meaningless. This derives a
 * common per-unit price so legs are comparable.
 *
 * Strategy: prefer unit_price (already per-unit). Otherwise derive
 * pack_price / packCount, where packCount is parsed from pack_description
 * ("30 tablets", "1 pen (4 doses)" → 30, 1). If neither yields a per-unit
 * value, return null and the leg is excluded from spread maths (shown, flagged).
 */

export interface PricingRowLike {
  unit_price?: number | null;
  pack_price?: number | null;
  pack_description?: string | null;
}

/** Parse the leading pack count from a pack description. "30 tablets" → 30. */
export function packCount(desc: string | null | undefined): number | null {
  if (!desc) return null;
  const m = desc.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Per-unit price for a pricing row, or null if it can't be derived. */
export function perUnitPrice(row: PricingRowLike): { value: number | null; basis: "unit_price" | "pack_derived" | "none" } {
  if (row.unit_price != null && row.unit_price > 0) {
    return { value: row.unit_price, basis: "unit_price" };
  }
  if (row.pack_price != null && row.pack_price > 0) {
    const n = packCount(row.pack_description);
    if (n) return { value: row.pack_price / n, basis: "pack_derived" };
  }
  return { value: null, basis: "none" };
}
