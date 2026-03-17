import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

interface SearchHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
  source: "drugs" | "catalogue";
  source_country?: string;
  source_name?: string;
  registration_number?: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10), 50);

  if (!q || q.length < 2) {
    return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // ── 1. Search canonical drugs table (shortage-tracked) ──────────────
  let drugRows: Record<string, unknown>[] = [];
  try {
    const resp = await sb
      .from("drugs")
      .select("id, generic_name, brand_names, atc_code")
      .textSearch("search_vector", q, { config: "english" })
      .limit(limit);
    drugRows = resp.data ?? [];
  } catch {
    // fall through to ilike
  }

  if (drugRows.length === 0) {
    const resp = await sb
      .from("drugs")
      .select("id, generic_name, brand_names, atc_code")
      .ilike("generic_name", `%${q}%`)
      .limit(limit);
    if (resp.error) {
      return NextResponse.json({ error: resp.error.message }, { status: 500 });
    }
    drugRows = resp.data ?? [];
  }

  // Fetch active shortage counts for drug results
  const drugIds = drugRows.map((r) => r.id as string);
  const shortageCounts: Record<string, number> = Object.fromEntries(drugIds.map((id) => [id, 0]));

  if (drugIds.length > 0) {
    try {
      const sc = await sb
        .from("shortage_events")
        .select("drug_id")
        .in("drug_id", drugIds)
        .in("status", ["active", "anticipated"]);
      for (const row of sc.data ?? []) {
        shortageCounts[row.drug_id] = (shortageCounts[row.drug_id] ?? 0) + 1;
      }
    } catch {
      // counts stay 0
    }
  }

  const drugResults: SearchHit[] = drugRows.map((r) => ({
    drug_id: r.id as string,
    generic_name: r.generic_name as string,
    brand_names: (r.brand_names as string[]) ?? [],
    atc_code: (r.atc_code as string) ?? null,
    active_shortage_count: shortageCounts[r.id as string] ?? 0,
    source: "drugs" as const,
  }));

  // ── 2. Search drug_catalogue for additional hits ────────────────────
  const remaining = limit - drugResults.length;
  let catResults: SearchHit[] = [];

  if (remaining > 0) {
    // Collect drug_ids already in results to avoid duplicates
    const seenDrugIds = new Set(drugIds);
    const seenNames = new Set(drugRows.map((r) => (r.generic_name as string).toLowerCase()));

    let catRows: Record<string, unknown>[] = [];
    try {
      const resp = await sb
        .from("drug_catalogue")
        .select("id, drug_id, generic_name, brand_name, atc_code, source_country, source_name, registration_number")
        .textSearch("search_vector", q, { config: "english" })
        .limit(remaining + 20); // fetch extra to allow dedup
      catRows = resp.data ?? [];
    } catch {
      // fall through to ilike
    }

    if (catRows.length === 0) {
      const resp = await sb
        .from("drug_catalogue")
        .select("id, drug_id, generic_name, brand_name, atc_code, source_country, source_name, registration_number")
        .ilike("generic_name", `%${q}%`)
        .limit(remaining + 20);
      catRows = resp.data ?? [];
    }

    // Deduplicate: skip catalogue entries whose drug_id or generic_name already appears
    const dedupedCat: Record<string, unknown>[] = [];
    const seenCatNames = new Set<string>();
    for (const r of catRows) {
      const drugId = r.drug_id as string | null;
      const gn = ((r.generic_name as string) ?? "").toLowerCase();
      if (drugId && seenDrugIds.has(drugId)) continue;
      if (seenNames.has(gn)) continue;
      if (seenCatNames.has(gn)) continue;
      seenCatNames.add(gn);
      dedupedCat.push(r);
      if (dedupedCat.length >= remaining) break;
    }

    catResults = dedupedCat.map((r) => ({
      drug_id: (r.drug_id as string) ?? (r.id as string),
      generic_name: r.generic_name as string,
      brand_names: (r.brand_name as string) ? [r.brand_name as string] : [],
      atc_code: (r.atc_code as string) ?? null,
      active_shortage_count: 0,
      source: "catalogue" as const,
      source_country: r.source_country as string,
      source_name: r.source_name as string,
      registration_number: r.registration_number as string,
    }));
  }

  const results = [...drugResults, ...catResults];
  return NextResponse.json({ query: q, results, total: results.length });
}
