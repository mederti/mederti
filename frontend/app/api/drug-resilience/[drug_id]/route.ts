import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
export async function GET(_req: Request, ctx: { params: Promise<{ drug_id: string }> }) {
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
      .or(`drug_id.eq.${drugId},generic_name.ilike.${inn}`)
      .limit(20),
    admin
      .from("api_suppliers")
      .select("manufacturer_name, country, capabilities, cep_holder, dmf_holder, who_pq, source_url")
      .or(`drug_id.eq.${drugId},generic_name.ilike.${inn}`)
      .limit(20),
    admin
      .from("manufacturing_facilities")
      .select("facility_name, country, last_inspection_classification, last_inspection_date, oai_count_5y, warning_letter_count_5y, source_url"),
    admin
      .from("drug_pricing_history")
      .select("country, price_type, pack_price, currency, pack_description, effective_date")
      .or(`drug_id.eq.${drugId},generic_name.ilike.${inn}`)
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
