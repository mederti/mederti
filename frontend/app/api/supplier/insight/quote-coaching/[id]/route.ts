import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  STRATEGIST_PERSONA,
  generateJson,
  type QuoteCoaching,
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
 * GET /api/supplier/insight/quote-coaching/[id]
 *
 * Real-time pricing + win-probability coaching for an enquiry.
 * Not cached — supplier sees this fresh when opening the QuoteModal.
 *
 * Reads: enquiry context, drug shortage severity, comparable inventory listings
 * for benchmarking, supplier's verified/tier status.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: enquiryId } = await ctx.params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();
  const { data: profile } = await sb
    .from("supplier_profiles")
    .select("id, company_name, verified, tier")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ profile_required: true });

  const { data: enquiry } = await sb
    .from("supplier_enquiries")
    .select("drug_id, drug_name, country, urgency, quantity, organisation")
    .eq("id", enquiryId)
    .maybeSingle();
  if (!enquiry) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });

  // Comparable price benchmarks: what other suppliers list this drug at
  let priceBenchmarks: Array<{ unit_price: number; currency: string; verified: boolean }> = [];
  let competitorVerifiedCount = 0;
  let activeShortageCount = 0;
  let countriesAffected = 0;
  let maxSeverity = "low";

  if (enquiry.drug_id) {
    const { data: comparable } = await sb
      .from("supplier_inventory")
      .select(`unit_price, currency, supplier_profiles!inner(verified)`)
      .eq("drug_id", enquiry.drug_id)
      .neq("status", "depleted")
      .not("unit_price", "is", null);

    for (const c of comparable ?? []) {
      const raw = (c as unknown as { supplier_profiles: unknown }).supplier_profiles;
      const sp = Array.isArray(raw)
        ? (raw[0] as { verified: boolean } | undefined)
        : (raw as { verified: boolean } | undefined);
      const v = sp?.verified ?? false;
      priceBenchmarks.push({
        unit_price: (c as { unit_price: number }).unit_price,
        currency: (c as { currency: string }).currency,
        verified: v,
      });
      if (v) competitorVerifiedCount++;
    }

    const { data: shortages } = await sb
      .from("shortage_events")
      .select("country_code, severity")
      .eq("drug_id", enquiry.drug_id)
      .in("status", ["active", "anticipated"]);

    activeShortageCount = shortages?.length ?? 0;
    countriesAffected = new Set((shortages ?? []).map((s) => (s as { country_code: string }).country_code)).size;
    const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    let maxRank = 0;
    for (const s of shortages ?? []) {
      const r = sevRank[(s as { severity: string }).severity] ?? 0;
      if (r > maxRank) {
        maxRank = r;
        maxSeverity = (s as { severity: string }).severity;
      }
    }
  }

  const benchmarkSummary =
    priceBenchmarks.length === 0
      ? "(no comparable price benchmarks)"
      : `${priceBenchmarks.length} comparable listings, range ${Math.min(...priceBenchmarks.map((p) => p.unit_price))}-${Math.max(...priceBenchmarks.map((p) => p.unit_price))} (mostly ${priceBenchmarks[0].currency})`;

  const userPrompt = `Coach this supplier on quote pricing and win strategy for one enquiry.

ENQUIRY
=======
Drug: ${enquiry.drug_name}
Country: ${enquiry.country}
Urgency: ${enquiry.urgency}
Quantity wanted: ${enquiry.quantity ?? "not specified"}
Buyer org: ${enquiry.organisation ?? "unknown"}

SHORTAGE CONTEXT
================
- Active shortages globally: ${activeShortageCount}
- Countries affected: ${countriesAffected}
- Worst severity: ${maxSeverity}

COMPETITIVE PRICE BENCHMARKS
============================
${benchmarkSummary}
Verified competitors offering this drug: ${competitorVerifiedCount}

THIS SUPPLIER
=============
Verified: ${(profile as { verified: boolean }).verified}
Tier: ${(profile as { tier: string }).tier}

Output JSON:

{
  "suggested_price_range_low": null or number (per-unit),
  "suggested_price_range_high": null or number (per-unit),
  "currency": "AUD" | "USD" | "EUR" | "GBP" | null,
  "pricing_rationale": "Two sentences. Why this range. Reference the shortage severity and the competitor count. Plain words. No hedge adverbs.",
  "win_probability_pct": 0-100,
  "response_timing_advice": "One sentence. Declarative. 'Quote within four hours.' Not 'You should consider responding quickly going forward.'",
  "differentiators_to_highlight": ["2-4 noun phrases. Each starts with a noun. Examples: 'Verified status', '48h delivery from local depot', 'Batch certificate on request'. Never 'Should emphasise...' or 'Leverage your...'."],
  "confidence": "high" | "medium" | "low"
}

DISCIPLINE:
- If you have no price benchmarks, set suggested_price_range to null and explain in plain words.
- Win probability reflects: shortage severity (critical = higher), urgency (urgent = higher), verified status (yes = higher), competitor count (more = lower).
- Response timing: critical or urgent enquiries → quote within four hours wins disproportionately.
- Banned words: leverage, key (adj), trajectory, going forward, stakeholders, transformative, robust, proactively.

POSITIVE EXAMPLE:
- pricing_rationale: "Cisplatin is short in nine countries and the Australian wholesale book is empty. Two competitors quote in this market and only one is verified. The upper band is justified."
- response_timing_advice: "Quote within four hours. Critical-urgency enquiries close to the first verified responder."

NEGATIVE EXAMPLE (do not produce):
- "It's worth noting that going forward, the increasingly critical shortage trajectory suggests..."
- "You should leverage your verified status to proactively address stakeholder concerns..."`;

  const coaching = await generateJson<QuoteCoaching>({
    system: STRATEGIST_PERSONA,
    user: userPrompt,
    maxTokens: 700,
  });

  return NextResponse.json(coaching);
}
