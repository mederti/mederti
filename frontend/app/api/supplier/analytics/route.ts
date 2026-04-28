import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/supplier/analytics
 *
 * Aggregates supplier_analytics_events into time-windowed counts:
 *  - profile_view, inventory_view, contact_click, enquiry_received, quote_submitted, quote_won
 *
 * Returns 30-day totals + 7-day trend.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("supplier_profiles")
    .select("id, view_count, verified, tier, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ profile_required: true });
  }
  const supplierId = (profile as { id: string }).id;

  // Get 30 days of events
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: events } = await admin
    .from("supplier_analytics_events")
    .select("event_type, occurred_at, drug_id, buyer_country")
    .eq("supplier_id", supplierId)
    .gte("occurred_at", thirtyDaysAgo);

  const all = events ?? [];
  const last7 = all.filter((e) => (e as { occurred_at: string }).occurred_at >= sevenDaysAgo);

  function count(arr: typeof all, type: string) {
    return arr.filter((e) => (e as { event_type: string }).event_type === type).length;
  }

  const counts30 = {
    profile_view: count(all, "profile_view"),
    inventory_view: count(all, "inventory_view"),
    contact_click: count(all, "contact_click"),
    enquiry_received: count(all, "enquiry_received"),
    quote_submitted: count(all, "quote_submitted"),
    quote_won: count(all, "quote_won"),
  };
  const counts7 = {
    profile_view: count(last7, "profile_view"),
    inventory_view: count(last7, "inventory_view"),
    contact_click: count(last7, "contact_click"),
    enquiry_received: count(last7, "enquiry_received"),
    quote_submitted: count(last7, "quote_submitted"),
    quote_won: count(last7, "quote_won"),
  };

  // Top buyer countries (by enquiry_received)
  const countryFreq = new Map<string, number>();
  for (const e of all) {
    const ev = e as { event_type: string; buyer_country: string | null };
    if (ev.event_type === "enquiry_received" && ev.buyer_country) {
      countryFreq.set(ev.buyer_country, (countryFreq.get(ev.buyer_country) ?? 0) + 1);
    }
  }
  const topCountries = [...countryFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

  // Top viewed drugs
  const drugFreq = new Map<string, number>();
  for (const e of all) {
    const ev = e as { event_type: string; drug_id: string | null };
    if (ev.event_type === "inventory_view" && ev.drug_id) {
      drugFreq.set(ev.drug_id, (drugFreq.get(ev.drug_id) ?? 0) + 1);
    }
  }
  const topDrugIds = [...drugFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const drugLookup = new Map<string, string>();
  if (topDrugIds.length > 0) {
    const { data: drugs } = await admin.from("drugs").select("id, generic_name").in("id", topDrugIds.map(([id]) => id));
    for (const d of drugs ?? []) {
      drugLookup.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }
  const topDrugs = topDrugIds.map(([id, count]) => ({
    drug_id: id, drug_name: drugLookup.get(id) ?? "Unknown", views: count,
  }));

  // Conversion rate
  const conversionRate = counts30.enquiry_received > 0
    ? Math.round((counts30.quote_submitted / counts30.enquiry_received) * 100)
    : 0;

  return NextResponse.json({
    counts_30d: counts30,
    counts_7d: counts7,
    conversion_rate: conversionRate,
    top_countries: topCountries,
    top_drugs: topDrugs,
    member_since: profile.created_at,
    verified: profile.verified,
    tier: profile.tier,
  });
}
