import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── Normalize drug name: strip dosage, forms, extra whitespace ── */
function normalize(name: string): string {
  return name
    .replace(/\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|%|iu|units?|mmol)\b/gi, "")
    .replace(
      /\b(tabs?|tablets?|caps?|capsules?|injection|inj|solution|soln|suspension|susp|inhaler|cream|ointment|oral|iv|im|sc|sr|mr|er|xl|pr|ec|modified.release|slow.release|extended.release)\b/gi,
      ""
    )
    .replace(/[/()[\]]/g, " ")
    .replace(/\b(mg|mcg|µg|ml|g|%|iu|units?|mmol)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Escape special PostgREST chars in ilike patterns ── */
function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

const BATCH_SIZE = 20;

interface MatchedDrug {
  id: string;
  generic_name: string;
  brand_names: string[] | null;
  atc_code: string | null;
}

interface MatchResult {
  drug: MatchedDrug | null;
  confidence: "exact" | "fuzzy" | "none";
}

export async function POST(req: NextRequest) {
  let body: { drugNames?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { drugNames } = body;
  if (!drugNames || !Array.isArray(drugNames) || drugNames.length === 0) {
    return NextResponse.json({ error: "drugNames array required" }, { status: 400 });
  }
  if (drugNames.length > 500) {
    return NextResponse.json({ error: "Maximum 500 drugs per lookup" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const results: Record<string, MatchResult> = {};

  /* ── Step 1: Match drug names in batches ── */
  for (let i = 0; i < drugNames.length; i += BATCH_SIZE) {
    const batch = drugNames.slice(i, i + BATCH_SIZE);

    // Build OR filter for drugs table (generic_name)
    const drugOrFilter = batch
      .map((name) => {
        const norm = escapeIlike(normalize(name));
        if (!norm) return null;
        return `generic_name.ilike.%${norm}%`;
      })
      .filter(Boolean)
      .join(",");

    // Build OR filter for drug_products table (product_name)
    const productOrFilter = batch
      .map((name) => {
        const norm = escapeIlike(normalize(name));
        if (!norm) return null;
        return `product_name.ilike.%${norm}%`;
      })
      .filter(Boolean)
      .join(",");

    const [drugsRes, productsRes] = await Promise.allSettled([
      drugOrFilter
        ? supabase
            .from("drugs")
            .select("id, generic_name, brand_names, atc_code")
            .or(drugOrFilter)
            .limit(batch.length * 3)
        : Promise.resolve({ data: [] as MatchedDrug[], error: null }),
      productOrFilter
        ? supabase
            .from("drug_products")
            .select("id, product_name, trade_name")
            .or(productOrFilter)
            .limit(batch.length * 3)
        : Promise.resolve({ data: [] as { id: string; product_name: string; trade_name: string | null }[], error: null }),
    ]);

    const drugs: MatchedDrug[] =
      drugsRes.status === "fulfilled"
        ? ((drugsRes.value as { data: MatchedDrug[] | null }).data ?? [])
        : [];
    const products =
      productsRes.status === "fulfilled"
        ? ((productsRes.value as { data: { id: string; product_name: string; trade_name: string | null }[] | null }).data ?? [])
        : [];

    // Match each name in the batch to the best drug result
    for (const originalName of batch) {
      const norm = normalize(originalName).toLowerCase();
      if (!norm) {
        results[originalName] = { drug: null, confidence: "none" };
        continue;
      }

      // 1. Exact generic_name match
      let match = drugs.find(
        (d) => d.generic_name.toLowerCase() === norm
      );
      let confidence: "exact" | "fuzzy" | "none" = "exact";

      // 2. Contains match on generic_name
      if (!match) {
        match = drugs.find(
          (d) =>
            d.generic_name.toLowerCase().includes(norm) ||
            norm.includes(d.generic_name.toLowerCase())
        );
        confidence = "fuzzy";
      }

      // 3. Brand name match
      if (!match) {
        match = drugs.find((d) =>
          (d.brand_names ?? []).some(
            (b) =>
              b.toLowerCase().includes(norm) ||
              norm.includes(b.toLowerCase())
          )
        );
        confidence = "fuzzy";
      }

      // 4. Product name match → look up parent drug
      if (!match && products.length > 0) {
        const prodMatch = products.find(
          (p) =>
            p.product_name.toLowerCase().includes(norm) ||
            norm.includes(p.product_name.toLowerCase())
        );
        if (prodMatch) {
          // Try to find the drug by searching generic_name with product_name
          const { data: drugFromProd } = await supabase
            .from("drugs")
            .select("id, generic_name, brand_names, atc_code")
            .ilike("generic_name", `%${escapeIlike(prodMatch.product_name.split(" ")[0])}%`)
            .limit(1);
          if (drugFromProd && drugFromProd.length > 0) {
            match = drugFromProd[0];
            confidence = "fuzzy";
          }
        }
      }

      results[originalName] = match
        ? { drug: match, confidence }
        : { drug: null, confidence: "none" };
    }
  }

  /* ── Step 2: Fetch shortage_events for all matched drug IDs ── */
  const matchedDrugIds = [
    ...new Set(
      Object.values(results)
        .filter((r) => r.drug)
        .map((r) => r.drug!.id)
    ),
  ];

  const shortagesByDrugId: Record<
    string,
    Array<{
      shortage_id: string;
      drug_id: string;
      country_code: string | null;
      status: string;
      severity: string | null;
      start_date: string | null;
    }>
  > = {};

  if (matchedDrugIds.length > 0) {
    for (let i = 0; i < matchedDrugIds.length; i += 50) {
      const batch = matchedDrugIds.slice(i, i + 50);
      const { data: shortages } = await supabase
        .from("shortage_events")
        .select("shortage_id, drug_id, country_code, status, severity, start_date")
        .in("drug_id", batch)
        .in("status", ["active", "anticipated"]);

      for (const s of shortages ?? []) {
        if (!shortagesByDrugId[s.drug_id]) shortagesByDrugId[s.drug_id] = [];
        shortagesByDrugId[s.drug_id].push(s);
      }
    }
  }

  /* ── Step 3: Assemble response ── */
  const response = Object.entries(results).map(([name, match]) => ({
    drugName: name,
    matchedDrug: match.drug
      ? {
          drug_id: match.drug.id,
          generic_name: match.drug.generic_name,
          brand_names: match.drug.brand_names ?? [],
          atc_code: match.drug.atc_code,
        }
      : null,
    matchConfidence: match.confidence,
    shortages: match.drug ? (shortagesByDrugId[match.drug.id] ?? []) : [],
  }));

  return NextResponse.json({ results: response });
}
