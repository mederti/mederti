import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// 10-minute edge cache. Resilience scoring does 5 parallel Supabase
// queries + JS cross-referencing of supplier-companies-to-facility-names
// (the audit's FINDING-B3-06 logic-location concern). Bounded cardinality
// (one entry per drug UUID; ~10k drugs total) means high cache hit rate
// for popular drugs. Underlying tables update from scrapers on multi-hour
// cycles — 10-min staleness is invisible. Closes more of FINDING-P5-01.
export const revalidate = 600;

/**
 * GET /api/drug-resilience/[drug_id]
 *
 * Returns supply-chain resilience signals for a drug:
 *   - Approvals (FDA Drugs@FDA, EMA EPAR, MHRA, TGA) with TE codes
 *   - API suppliers (PharmaCompass) with country and CEP/DMF/WHO PQ flags
 *   - Manufacturing facilities (FDA inspections + EudraGMDP)
 *   - Pricing snapshot (NHS Drug Tariff + concessions if GB)
 *   - Therapeutic equivalents (Orange Book + clinician)
 *
 * Used by the Supply Chain Resilience widget on /drugs/[id].
 */
export async function GET(req: Request, ctx: { params: Promise<{ drug_id: string }> }) {
  const limited = await enforceRateLimit(req, "strict");
  if (limited) return limited;

  const { drug_id: drugId } = await ctx.params;
  if (!drugId) return NextResponse.json({});

  const admin = getSupabaseAdmin();

  // Get the drug to retrieve generic_name (so we can match approvals/suppliers by INN)
  const { data: drug } = await admin
    .from("drugs")
    .select("id, generic_name, who_essential_medicine, critical_medicine_eu, atc_code_full")
    .eq("id", drugId)
    .maybeSingle();

  if (!drug) return NextResponse.json({});

  const inn = ((drug as { generic_name: string }).generic_name ?? "").toLowerCase();

  // Build the drug_id/generic_name OR filter safely. Combination INNs contain
  // commas/parens (e.g. "amoxicillin, clavulanic acid", "iron (III) hydroxide")
  // which are PostgREST .or() structural chars — interpolating them raw
  // corrupts the whole expression, so all three queries silently returned []
  // (no approvals, suppliers or pricing) for those drugs. When the name isn't
  // or()-safe, fall back to the drug_id match alone (drugId is a validated
  // UUID) rather than breaking the query.
  const innIsOrSafe = inn.length > 0 && !/[,()]/.test(inn);
  const idOrName = innIsOrSafe
    ? `drug_id.eq.${drugId},generic_name.ilike.${inn}`
    : `drug_id.eq.${drugId}`;

  // Fetch resilience signals in parallel
  const [
    approvalsRes,
    suppliersRes,
    facilitiesByCompanyRes,
    pricingRes,
    equivRes,
  ] = await Promise.all([
    admin
      .from("drug_approvals")
      .select("authority, application_number, application_type, approval_date, status, te_code, applicant_name, brand_name, source_url")
      .or(idOrName)
      .limit(20),
    admin
      .from("api_suppliers")
      .select("manufacturer_name, country, capabilities, cep_holder, dmf_holder, who_pq, source_url")
      .or(idOrName)
      .limit(20),
    admin
      .from("manufacturing_facilities")
      .select("facility_name, country, last_inspection_classification, last_inspection_date, oai_count_5y, warning_letter_count_5y, source_url"),
    admin
      .from("drug_pricing_history")
      .select("country, price_type, pack_price, currency, pack_description, effective_date")
      .or(idOrName)
      .order("effective_date", { ascending: false })
      .limit(10),
    admin
      .from("therapeutic_equivalents")
      .select("alternative_drug_id, equivalence_type, evidence_level")
      .eq("drug_id", drugId)
      .limit(10),
  ]);

  const approvals = approvalsRes.data ?? [];
  const apiSuppliers = suppliersRes.data ?? [];
  const pricing = pricingRes.data ?? [];
  const equivalents = equivRes.data ?? [];

  // Cross-reference suppliers to facilities for OAI exposure
  const supplierCompanies = new Set(
    apiSuppliers.map((s) => (s as { manufacturer_name: string }).manufacturer_name?.toLowerCase()).filter(Boolean)
  );
  const matchingFacilities = (facilitiesByCompanyRes.data ?? []).filter((f) => {
    const name = ((f as { facility_name: string }).facility_name ?? "").toLowerCase();
    return Array.from(supplierCompanies).some((sc) => sc && name.includes(sc));
  }).slice(0, 10);

  // Compute resilience headlines
  const oaiExposed = matchingFacilities.filter(
    (f) => (f as { last_inspection_classification: string }).last_inspection_classification === "OAI",
  ).length;
  const warningLetterCount = matchingFacilities.reduce(
    (sum, f) => sum + ((f as { warning_letter_count_5y: number }).warning_letter_count_5y || 0),
    0,
  );
  const supplierCountries = Array.from(new Set(apiSuppliers.map((s) => (s as { country: string }).country).filter(Boolean)));
  const concentrationRisk =
    apiSuppliers.length === 0 ? "unknown" :
    apiSuppliers.length === 1 ? "very high" :
    apiSuppliers.length <= 3 ? "high" :
    apiSuppliers.length <= 6 ? "medium" : "low";

  return NextResponse.json({
    drug: drug,
    approvals,
    api_suppliers: apiSuppliers,
    facilities: matchingFacilities,
    pricing,
    equivalents,
    resilience_score: {
      api_supplier_count: apiSuppliers.length,
      supplier_country_count: supplierCountries.length,
      concentration_risk: concentrationRisk,
      oai_exposed_facilities: oaiExposed,
      warning_letters_5y: warningLetterCount,
      who_essential: (drug as { who_essential_medicine: boolean }).who_essential_medicine,
      eu_critical: (drug as { critical_medicine_eu: boolean }).critical_medicine_eu,
    },
  });
}
