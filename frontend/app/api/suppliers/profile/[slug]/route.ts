import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/suppliers/profile/[slug]
 *
 * Public supplier profile with all their inventory listings.
 * Used by /suppliers/[slug] SEO pages.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const admin = getSupabaseAdmin();

  // Get supplier
  const { data: supplier, error } = await admin
    .from("supplier_profiles")
    .select("id, slug, company_name, description, website, contact_email, contact_phone, countries_served, verified, tier, year_founded, specialties, logo_url, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Get their inventory + drug names
  const { data: inv } = await admin
    .from("supplier_inventory")
    .select("id, drug_id, countries, quantity_available, unit_price, currency, pack_size, notes, status, available_until")
    .eq("supplier_id", supplier.id)
    .neq("status", "depleted")
    .order("updated_at", { ascending: false });

  const drugIds = (inv ?? []).map((i) => i.drug_id);
  const nameMap = new Map<string, string>();
  if (drugIds.length > 0) {
    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIds);
    for (const d of drugs ?? []) {
      nameMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  // Track profile view (fire-and-forget)
  admin.from("supplier_analytics_events").insert({
    supplier_id: supplier.id,
    event_type: "profile_view",
  }).then(() => {}, () => {});

  // Update view count
  admin.rpc("increment", { table_name: "supplier_profiles", id: supplier.id, column_name: "view_count" }).then(() => {}, () => {});

  return NextResponse.json({
    supplier,
    inventory: (inv ?? []).map((i) => ({
      ...i,
      drug_name: nameMap.get(i.drug_id) ?? "Unknown",
    })),
  });
}
