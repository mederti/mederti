import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/suppliers/by-drug/[id]
 *
 * Public endpoint — returns suppliers who currently have stock of a given drug.
 * Verified + paid (pro/enterprise) suppliers are listed first.
 *
 * Used by the drug detail page to show the "Available suppliers" section.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ suppliers: [] });

  const admin = getSupabaseAdmin();

  const { data: rows, error } = await admin
    .from("supplier_inventory")
    .select(`
      id, countries, quantity_available, unit_price, currency, pack_size,
      status, available_until, updated_at,
      supplier_profiles!inner (
        id, company_name, website, verified, tier, countries_served
      )
    `)
    .eq("drug_id", id)
    .neq("status", "depleted")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("suppliers/by-drug error:", error);
    return NextResponse.json({ suppliers: [], error: error.message }, { status: 500 });
  }

  // Sort: verified + pro/enterprise first, then by recency
  const tierRank: Record<string, number> = { enterprise: 3, pro: 2, free: 1 };
  const suppliers = (rows ?? [])
    .map((r) => {
      const profile = r.supplier_profiles as unknown as {
        id: string; company_name: string; website: string | null;
        verified: boolean; tier: string; countries_served: string[];
      };
      return {
        inventory_id: r.id,
        supplier_id: profile.id,
        company_name: profile.company_name,
        website: profile.website,
        verified: profile.verified,
        tier: profile.tier,
        countries: r.countries,
        quantity_available: r.quantity_available,
        unit_price: r.unit_price,
        currency: r.currency,
        pack_size: r.pack_size,
        status: r.status,
        available_until: r.available_until,
        updated_at: r.updated_at,
      };
    })
    .sort((a, b) => {
      // Verified first
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      // Then tier
      const ta = tierRank[a.tier] ?? 0;
      const tb = tierRank[b.tier] ?? 0;
      if (ta !== tb) return tb - ta;
      // Then recency
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return NextResponse.json({ suppliers, total: suppliers.length });
}
