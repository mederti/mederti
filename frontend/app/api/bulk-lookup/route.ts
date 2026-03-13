import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── Known Australian pharmaceutical brand/manufacturer prefixes ──
 * These appear at the start of EDI descriptions and should be stripped
 * to get the generic name. E.g. "APOTEX METFORMIN TAB" → "METFORMIN TAB"
 */
const KNOWN_PREFIXES = new Set([
  "apotex", "sandoz", "arrow", "mylan", "pfizer", "sanofi", "teva",
  "alphapharm", "generic health", "genhealth", "gehlth", "chemmart",
  "maynepharma", "mayne", "pharmacor", "pcor", "lupin", "sun", "sunph",
  "accord", "viatris", "aspen", "boucher", "strides", "cipla", "dr reddy",
  "drreddy", "aurobindo", "torrent", "alkem", "glenmark", "fresenius",
  "fkabi", "baxter", "bbraun", "hikma", "hospira", "amneal",
  "vitpty", "vitalion", "aft", "perril", "evaris", "sanocc",
]);

/* ── Normalize drug name: strip dosage, forms, pack info, extra whitespace ── */
function normalize(name: string): string {
  return name
    // Strip product codes like "SANDOZ-44120252" or "SANOFI-354519"
    .replace(/\b[A-Z]+-\d{4,}\b/gi, "")
    // Strip dosage + units (5MG, 100MCG, 10MG/ML, 1.5G, 100IU/ML)
    .replace(/\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|l|%|iu|units?|mmol)(\/\d*\s*(mg|mcg|µg|g|ml|l))?/gi, "")
    // Strip dosage forms + delivery methods
    .replace(
      /\b(tabs?|tablets?|caps?|capsules?|injection|inj|solution|soln|suspension|susp|inhaler|inh|cream|ointment|oral|iv|im|sc|sr|mr|er|xl|pr|ec|inf|blister|modified.release|slow.release|extended.release|pwd|powder|vial|ampoule|amp|syringe|pen|solostar|flexpen|kwikpen|turbuhaler|accuhaler|diskus|autohaler|spray|drops?|eye drop|ear drop|nasal|topical|suppository|supp|patch|transdermal|lozenge|wafer|sachet|granules?|liquid|elixir|linctus|mixture|mouthwash|gargle|enema|pessary|foam|gel|lotion|paste|shampoo)\b/gi,
      ""
    )
    // Strip packaging info (100 PACK, 30GM TUBE, 15ML, 200 DOSE COUNTER, CFC FREE)
    .replace(/\d+\s*(dose|pack|vial|amp|ampoule|sachet|strip|tube|bottle|box|count(er)?)\b/gi, "")
    .replace(/\b(cfc\s*free|counter|pack|blister)\b/gi, "")
    // Strip remaining stray units
    .replace(/\b(mg|mcg|µg|ml|g|%|iu|units?|mmol|gm)\b/gi, "")
    // Clean punctuation
    .replace(/[/()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to detect and strip manufacturer/brand prefix from EDI descriptions.
 * Uses known prefix list + heuristic: if the first word is ALL-CAPS and the
 * second word is also ALL-CAPS with 4+ letters, the first word is likely a
 * manufacturer prefix.
 */
function stripManufacturerPrefix(raw: string): string {
  const trimmed = raw.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return trimmed;

  // Check if first word (lowercased) is a known prefix
  const firstLower = words[0].toLowerCase().replace(/[^a-z]/g, "");
  if (KNOWN_PREFIXES.has(firstLower)) {
    return words.slice(1).join(" ");
  }

  // Check compound prefixes (e.g. "GENERIC HEALTH", "DR REDDY")
  if (words.length >= 3) {
    const twoWordPrefix = (words[0] + " " + words[1]).toLowerCase().replace(/[^a-z ]/g, "");
    if (KNOWN_PREFIXES.has(twoWordPrefix)) {
      return words.slice(2).join(" ");
    }
  }

  // Heuristic: first word is ALL-CAPS but looks like a company name (ends in
  // PHARMA, PTY, LTD, etc.) — strip it
  if (/^[A-Z]{2,}$/.test(words[0]) && /^(PHARMA|PTY|LTD|INC|CORP|LABS?)$/i.test(words[1])) {
    return words.slice(2).join(" ");
  }

  return trimmed;
}

/**
 * EDI drug name parsing: returns an array of candidate strings to try, in order.
 * E.g. "MAYNEPHARMA OXYCODONE IR TAB 5MG BLISTER" →
 *   ["MAYNEPHARMA OXYCODONE IR", "OXYCODONE IR", "OXYCODONE"]
 * E.g. "PANAMAX TAB 500MG BLISTER 100 PACK" →
 *   ["PANAMAX", "PANAMAX"] (brand name IS the first word)
 */
function parseEDIDrugName(raw: string): string[] {
  const candidates: string[] = [];

  // 1. Full string normalized (preserves brand names)
  const full = normalize(raw);
  if (full) candidates.push(full);

  // 2. Try stripping known manufacturer prefix
  const withoutMfr = stripManufacturerPrefix(raw);
  if (withoutMfr !== raw.trim() && withoutMfr.length > 0) {
    const normMfr = normalize(withoutMfr);
    if (normMfr && !candidates.includes(normMfr)) candidates.push(normMfr);
  }

  // 3. Progressive word reduction from the manufacturer-stripped version
  const base = withoutMfr || raw;
  const words = normalize(base).split(/\s+/).filter(Boolean);

  if (words.length >= 3) {
    const c3 = words.slice(0, 3).join(" ");
    if (!candidates.includes(c3)) candidates.push(c3);
  }

  if (words.length >= 2) {
    const c2 = words.slice(0, 2).join(" ");
    if (!candidates.includes(c2)) candidates.push(c2);
  }

  if (words.length >= 1) {
    const c1 = words[0];
    if (!candidates.includes(c1)) candidates.push(c1);
  }

  // 4. Also try the raw first word (often the brand name: PANAMAX, VENTOLIN, FLAGYL)
  const rawFirst = raw.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, "");
  if (rawFirst && rawFirst.length > 2 && !candidates.includes(rawFirst)) {
    candidates.push(rawFirst);
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
  if (drugNames.length > 2000) {
    return NextResponse.json({ error: "Maximum 2000 drugs per lookup" }, { status: 400 });
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
