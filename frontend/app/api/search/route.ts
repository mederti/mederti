import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10), 50);

  if (!q || q.length < 2) {
    return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }

  // Full-text search on search_vector
  let rows: Record<string, unknown>[] = [];
  try {
    const resp = await getSupabaseAdmin()
      .from("drugs")
      .select("id, generic_name, brand_names, atc_code")
      .textSearch("search_vector", q, { config: "english" })
      .limit(limit);
    rows = resp.data ?? [];
  } catch {
    // fall through to ilike
  }

  // Fallback: ilike if FTS returned nothing
  if (rows.length === 0) {
    const resp = await getSupabaseAdmin()
      .from("drugs")
      .select("id, generic_name, brand_names, atc_code")
      .ilike("generic_name", `%${q}%`)
      .limit(limit);
    if (resp.error) {
      return NextResponse.json({ error: resp.error.message }, { status: 500 });
    }
    rows = resp.data ?? [];
  }

  if (rows.length === 0) {
    return NextResponse.json({ query: q, results: [], total: 0 });
  }

  // Fetch active shortage counts
  const drugIds = rows.map((r) => r.id as string);
  const shortageCounts: Record<string, number> = Object.fromEntries(drugIds.map((id) => [id, 0]));

  try {
    const sc = await getSupabaseAdmin()
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

  const results = rows.map((r) => ({
    drug_id: r.id,
    generic_name: r.generic_name,
    brand_names: r.brand_names ?? [],
    atc_code: r.atc_code ?? null,
    active_shortage_count: shortageCounts[r.id as string] ?? 0,
  }));

  return NextResponse.json({ query: q, results, total: results.length });
}
