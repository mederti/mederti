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

  // Get supplier. Deliberately omit contact_email / contact_phone: this is an
  // anonymous public SEO route, and the sibling /api/suppliers/directory omits
  // them too. Exposing them here let scrapers harvest every supplier's contact
  // details, bypassing the gated /api/supplier-enquiry lead flow.
  const { data: supplier, error } = await admin
    .from("supplier_profiles")
    .select("id, slug, company_name, description, website, countries_served, verified, tier, year_founded, specialties, logo_url, created_at")
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

  // Update view count. No `increment` RPC exists in any migration, so the
  // previous rpc() call silently no-op'd and view_count never moved (supplier
  // analytics reported 0 views forever). Do a fire-and-forget read-modify-write
  // — a small race on concurrent views is fine for a counter, and the
  // authoritative record is the supplier_analytics_events row inserted above.
  (async () => {
    const { data: cur } = await admin
      .from("supplier_profiles")
      .select("view_count")
      .eq("id", supplier.id)
      .maybeSingle();
    const next = ((cur?.view_count as number | null) ?? 0) + 1;
    await admin.from("supplier_profiles").update({ view_count: next }).eq("id", supplier.id);
  })().catch(() => {});

  return NextResponse.json({
    supplier,
    inventory: (inv ?? []).map((i) => ({
      ...i,
      drug_name: nameMap.get(i.drug_id) ?? "Unknown",
    })),
  });
}
