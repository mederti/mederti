import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/suppliers/directory?country=AU
 *
 * Public list of all supplier_profiles, optionally filtered by country.
 * Returns inventory count + verified status. Used by /suppliers/directory.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const search = url.searchParams.get("q");

  const admin = getSupabaseAdmin();

  let query = admin
    .from("supplier_profiles")
    .select("id, slug, company_name, description, website, countries_served, verified, tier, year_founded, specialties, logo_url");

  if (country) {
    query = query.contains("countries_served", [country]);
  }
  if (search) {
    query = query.ilike("company_name", `%${search}%`);
  }

  const { data: suppliers, error } = await query;
  if (error) {
    console.error("suppliers/directory:", error);
    return NextResponse.json({ suppliers: [] }, { status: 500 });
  }

  // Add inventory counts
  const supplierIds = (suppliers ?? []).map((s) => s.id);
  const inventoryCounts = new Map<string, number>();
  if (supplierIds.length > 0) {
    const { data: inv } = await admin
      .from("supplier_inventory")
      .select("supplier_id")
      .in("supplier_id", supplierIds)
      .neq("status", "depleted");
    for (const i of inv ?? []) {
      const sid = (i as { supplier_id: string }).supplier_id;
      inventoryCounts.set(sid, (inventoryCounts.get(sid) ?? 0) + 1);
    }
  }

  // Sort: verified+enterprise first, then verified+pro, then by inventory count
  const tierRank: Record<string, number> = { enterprise: 3, pro: 2, free: 1 };
  const enriched = (suppliers ?? [])
    .map((s) => ({ ...s, inventory_count: inventoryCounts.get(s.id) ?? 0 }))
    .sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      const ta = tierRank[a.tier] ?? 0;
      const tb = tierRank[b.tier] ?? 0;
      if (ta !== tb) return tb - ta;
      return b.inventory_count - a.inventory_count;
    });

  return NextResponse.json({ suppliers: enriched, total: enriched.length });
}
