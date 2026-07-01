import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { toEur, isConvertible, FX_AS_OF } from "@/lib/parallel-trade/fx";
import { perUnitPrice } from "@/lib/parallel-trade/units";

export const dynamic = "force-dynamic";

/**
 * GET /api/drugs/[id]/parallel-trade/arbitrage?destination=ES
 *
 * VIEW B — "price-spread opportunities" (importer). Fuses the EU27 pricing
 * layer with parallel-trade licences into a buy-low / sell-high map.
 *
 * Comparability is enforced (this is the whole point — a naive spread across
 * incomparable prices is worse than no spread):
 *   1. ONE shared price_type — we compare only legs that quote the same kind of
 *      price (you can't compare a US acquisition cost to a GB drug tariff). We
 *      pick the price_type the destination has that covers the most source
 *      markets.
 *   2. Currency normalised to EUR via indicative FX (lib/parallel-trade/fx).
 *   3. Per-unit normalised (lib/parallel-trade/units) so per-pack and per-unit
 *      prices aren't compared.
 * Markets that can't be made comparable are counted in `excluded_markets`, not
 * silently dropped.
 *
 * Plus lane crowding: count of parallel-trade licences already on each route.
 */

const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France", IT: "Italy",
  ES: "Spain", NL: "Netherlands", BE: "Belgium", SE: "Sweden", DK: "Denmark",
  FI: "Finland", NO: "Norway", CH: "Switzerland", AT: "Austria", PL: "Poland",
  PT: "Portugal", GR: "Greece", CZ: "Czechia", HU: "Hungary", RO: "Romania",
  BG: "Bulgaria", SK: "Slovakia", SI: "Slovenia", HR: "Croatia", LT: "Lithuania",
  LV: "Latvia", EE: "Estonia", LU: "Luxembourg", CY: "Cyprus", MT: "Malta",
  IS: "Iceland", LI: "Liechtenstein", US: "United States",
};

const PRICE_TYPE_PRIORITY = [
  "retail_public", "reference_price", "reimbursement", "list", "drug_tariff",
  "wholesale", "ex_factory", "pharmacy_purchase", "wac", "amp", "tariff",
  "concession", "tender", "other", "unknown_official",
];
const ptRank = (pt: string) => {
  const i = PRICE_TYPE_PRIORITY.indexOf(pt);
  return i === -1 ? PRICE_TYPE_PRIORITY.length : i;
};

interface PriceRow {
  country: string;
  price_type: string;
  unit_price: number | null;
  pack_price: number | null;
  pack_description: string | null;
  currency: string | null;
  effective_date: string | null;
}
interface LicRow { source_country: string | null; destination_country: string | null }

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: drugId } = await ctx.params;
  const destination = (new URL(req.url).searchParams.get("destination") || "").toUpperCase();
  if (!drugId) return NextResponse.json({ error: "Missing drug id" }, { status: 400 });
  if (!/^[A-Z]{2}$/.test(destination)) {
    return NextResponse.json({ error: "destination must be ISO alpha-2" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const drugRes = await admin
    .from("drugs")
    .select("id, generic_name, canonical_drug_id")
    .eq("id", drugId)
    .maybeSingle();
  if (drugRes.error || !drugRes.data) {
    return NextResponse.json({ error: "Drug not found" }, { status: 404 });
  }
  const drug = drugRes.data as { id: string; generic_name: string; canonical_drug_id: string | null };

  const family = new Set<string>([drug.id]);
  if (drug.canonical_drug_id) family.add(drug.canonical_drug_id);
  const variantRes = await admin.from("drugs").select("id").eq("canonical_drug_id", drug.id).limit(500);
  for (const v of variantRes.data ?? []) family.add((v as { id: string }).id);
  const familyIds = Array.from(family);

  const base = {
    drug_id: drug.id,
    drug_name: drug.generic_name,
    destination,
    destination_name: COUNTRY_NAMES[destination] ?? destination,
  };

  const priceRes = await admin
    .from("drug_pricing_history")
    .select("country, price_type, unit_price, pack_price, pack_description, currency, effective_date")
    .in("drug_id", familyIds)
    .limit(5000);
  if (priceRes.error) {
    if (/relation .* does not exist|PGRST205|schema cache/i.test(priceRes.error.message)) {
      return NextResponse.json({ ...base, available: false, routes: [] });
    }
    return NextResponse.json({ error: priceRes.error.message }, { status: 500 });
  }

  // country → price_type → best (most-recent) comparable per-unit EUR price.
  type Cmp = { perUnitEur: number; currency: string; date: string | null; basis: string };
  const grid = new Map<string, Map<string, Cmp>>();
  for (const r of (priceRes.data ?? []) as PriceRow[]) {
    if (!r.country || !isConvertible(r.currency)) continue;
    const { value, basis } = perUnitPrice(r);
    if (value == null) continue;
    const eur = toEur(value, r.currency);
    if (eur == null) continue;
    const cc = r.country.toUpperCase();
    if (!grid.has(cc)) grid.set(cc, new Map());
    const byType = grid.get(cc)!;
    const cur = byType.get(r.price_type);
    if (!cur || (r.effective_date ?? "") > (cur.date ?? "")) {
      byType.set(r.price_type, { perUnitEur: eur, currency: r.currency!, date: r.effective_date, basis });
    }
  }

  const destTypes = grid.get(destination);
  if (!destTypes || destTypes.size === 0) {
    return NextResponse.json({ ...base, available: true, routes: [], note: `No comparable ${destination} price on file for this molecule yet.` });
  }

  // Choose the price_type the destination has that yields the most comparable
  // source markets (tiebreak: price-type priority).
  let chosenType: string | null = null;
  let chosenSources: string[] = [];
  for (const pt of destTypes.keys()) {
    const sources = [...grid.entries()]
      .filter(([cc, m]) => cc !== destination && m.has(pt))
      .map(([cc]) => cc);
    if (
      sources.length > chosenSources.length ||
      (sources.length === chosenSources.length && chosenType && ptRank(pt) < ptRank(chosenType))
    ) {
      chosenType = pt;
      chosenSources = sources;
    }
  }
  if (!chosenType || chosenSources.length === 0) {
    const priced = grid.size;
    return NextResponse.json({
      ...base,
      available: true,
      routes: [],
      priced_markets: priced,
      note: `Priced in ${priced} market${priced !== 1 ? "s" : ""}, but no two share a comparable price type with ${destination} — no like-for-like spread.`,
    });
  }

  const destCmp = destTypes.get(chosenType)!;

  // Lane crowding.
  const licRes = await admin
    .from("product_parallel_trade_matches")
    .select("parallel_trade_licences(source_country, destination_country)")
    .in("drug_id", familyIds)
    .limit(2000);
  const laneCount = new Map<string, number>();
  for (const m of (licRes.data ?? []) as unknown as Array<{ parallel_trade_licences: LicRow | null }>) {
    const l = m.parallel_trade_licences;
    if (!l?.source_country || l.destination_country?.toUpperCase() !== destination) continue;
    const k = l.source_country.toUpperCase();
    laneCount.set(k, (laneCount.get(k) ?? 0) + 1);
  }

  const sell = destCmp.perUnitEur;
  const routes = chosenSources.map((cc) => {
    const buy = grid.get(cc)!.get(chosenType!)!.perUnitEur;
    const spreadAbs = sell - buy;
    const spreadPct = buy > 0 ? (spreadAbs / buy) * 100 : null;
    const licensed = laneCount.get(cc) ?? 0;
    const crowding = licensed === 0 ? "open" : licensed <= 2 ? "active" : "saturated";
    return {
      source_country: cc,
      source_country_name: COUNTRY_NAMES[cc] ?? cc,
      buy_eur_unit: Math.round(buy * 10000) / 10000,
      sell_eur_unit: Math.round(sell * 10000) / 10000,
      spread_abs: Math.round(spreadAbs * 10000) / 10000,
      spread_pct: spreadPct == null ? null : Math.round(spreadPct),
      licensed_lanes: licensed,
      crowding,
    };
  });
  routes.sort((a, b) => (b.spread_pct ?? -9999) - (a.spread_pct ?? -9999));

  const excluded = grid.size - 1 - chosenSources.length;
  const bestSpread = routes.find((r) => r.spread_pct != null && r.spread_pct > 0)?.spread_pct ?? null;

  return NextResponse.json({
    ...base,
    available: true,
    price_type: chosenType,
    currency: "EUR",
    basis: "per_unit",
    fx_as_of: FX_AS_OF,
    sell_eur_unit: Math.round(sell * 10000) / 10000,
    priced_markets: grid.size,
    comparable_markets: chosenSources.length + 1,
    excluded_markets: excluded < 0 ? 0 : excluded,
    best_spread_pct: bestSpread,
    routes,
    caveat:
      "Per-unit prices normalised to EUR at indicative FX — a screening signal, not a quote. " +
      "Gross spread before logistics, repackaging, fees and destination clawback. " +
      "Compares one shared price type only; markets pricing on a different basis are excluded.",
  });
}
