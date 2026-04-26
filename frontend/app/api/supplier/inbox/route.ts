import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/supplier/inbox
 *
 * Returns buyer enquiries that match the logged-in supplier's territory.
 * - Suppliers see enquiries where the buyer's country is in their countries_served.
 * - Free suppliers see only the latest 10 enquiries.
 * - Pro/enterprise suppliers see all enquiries.
 *
 * Each enquiry returns: drug, urgency, quantity, organisation, country, buyer email
 * (only revealed if the supplier has been "matched" — for now, always reveal).
 */
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();

  // Get supplier profile
  const { data: profile } = await admin
    .from("supplier_profiles")
    .select("id, countries_served, tier")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({
      enquiries: [],
      profile_required: true,
      message: "Set up your supplier profile to receive buyer enquiries.",
    });
  }

  const territory = (profile.countries_served as string[]) ?? [];
  const tier = (profile.tier as string) ?? "free";

  // Fetch enquiries — filter by territory if set, else all (matches global suppliers)
  let query = admin
    .from("supplier_enquiries")
    .select("id, drug_id, drug_name, quantity, urgency, organisation, message, country, user_email, status, created_at")
    .order("created_at", { ascending: false });

  if (territory.length > 0) {
    query = query.in("country", territory);
  }

  // Free tier limit
  const limit = tier === "free" ? 10 : 1000;
  query = query.limit(limit);

  const { data: enquiries, error } = await query;
  if (error) {
    console.error("supplier/inbox error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get supplier's existing quotes for these enquiries
  const enquiryIds = (enquiries ?? []).map((e: { id: string }) => e.id);
  let quotedIds = new Set<string>();
  if (enquiryIds.length > 0) {
    const { data: quotes } = await admin
      .from("supplier_quotes")
      .select("enquiry_id")
      .in("enquiry_id", enquiryIds)
      .eq("supplier_id", profile.id);
    quotedIds = new Set((quotes ?? []).map((q: { enquiry_id: string }) => q.enquiry_id));
  }

  return NextResponse.json({
    enquiries: (enquiries ?? []).map((e) => ({
      ...e,
      already_quoted: quotedIds.has((e as { id: string }).id),
    })),
    territory,
    tier,
    total: enquiries?.length ?? 0,
  });
}
