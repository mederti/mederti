import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/drugs/[id]/parallel-trade
 *
 * Parallel Trade Intelligence for a canonical drug: EMA parallel-distribution
 * notices and national parallel-import licences matched to this molecule, with
 * the confidence score for each match.
 *
 * Source: product_parallel_trade_matches ⇄ parallel_trade_licences
 * (migration 060). Matches are stored against the canonical molecule, so we
 * query the whole molecule family (the drug, its canonical head, and any
 * variants that roll up to it) to catch salt/spelling variants.
 *
 * Low-confidence matches (confidence < 0.65, needs_review) and curator-rejected
 * matches are returned in a separate `review` bucket — the UI demotes/warns on
 * them rather than presenting them as fact.
 */

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", GB: "United Kingdom", US: "United States", CA: "Canada",
  EU: "European Union", NZ: "New Zealand", IE: "Ireland", DE: "Germany",
  FR: "France", IT: "Italy", ES: "Spain", NL: "Netherlands", BE: "Belgium",
  SE: "Sweden", DK: "Denmark", FI: "Finland", NO: "Norway", CH: "Switzerland",
  AT: "Austria", PL: "Poland", PT: "Portugal", GR: "Greece", CZ: "Czechia",
  HU: "Hungary", RO: "Romania", BG: "Bulgaria", SK: "Slovakia", SI: "Slovenia",
  HR: "Croatia", LT: "Lithuania", LV: "Latvia", EE: "Estonia", LU: "Luxembourg",
  CY: "Cyprus", MT: "Malta", IS: "Iceland", LI: "Liechtenstein",
};

interface LicenceRow {
  id: string;
  licence_type: "EMA_PARALLEL_DISTRIBUTION" | "NATIONAL_PARALLEL_IMPORT";
  licence_number: string | null;
  status: string;
  product_name: string;
  brand_name: string | null;
  active_substance: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  licence_holder: string | null;
  marketing_authorisation_holder: string | null;
  source_country: string | null;
  destination_country: string | null;
  reference_product_name: string | null;
  reference_ma_number: string | null;
  source_authority: string | null;
  source_url: string | null;
  granted_date: string | null;
  expiry_date: string | null;
  last_checked: string | null;
}

interface MatchRow {
  confidence: number;
  match_basis: string[] | null;
  needs_review: boolean;
  review_state: "auto" | "confirmed" | "rejected";
  parallel_trade_licences: LicenceRow | null;
}

function shape(m: MatchRow) {
  const l = m.parallel_trade_licences!;
  return {
    licence_id: l.id,
    licence_type: l.licence_type,
    licence_number: l.licence_number,
    status: l.status,
    product_name: l.product_name,
    brand_name: l.brand_name,
    active_substance: l.active_substance,
    strength: l.strength,
    dosage_form: l.dosage_form,
    pack_size: l.pack_size,
    licence_holder: l.licence_holder,
    marketing_authorisation_holder: l.marketing_authorisation_holder,
    source_country: l.source_country,
    source_country_name: l.source_country ? COUNTRY_NAMES[l.source_country] ?? l.source_country : null,
    destination_country: l.destination_country,
    destination_country_name: l.destination_country ? COUNTRY_NAMES[l.destination_country] ?? l.destination_country : null,
    reference_product_name: l.reference_product_name,
    reference_ma_number: l.reference_ma_number,
    source_authority: l.source_authority,
    source_url: l.source_url,
    granted_date: l.granted_date,
    expiry_date: l.expiry_date,
    last_checked: l.last_checked,
    confidence: Number(m.confidence),
    match_basis: m.match_basis ?? [],
    review_state: m.review_state,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: drugId } = await ctx.params;
  if (!drugId) {
    return NextResponse.json({ error: "Missing drug id" }, { status: 400 });
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

  // Build the molecule family: this drug + its canonical head + variants.
  const family = new Set<string>([drug.id]);
  if (drug.canonical_drug_id) family.add(drug.canonical_drug_id);
  const variantRes = await admin
    .from("drugs")
    .select("id")
    .eq("canonical_drug_id", drug.id)
    .limit(500);
  for (const v of variantRes.data ?? []) family.add((v as { id: string }).id);

  const matchRes = await admin
    .from("product_parallel_trade_matches")
    .select(
      "confidence, match_basis, needs_review, review_state, " +
        "parallel_trade_licences(*)"
    )
    .in("drug_id", Array.from(family))
    .order("confidence", { ascending: false })
    .limit(1000);

  if (matchRes.error) {
    // Defensive: if migration 060 isn't applied yet, don't 500 the drug page —
    // return an empty (but well-formed) payload so the panel renders "no data".
    const missing = /relation .* does not exist|PGRST205|schema cache/i.test(
      matchRes.error.message
    );
    if (missing) {
      return NextResponse.json({
        drug_id: drug.id,
        drug_name: drug.generic_name,
        available: false,
        ema_distribution: [],
        national_imports: [],
        review: [],
        summary: { ema_count: 0, national_count: 0, countries: 0, needs_review: 0 },
      });
    }
    return NextResponse.json({ error: matchRes.error.message }, { status: 500 });
  }

  const matches = ((matchRes.data ?? []) as unknown as MatchRow[]).filter(
    (m) => m.parallel_trade_licences
  );

  // Confident vs review: hide low-confidence + rejected from the primary view.
  const confident = matches.filter(
    (m) => !m.needs_review && m.review_state !== "rejected"
  );
  const review = matches.filter(
    (m) => (m.needs_review || m.review_state === "rejected") && m.review_state !== "confirmed"
  );
  // Curator-confirmed low-confidence matches are promoted into the main view.
  const confirmedLow = matches.filter(
    (m) => m.needs_review && m.review_state === "confirmed"
  );

  const primary = [...confident, ...confirmedLow];
  const ema = primary.filter((m) => m.parallel_trade_licences!.licence_type === "EMA_PARALLEL_DISTRIBUTION").map(shape);
  const national = primary.filter((m) => m.parallel_trade_licences!.licence_type === "NATIONAL_PARALLEL_IMPORT").map(shape);

  const countries = new Set<string>();
  for (const n of national) if (n.destination_country) countries.add(n.destination_country);

  return NextResponse.json({
    drug_id: drug.id,
    drug_name: drug.generic_name,
    available: true,
    ema_distribution: ema,
    national_imports: national,
    review: review.map(shape),
    summary: {
      ema_count: ema.length,
      national_count: national.length,
      countries: countries.size,
      needs_review: review.length,
    },
    methodology_note:
      "Matches are scored against the molecule (INN). Confidence reflects how many of brand, " +
      "strength, form, pack and MA number we could corroborate. Matches below 0.65 are shown " +
      "under review, not as confirmed routes.",
  });
}
