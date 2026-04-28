import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  STRATEGIST_PERSONA,
  generateJson,
  getCachedInsight,
  saveCachedInsight,
  type EnquiryStrategicNote,
} from "@/lib/ai/supplier-insights";

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
 * GET /api/supplier/insight/enquiry/[id]
 *
 * Returns a per-enquiry strategic note for the logged-in supplier.
 * Cached 1 hour. McKinsey-voice: buyer interpretation, win factors, urgency assessment.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: enquiryId } = await ctx.params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();
  const { data: profile } = await sb
    .from("supplier_profiles")
    .select("id, company_name, countries_served, verified, tier")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ profile_required: true });

  const supplierId = (profile as { id: string }).id;

  // Cache check
  const cached = await getCachedInsight<EnquiryStrategicNote>(supplierId, "enquiry_note", enquiryId);
  if (cached) {
    return NextResponse.json({ ...cached.payload, cached: true, generated_at: cached.generated_at });
  }

  // Get the enquiry
  const { data: enquiry } = await sb
    .from("supplier_enquiries")
    .select("id, drug_name, drug_id, country, urgency, quantity, organisation, message, created_at")
    .eq("id", enquiryId)
    .maybeSingle();
  if (!enquiry) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });

  // Drug shortage context
  let shortageContext = "(no shortage data — drug not in our database or not currently short)";
  let countriesAffected: string[] = [];
  if (enquiry.drug_id) {
    const { data: shortages } = await sb
      .from("shortage_events")
      .select("country_code, severity, status, reason_category, start_date")
      .eq("drug_id", enquiry.drug_id)
      .in("status", ["active", "anticipated"]);

    countriesAffected = Array.from(new Set((shortages ?? []).map((s) => (s as { country_code: string }).country_code)));
    const severities = (shortages ?? []).map((s) => (s as { severity: string }).severity);
    const reasons = (shortages ?? []).map((s) => (s as { reason_category: string | null }).reason_category).filter(Boolean);

    shortageContext = `
- Active shortages: ${shortages?.length ?? 0}
- Countries affected: ${countriesAffected.join(", ") || "none"}
- Severity mix: ${severities.join(", ") || "n/a"}
- Root causes: ${[...new Set(reasons)].join(", ") || "n/a"}
`;
  }

  // Competitive landscape: how many other verified suppliers serve this country with this drug
  let competitorCount = 0;
  let verifiedCompetitorCount = 0;
  if (enquiry.drug_id) {
    const { data: competitors } = await sb
      .from("supplier_inventory")
      .select(`id, supplier_profiles!inner(verified, countries_served, id)`)
      .eq("drug_id", enquiry.drug_id)
      .neq("status", "depleted");
    for (const c of competitors ?? []) {
      // Supabase join returns either an object or an array depending on relation cardinality.
      // We pick the first element if it's an array to be safe.
      const raw = (c as unknown as { supplier_profiles: unknown }).supplier_profiles;
      const sp = Array.isArray(raw)
        ? (raw[0] as { verified: boolean; countries_served: string[]; id: string } | undefined)
        : (raw as { verified: boolean; countries_served: string[]; id: string } | undefined);
      if (!sp) continue;
      if (sp.id === supplierId) continue;
      const cs = sp.countries_served ?? [];
      if (cs.length === 0 || cs.includes(enquiry.country)) {
        competitorCount++;
        if (sp.verified) verifiedCompetitorCount++;
      }
    }
  }

  // Buyer history (other enquiries from same organisation)
  let buyerHistoryCount = 0;
  if (enquiry.organisation) {
    const { count } = await sb
      .from("supplier_enquiries")
      .select("id", { count: "exact", head: true })
      .eq("organisation", enquiry.organisation);
    buyerHistoryCount = count ?? 0;
  }

  const dataContext = `
ENQUIRY DETAIL
==============
Drug: ${enquiry.drug_name}
Buyer country: ${enquiry.country}
Urgency: ${enquiry.urgency}
Quantity needed: ${enquiry.quantity ?? "not specified"}
Buyer organisation: ${enquiry.organisation ?? "not provided"}
Buyer message: ${enquiry.message ?? "(none)"}
Submitted: ${enquiry.created_at}

DRUG SHORTAGE CONTEXT
=====================
${shortageContext}

COMPETITIVE LANDSCAPE
=====================
- Other suppliers in our marketplace offering this drug in ${enquiry.country}: ${competitorCount}
- Of those, verified suppliers: ${verifiedCompetitorCount}

BUYER HISTORY
=============
- Total enquiries from "${enquiry.organisation ?? "this buyer"}" on Mederti: ${buyerHistoryCount}

THIS SUPPLIER
=============
- Company: ${(profile as { company_name: string }).company_name}
- Verified: ${(profile as { verified: boolean }).verified}
- Tier: ${(profile as { tier: string }).tier}
`;

  const userPrompt = `Generate a strategic note on this single enquiry.

${dataContext}

Output JSON:

{
  "buyer_interpretation": "1-2 sentences interpreting what this enquiry signals about the buyer's situation. Read between the lines on urgency + quantity + organisation type.",
  "win_factors": ["3-4 short bullet phrases — the things that will determine whether this supplier wins this deal"],
  "competitive_landscape": "1-2 sentences naming the competitive dynamic. How crowded? How differentiated does this supplier need to be?",
  "recommended_response_time_hours": 4,
  "confidence": "high" | "medium" | "low"
}

Voice: McKinsey. Decisive. Cite numbers. The supplier reads this on top of the enquiry card and decides whether to quote.`;

  const note = await generateJson<EnquiryStrategicNote>({
    system: STRATEGIST_PERSONA,
    user: userPrompt,
    maxTokens: 600,
  });

  await saveCachedInsight(supplierId, "enquiry_note", enquiryId, note, 1);
  return NextResponse.json({ ...note, cached: false });
}
