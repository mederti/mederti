import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/drugs/[id]/availability
 *
 * Cross-border availability for a canonical drug. Returns the list of
 * countries where the drug is registered, with the marketing
 * authorisation holders, brand examples and registration counts.
 *
 * Source: drug_catalogue (the per-country registration table). Only
 * 5 countries (AU/GB/US/CA/EU) currently have catalogue data; missing
 * countries are correctly absent rather than misleadingly empty.
 */

interface CatalogueRow {
  source_country: string;
  brand_name: string | null;
  sponsor: string | null;
  strength: string | null;
  dosage_form: string | null;
  registration_status: string | null;
  registration_number: string | null;
  source_name: string | null;
}

interface CountrySummary {
  code: string;
  name: string;
  total_products: number;
  active_products: number;
  top_sponsors: Array<{ name: string; products: number }>;
  brand_examples: string[];
  source_name: string | null;
}

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  EU: "European Union",
  NZ: "New Zealand",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  SE: "Sweden",
  DK: "Denmark",
  FI: "Finland",
  NO: "Norway",
  CH: "Switzerland",
  AT: "Austria",
  JP: "Japan",
  SG: "Singapore",
  IN: "India",
  AE: "UAE",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: drugId } = await ctx.params;
  if (!drugId) {
    return NextResponse.json({ error: "Missing drug id" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Pull the canonical drug row for the name.
  const drugRes = await admin
    .from("drugs")
    .select("id, generic_name, brand_names, atc_code")
    .eq("id", drugId)
    .maybeSingle();

  if (drugRes.error || !drugRes.data) {
    return NextResponse.json(
      { error: "Drug not found" },
      { status: 404 }
    );
  }

  const drug = drugRes.data as {
    id: string;
    generic_name: string;
    brand_names: string[] | null;
    atc_code: string | null;
  };

  // Pull every catalogue row mapped to this drug.
  const cataRes = await admin
    .from("drug_catalogue")
    .select(
      "source_country, brand_name, sponsor, strength, dosage_form, registration_status, registration_number, source_name"
    )
    .eq("drug_id", drugId)
    .limit(2000);

  if (cataRes.error) {
    return NextResponse.json(
      { error: cataRes.error.message },
      { status: 500 }
    );
  }

  const rows = (cataRes.data ?? []) as CatalogueRow[];

  // Aggregate by country.
  const byCountry = new Map<string, {
    rows: CatalogueRow[];
    sponsors: Map<string, number>;
    brands: Set<string>;
    activeCount: number;
    sourceName: string | null;
  }>();

  for (const r of rows) {
    if (!r.source_country) continue;
    const code = r.source_country.toUpperCase();
    if (!byCountry.has(code)) {
      byCountry.set(code, {
        rows: [],
        sponsors: new Map(),
        brands: new Set(),
        activeCount: 0,
        sourceName: null,
      });
    }
    const bucket = byCountry.get(code)!;
    bucket.rows.push(r);
    if (r.sponsor) {
      const key = r.sponsor.trim();
      bucket.sponsors.set(key, (bucket.sponsors.get(key) ?? 0) + 1);
    }
    if (r.brand_name) {
      bucket.brands.add(r.brand_name.trim());
    }
    if ((r.registration_status ?? "").toLowerCase() === "active") {
      bucket.activeCount += 1;
    }
    if (!bucket.sourceName && r.source_name) {
      bucket.sourceName = r.source_name;
    }
  }

  const countries: CountrySummary[] = Array.from(byCountry.entries())
    .map(([code, b]) => ({
      code,
      name: COUNTRY_NAMES[code] ?? code,
      total_products: b.rows.length,
      active_products: b.activeCount,
      top_sponsors: Array.from(b.sponsors.entries())
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 5)
        .map(([name, products]) => ({ name, products })),
      brand_examples: Array.from(b.brands).slice(0, 6),
      source_name: b.sourceName,
    }))
    .sort((a, b2) => b2.total_products - a.total_products);

  // Aggregate the global MAH set (a single drug can have one MAH per
  // country or multiple — we surface the most common ones globally).
  const globalSponsors = new Map<string, { products: number; countries: Set<string> }>();
  for (const r of rows) {
    if (!r.sponsor) continue;
    const key = r.sponsor.trim();
    if (!globalSponsors.has(key)) {
      globalSponsors.set(key, { products: 0, countries: new Set() });
    }
    const bucket = globalSponsors.get(key)!;
    bucket.products += 1;
    if (r.source_country) bucket.countries.add(r.source_country.toUpperCase());
  }

  const top_global_sponsors = Array.from(globalSponsors.entries())
    .sort((a, b2) => b2[1].products - a[1].products)
    .slice(0, 8)
    .map(([name, info]) => ({
      name,
      products: info.products,
      countries: Array.from(info.countries).sort(),
    }));

  return NextResponse.json({
    drug_id: drug.id,
    drug_name: drug.generic_name,
    atc_code: drug.atc_code,
    total_countries: countries.length,
    total_products: rows.length,
    countries,
    top_global_sponsors,
    coverage_note:
      "Catalogue data is currently sourced from TGA (AU), MHRA (GB), FDA-NDC (US), Health-Canada DPD (CA) and EMA (EU). Other countries may register the drug locally without appearing here.",
  });
}
