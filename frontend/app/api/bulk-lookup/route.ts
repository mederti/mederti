import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── Normalize drug name: strip dosage, forms, extra whitespace ── */
function normalize(name: string): string {
  return name
    .replace(/\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|%|iu|units?|mmol)\b/gi, "")
    .replace(
      /\b(tabs?|tablets?|caps?|capsules?|injection|inj|solution|soln|suspension|susp|inhaler|inh|cream|ointment|oral|iv|im|sc|sr|mr|er|xl|pr|ec|inf|blister|modified.release|slow.release|extended.release)\b/gi,
      ""
    )
    .replace(/[/()[\]]/g, " ")
    .replace(/\b(mg|mcg|µg|ml|g|%|iu|units?|mmol)\b/gi, "")
    .replace(/\d+\s*(dose|pack|vial|amp|ampoule|sachet|strip)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * EDI drug name parsing: returns an array of candidate strings to try, in order.
 * E.g. "MAYNEPHARMA OXYCODONE IR TAB 5MG BLISTER" →
 *   ["MAYNEPHARMA OXYCODONE IR", "OXYCODONE IR", "OXYCODONE"]
 */
function parseEDIDrugName(raw: string): string[] {
  const candidates: string[] = [];

  // 1. Full string normalized
  const full = normalize(raw);
  if (full) candidates.push(full);

  // 2. Strip leading ALL-CAPS manufacturer prefix(es)
  const withoutMfr = raw.replace(/^(?:[A-Z]{2,}\s+)+/, "").trim();
  if (withoutMfr !== raw.trim() && withoutMfr.length > 0) {
    const normMfr = normalize(withoutMfr);
    if (normMfr && !candidates.includes(normMfr)) candidates.push(normMfr);
  }

  // 3. First 3 words (from manufacturer-stripped version)
  const base = withoutMfr || raw;
  const words = normalize(base).split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const c3 = words.slice(0, 3).join(" ");
    if (!candidates.includes(c3)) candidates.push(c3);
  }

  // 4. First 2 words
  if (words.length >= 2) {
    const c2 = words.slice(0, 2).join(" ");
    if (!candidates.includes(c2)) candidates.push(c2);
  }

  // 5. First word only (often the generic name itself)
  if (words.length >= 1) {
    const c1 = words[0];
    if (!candidates.includes(c1)) candidates.push(c1);
  }

  return candidates.filter((c) => c.length > 1);
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

    // Build OR filter for drugs table — include all EDI candidates
    const allCandidates = batch.flatMap((name) => parseEDIDrugName(name));
    const uniqueCandidates = [...new Set(allCandidates)];

    const drugOrFilter = uniqueCandidates
      .map((c) => {
        const escaped = escapeIlike(c);
        if (!escaped) return null;
        return `generic_name.ilike.%${escaped}%`;
      })
      .filter(Boolean)
      .join(",");

    // Build OR filter for drug_products table
    const productOrFilter = uniqueCandidates
      .map((c) => {
        const escaped = escapeIlike(c);
        if (!escaped) return null;
        return `product_name.ilike.%${escaped}%`;
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

    // Match each name using progressive EDI candidate parsing
    for (const originalName of batch) {
      const candidates = parseEDIDrugName(originalName);
      if (candidates.length === 0) {
        results[originalName] = { drug: null, confidence: "none" };
        continue;
      }

      let bestMatch: MatchedDrug | null = null;
      let bestConfidence: "exact" | "fuzzy" | "none" = "none";

      for (const candidate of candidates) {
        const normLower = candidate.toLowerCase();
        if (!normLower) continue;

        // 1. Exact generic_name match
        let match = drugs.find(
          (d) => d.generic_name.toLowerCase() === normLower
        );
        let confidence: "exact" | "fuzzy" | "none" = "exact";

        // 2. Contains match on generic_name
        if (!match) {
          match = drugs.find(
            (d) =>
              d.generic_name.toLowerCase().includes(normLower) ||
              normLower.includes(d.generic_name.toLowerCase())
          );
          confidence = "fuzzy";
        }

        // 3. Brand name match
        if (!match) {
          match = drugs.find((d) =>
            (d.brand_names ?? []).some(
              (b) =>
                b.toLowerCase().includes(normLower) ||
                normLower.includes(b.toLowerCase())
            )
          );
          confidence = "fuzzy";
        }

        // 4. Product name match → look up parent drug
        if (!match && products.length > 0) {
          const prodMatch = products.find(
            (p) =>
              p.product_name.toLowerCase().includes(normLower) ||
              normLower.includes(p.product_name.toLowerCase())
          );
          if (prodMatch) {
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

        if (match) {
          bestMatch = match;
          bestConfidence = confidence;
          break; // First candidate that matches wins
        }
      }

      results[originalName] = bestMatch
        ? { drug: bestMatch, confidence: bestConfidence }
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
