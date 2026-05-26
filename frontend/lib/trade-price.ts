/**
 * Trade-price helper: aggregates supplier_inventory rows into a per-country
 * median price + a small set of adjacent-market comparators, consumed by the
 * persona views on /drugs/[id] (PharmacistAnswerCard, ProcurementView, SupplierView).
 *
 * Returns null when there is no inventory data for the user's country so callers
 * can omit the trade-price tile entirely (the components already gracefully hide
 * when tradePrice is null).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦",
  SG: "🇸🇬", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪",
  CH: "🇨🇭", NO: "🇳🇴", SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰", NL: "🇳🇱",
  BE: "🇧🇪", AT: "🇦🇹", PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", JP: "🇯🇵",
  KR: "🇰🇷", IN: "🇮🇳", CN: "🇨🇳", BR: "🇧🇷", MX: "🇲🇽", ZA: "🇿🇦",
  MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  AUD: "A$", NZD: "NZ$", USD: "$", CAD: "C$", SGD: "S$",
  GBP: "£", EUR: "€", JPY: "¥", CHF: "CHF",
};

export interface AdjacentMarket {
  country: string;
  flag: string;
  price: string;
  delta: number;
}

/**
 * Normalised shape covering all three persona components.
 * - PharmacistAnswerCard / ProcurementView read { au: { value, unit, updatedDaysAgo }, adjacent }
 * - SupplierView reads               { au: { value, currency, pack, updatedLabel }, adjacent }
 * We populate both projections so the page can pass through directly.
 */
export interface TradePriceData {
  home: {
    value: string;          // formatted price w/ symbol, e.g. "A$12.40"
    unit: string;           // "per pack of 30 tablets · AUD"
    currency: string;       // "AUD"
    pack: string;           // "30 tablets" or "unit"
    updatedDaysAgo: number;
    updatedLabel: string;   // e.g. "updated 4d ago"
  };
  adjacent: AdjacentMarket[];
}

interface InventoryRow {
  countries: string[] | null;
  unit_price: number | null;
  currency: string | null;
  pack_size: string | null;
  updated_at: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mode<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

function formatPrice(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const formatted = value < 10 ? value.toFixed(2) : value.toFixed(2);
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Compute trade-price summary for a drug.
 * - homeCountry: the user's home market (defaults to "AU"). Returns null if no
 *   inventory rows reference this country.
 * - Adjacent markets: up to 5 other countries with the most listings. Delta is
 *   computed only when currency matches the home market; otherwise delta = 0.
 */
export async function computeTradePrice(
  supabase: SupabaseClient,
  drugId: string,
  homeCountry: string = "AU",
): Promise<TradePriceData | null> {
  const { data, error } = await supabase
    .from("supplier_inventory")
    .select("countries, unit_price, currency, pack_size, updated_at")
    .eq("drug_id", drugId)
    .neq("status", "depleted")
    .not("unit_price", "is", null);

  if (error || !data || data.length === 0) return null;

  const home = homeCountry.toUpperCase();
  const rows = data as InventoryRow[];

  // Bucket rows by each country listed in the `countries` array.
  const byCountry = new Map<string, InventoryRow[]>();
  for (const r of rows) {
    if (r.unit_price === null) continue;
    const cs = (r.countries ?? []).map((c) => c.toUpperCase()).filter(Boolean);
    if (cs.length === 0) continue;
    for (const c of cs) {
      const arr = byCountry.get(c) ?? [];
      arr.push(r);
      byCountry.set(c, arr);
    }
  }

  const homeRows = byCountry.get(home);
  if (!homeRows || homeRows.length === 0) return null;

  const homePrices = homeRows.map((r) => Number(r.unit_price)).filter((n) => Number.isFinite(n) && n > 0);
  if (homePrices.length === 0) return null;
  const homeMedian = median(homePrices);
  const homeCurrency = (mode(homeRows.map((r) => r.currency ?? "AUD")) ?? "AUD").toUpperCase();
  const homePack = mode(homeRows.map((r) => r.pack_size).filter((p): p is string => !!p)) ?? "unit";
  const latestUpdate = homeRows
    .map((r) => r.updated_at)
    .filter((s): s is string => !!s)
    .sort()
    .pop() ?? null;
  const updatedDaysAgo = daysAgo(latestUpdate);

  // Adjacent markets: up to 5, ordered by listing count desc.
  const adjacent: AdjacentMarket[] = [];
  const candidates = Array.from(byCountry.entries())
    .filter(([c]) => c !== home)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  for (const [country, countryRows] of candidates) {
    const prices = countryRows.map((r) => Number(r.unit_price)).filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length === 0) continue;
    const med = median(prices);
    const currency = (mode(countryRows.map((r) => r.currency ?? "")) ?? "").toUpperCase();
    // Only compute delta when currencies match — cross-currency deltas without
    // FX rates would be misleading.
    const delta = currency && currency === homeCurrency
      ? Math.round(((med - homeMedian) / homeMedian) * 100)
      : 0;
    adjacent.push({
      country,
      flag: FLAG[country] ?? "🌐",
      price: formatPrice(med, currency || homeCurrency),
      delta,
    });
  }

  return {
    home: {
      value: formatPrice(homeMedian, homeCurrency),
      unit: `per ${homePack} · ${homeCurrency}`,
      currency: homeCurrency,
      pack: homePack,
      updatedDaysAgo,
      updatedLabel: updatedDaysAgo === 0 ? "updated today" : `updated ${updatedDaysAgo}d ago`,
    },
    adjacent,
  };
}
