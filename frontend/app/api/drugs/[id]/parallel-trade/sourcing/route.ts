import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/drugs/[id]/parallel-trade/sourcing?market=GB
 *
 * VIEW A — "sourcing routes during a shortage" (procurement / hospital
 * pharmacist). Fuses parallel-import lanes with live shortage status:
 *
 *   • destination_in_shortage — is this drug short in the user's market?
 *   • per lane: is the SOURCE market also short? A lane is only "viable" if the
 *     source market is NOT currently short (otherwise you can't actually get
 *     stock from it).
 *
 * This is the on-strategy view: it turns the raw licence list into an
 * actionable answer to "where can I still get this during a shortage?".
 *
 * Self-heals to available:false if migration 060 isn't applied.
 */

const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France", IT: "Italy",
  ES: "Spain", NL: "Netherlands", BE: "Belgium", SE: "Sweden", DK: "Denmark",
  FI: "Finland", NO: "Norway", CH: "Switzerland", AT: "Austria", PL: "Poland",
  PT: "Portugal", GR: "Greece", CZ: "Czechia", HU: "Hungary", RO: "Romania",
  BG: "Bulgaria", SK: "Slovakia", SI: "Slovenia", HR: "Croatia", LT: "Lithuania",
  LV: "Latvia", EE: "Estonia", LU: "Luxembourg", CY: "Cyprus", MT: "Malta",
  IS: "Iceland", LI: "Liechtenstein", EU: "European Union",
};

interface LicenceRow {
  id: string;
  licence_type: "EMA_PARALLEL_DISTRIBUTION" | "NATIONAL_PARALLEL_IMPORT";
  licence_number: string | null;
  status: string;
  product_name: string;
  pack_size: string | null;
  dosage_form: string | null;
  strength: string | null;
  licence_holder: string | null;
  source_country: string | null;
  destination_country: string | null;
  reference_product_name: string | null;
  source_authority: string | null;
  source_url: string | null;
  last_checked: string | null;
}
interface MatchRow {
  confidence: number;
  needs_review: boolean;
  review_state: "auto" | "confirmed" | "rejected";
  parallel_trade_licences: LicenceRow | null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: drugId } = await ctx.params;
  const market = (new URL(req.url).searchParams.get("market") || "").toUpperCase();
  if (!drugId) return NextResponse.json({ error: "Missing drug id" }, { status: 400 });
  if (!/^[A-Z]{2}$/.test(market)) {
    return NextResponse.json({ error: "market must be ISO alpha-2" }, { status: 400 });
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

  // Molecule family.
  const family = new Set<string>([drug.id]);
  if (drug.canonical_drug_id) family.add(drug.canonical_drug_id);
  const variantRes = await admin.from("drugs").select("id").eq("canonical_drug_id", drug.id).limit(500);
  for (const v of variantRes.data ?? []) family.add((v as { id: string }).id);
  const familyIds = Array.from(family);

  // Active/anticipated shortage country set for this molecule (one query).
  const shortRes = await admin
    .from("shortage_events")
    .select("country_code, status")
    .in("drug_id", familyIds)
    .in("status", ["active", "anticipated"]);

  const empty = {
    drug_id: drug.id,
    drug_name: drug.generic_name,
    market,
    market_name: COUNTRY_NAMES[market] ?? market,
    available: false,
    destination_in_shortage: false,
    lanes: [],
  };
  if (shortRes.error && !/relation .* does not exist|PGRST205/i.test(shortRes.error.message)) {
    return NextResponse.json({ error: shortRes.error.message }, { status: 500 });
  }
  const shortCountries = new Set<string>();
  for (const s of shortRes.data ?? []) {
    const cc = (s as { country_code: string | null }).country_code;
    if (cc) shortCountries.add(cc.toUpperCase());
  }
  const destinationInShortage = shortCountries.has(market);

  // Lanes destined to this market, matched to the molecule.
  const matchRes = await admin
    .from("product_parallel_trade_matches")
    .select(
      "confidence, needs_review, review_state, parallel_trade_licences(" +
        "id, licence_type, licence_number, status, product_name, pack_size, dosage_form, " +
        "strength, licence_holder, source_country, destination_country, reference_product_name, " +
        "source_authority, source_url, last_checked)"
    )
    .in("drug_id", familyIds)
    .order("confidence", { ascending: false })
    .limit(1000);

  if (matchRes.error) {
    if (/relation .* does not exist|PGRST205|schema cache/i.test(matchRes.error.message)) {
      return NextResponse.json(empty);
    }
    return NextResponse.json({ error: matchRes.error.message }, { status: 500 });
  }

  const matches = ((matchRes.data ?? []) as unknown as MatchRow[]).filter(
    (m) => m.parallel_trade_licences &&
      m.review_state !== "rejected" &&
      (!m.needs_review || m.review_state === "confirmed") &&
      m.parallel_trade_licences.destination_country?.toUpperCase() === market
  );

  const lanes = matches.map((m) => {
    const l = m.parallel_trade_licences!;
    const src = l.source_country?.toUpperCase() ?? null;
    const sourceInShortage = src ? shortCountries.has(src) : false;
    return {
      licence_id: l.id,
      licence_type: l.licence_type,
      licence_number: l.licence_number,
      status: l.status,
      pack_size: l.pack_size,
      strength: l.strength,
      dosage_form: l.dosage_form,
      licence_holder: l.licence_holder,
      reference_product_name: l.reference_product_name,
      source_country: src,
      source_country_name: src ? COUNTRY_NAMES[src] ?? src : null,
      destination_country: market,
      source_authority: l.source_authority,
      source_url: l.source_url,
      last_checked: l.last_checked,
      confidence: Number(m.confidence),
      // Fused signal: is the source market itself short?
      source_in_shortage: sourceInShortage,
      viable: !sourceInShortage,
    };
  });

  // Viable lanes first, then by confidence.
  lanes.sort((a, b) => (a.viable === b.viable ? b.confidence - a.confidence : a.viable ? -1 : 1));

  return NextResponse.json({
    drug_id: drug.id,
    drug_name: drug.generic_name,
    market,
    market_name: COUNTRY_NAMES[market] ?? market,
    available: true,
    destination_in_shortage: destinationInShortage,
    viable_count: lanes.filter((l) => l.viable).length,
    lanes,
  });
}
