import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  STRATEGIST_PERSONA,
  generateJson,
  getCachedInsight,
  saveCachedInsight,
  type DrugForesight,
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
 * GET /api/supplier/insight/drug/[id]
 *
 * 30/60/90-day shortage trajectory for a drug with stock-action recommendation.
 * Cached 12h per (supplier, drug). Used on inventory page when reviewing a SKU
 * and on supplier dashboards.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: drugId } = await ctx.params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();
  const { data: profile } = await sb
    .from("supplier_profiles")
    .select("id, countries_served")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ profile_required: true });

  const supplierId = (profile as { id: string }).id;

  const cached = await getCachedInsight<DrugForesight>(supplierId, "drug_foresight", drugId);
  if (cached) {
    return NextResponse.json({ ...cached.payload, cached: true, generated_at: cached.generated_at });
  }

  // Get drug + shortage history
  const { data: drug } = await sb
    .from("drugs")
    .select("generic_name, drug_class")
    .eq("id", drugId)
    .maybeSingle();
  if (!drug) return NextResponse.json({ error: "Drug not found" }, { status: 404 });

  const { data: history } = await sb
    .from("shortage_events")
    .select("country_code, severity, status, reason_category, start_date, end_date")
    .eq("drug_id", drugId)
    .order("start_date", { ascending: false })
    .limit(80);

  const active = (history ?? []).filter((s) => (s as { status: string }).status === "active");
  const resolved = (history ?? []).filter((s) => (s as { status: string }).status === "resolved");
  const countries = new Set((history ?? []).map((s) => (s as { country_code: string }).country_code));
  const reasons = new Set((history ?? []).map((s) => (s as { reason_category: string | null }).reason_category).filter(Boolean));

  // Buyer demand: enquiry count for this drug in last 30 days
  const { count: enquiryCount30d } = await sb
    .from("supplier_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("drug_id", drugId)
    .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());

  const userPrompt = `Generate a 30/60/90-day shortage trajectory and stock-action recommendation for this drug.

DRUG
====
Name: ${(drug as { generic_name: string }).generic_name}
Class: ${(drug as { drug_class: string | null }).drug_class ?? "n/a"}

SHORTAGE HISTORY (last 80 events)
==================================
- Total events on file: ${(history ?? []).length}
- Currently active: ${active.length}
- Currently resolved: ${resolved.length}
- Countries ever affected: ${[...countries].join(", ")}
- Distinct root causes: ${[...reasons].join(", ") || "n/a"}

DEMAND SIGNAL
=============
Buyer enquiries on Mederti in last 30 days: ${enquiryCount30d ?? 0}

Output JSON:

{
  "trajectory_summary": "Three sentences. (1) Where supply stands now — past tense, named numbers. (2) The most telling supporting fact — countries, dates, magnitudes. (3) What it means for the next 60-90 days — present tense, plain words. Banned: trajectory, leverage, key (adj), going forward, stakeholders, transformative.",
  "forecast_30d": { "direction": "improving|stable|worsening", "probability_pct": 0-100 },
  "forecast_90d": { "direction": "improving|stable|worsening", "probability_pct": 0-100 },
  "upstream_signals": ["3-5 phrases. Each begins with a noun. Examples: 'Indian API plant audits', 'Ranbaxy import alerts', 'CHMP June meeting outcomes'. Not 'Watch for...' or 'Monitor...'."],
  "buyer_demand_signal": "strong" | "moderate" | "weak",
  "recommended_stock_action": "One sentence. Declarative. 'Increase stock cover to 90 days.' / 'Hold current position.' / 'Reduce exposure to one month.' Not 'Should consider proactively...'.",
  "confidence": "high" | "medium" | "low"
}

DISCIPLINE:
- "Improving" = shortage easing, demand softening, fewer countries affected.
- "Worsening" = more countries affected, severity rising.
- "Stable" = no clear directional change.
- probability_pct is your confidence the named direction will be the actual outcome.
- If the data is thin, say so plainly. "Supply is stable. Little forward signal worth flagging." That is a legitimate answer.

POSITIVE EXAMPLE:
- trajectory_summary: "Cisplatin is short in nine countries, including Italy, France and Germany. Three of nine cite manufacturing failure at the same Indian plant. The European wholesale book will tighten further in the next 60 days."
- recommended_stock_action: "Increase Indian-API stock cover to 90 days for cisplatin and pemetrexed."

NEGATIVE EXAMPLE (do not produce):
- "The trajectory of this drug's supply situation is increasingly critical, with stakeholders facing significant pressure going forward..."`;

  const foresight = await generateJson<DrugForesight>({
    system: STRATEGIST_PERSONA,
    user: userPrompt,
    maxTokens: 700,
  });

  await saveCachedInsight(supplierId, "drug_foresight", drugId, foresight, 12);
  return NextResponse.json({ ...foresight, cached: false });
}
