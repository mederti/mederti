import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  STRATEGIST_PERSONA,
  generateJson,
  getCachedInsight,
  saveCachedInsight,
  type DailyBriefing,
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
 * GET /api/supplier/briefing
 *
 * Generates a daily executive briefing for the logged-in supplier.
 * Cached for 24h per supplier.
 *
 * Reads:
 *  - Supplier's territory (countries served)
 *  - Their inventory (drugs they carry)
 *  - Recent enquiries received in their territory (last 7d)
 *  - Cross-country shortage trends for their drugs
 *  - Newly emerging shortages (last 7d) in their territory
 *
 * Returns: structured DailyBriefing with 3-5 insights ranked by signal strength.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();
  const { data: profile } = await sb
    .from("supplier_profiles")
    .select("id, company_name, countries_served")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return NextResponse.json({ profile_required: true });

  const supplierId = (profile as { id: string }).id;
  const territory = ((profile as { countries_served: string[] }).countries_served) ?? [];

  // Allow ?refresh=1 to force a fresh briefing
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  if (!force) {
    const cached = await getCachedInsight<DailyBriefing>(supplierId, "daily_briefing", null);
    if (cached) {
      return NextResponse.json({ ...cached.payload, generated_at: cached.generated_at, cached: true });
    }
  }

  // ── Build the data context ──
  const [
    inventoryRes,
    recentEnquiriesRes,
    sevenDayShortagesRes,
    portfolioShortagesRes,
  ] = await Promise.all([
    sb.from("supplier_inventory")
      .select("drug_id, countries, status")
      .eq("supplier_id", supplierId)
      .neq("status", "depleted"),
    sb.from("supplier_enquiries")
      .select("drug_name, drug_id, country, urgency, created_at, organisation")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .in("country", territory.length > 0 ? territory : ["__none__"])
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("shortage_events")
      .select("drug_id, country_code, severity, status, start_date")
      .eq("status", "active")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .in("country_code", territory.length > 0 ? territory : ["AU", "US", "GB", "CA", "DE", "FR", "IT", "ES"]),
    sb.from("shortage_events")
      .select("drug_id, country_code, severity, status, reason_category")
      .in("status", ["active", "anticipated"]),
  ]);

  const portfolioDrugIds = new Set(((inventoryRes.data ?? []) as { drug_id: string }[]).map((i) => i.drug_id));

  // Enrich with drug names
  const allDrugIds = Array.from(new Set([
    ...portfolioDrugIds,
    ...(((recentEnquiriesRes.data ?? []) as { drug_id: string | null }[]).map((r) => r.drug_id).filter(Boolean) as string[]),
    ...(((sevenDayShortagesRes.data ?? []) as { drug_id: string }[]).map((r) => r.drug_id)),
  ]));

  const drugMap = new Map<string, string>();
  if (allDrugIds.length > 0) {
    const { data: drugs } = await sb.from("drugs").select("id, generic_name").in("id", allDrugIds);
    for (const d of drugs ?? []) {
      drugMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  // Cross-country count for portfolio drugs (shortages in 3+ countries = upstream signal)
  const portfolioCrossCountry: Array<{ drug_id: string; drug_name: string; countries: string[] }> = [];
  if (portfolioDrugIds.size > 0) {
    const drugCountries = new Map<string, Set<string>>();
    for (const r of (portfolioShortagesRes.data ?? []) as { drug_id: string; country_code: string }[]) {
      if (!portfolioDrugIds.has(r.drug_id)) continue;
      if (!drugCountries.has(r.drug_id)) drugCountries.set(r.drug_id, new Set());
      drugCountries.get(r.drug_id)!.add(r.country_code);
    }
    for (const [did, cs] of drugCountries) {
      if (cs.size >= 3) {
        portfolioCrossCountry.push({
          drug_id: did,
          drug_name: drugMap.get(did) ?? "Unknown",
          countries: [...cs],
        });
      }
    }
  }

  // Reason category breakdown (territory-specific)
  const reasonCounts = new Map<string, number>();
  for (const r of (portfolioShortagesRes.data ?? []) as { country_code: string; reason_category: string | null }[]) {
    if (territory.length > 0 && !territory.includes(r.country_code)) continue;
    const k = r.reason_category ?? "unknown";
    reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Recent enquiry summary
  const enquiries = ((recentEnquiriesRes.data ?? []) as Array<{ drug_name: string; country: string; urgency: string; organisation: string | null; created_at: string }>);
  const enquiryByDrug = new Map<string, number>();
  for (const e of enquiries) {
    enquiryByDrug.set(e.drug_name, (enquiryByDrug.get(e.drug_name) ?? 0) + 1);
  }
  const topEnquiryDrugs = [...enquiryByDrug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── Compose the prompt ──
  const dataContext = `
SUPPLIER CONTEXT
================
Company: ${(profile as { company_name: string }).company_name}
Territory: ${territory.length === 0 ? "Global (no territory set)" : territory.join(", ")}
Active inventory listings: ${(inventoryRes.data ?? []).length}
Drugs in portfolio: ${portfolioDrugIds.size}

RECENT ENQUIRIES IN TERRITORY (last 7 days)
============================================
${enquiries.length === 0 ? "(none yet — supplier is new or territory is quiet)" : enquiries.slice(0, 12).map((e) => `- ${e.drug_name} | ${e.country} | ${e.urgency} | ${e.organisation ?? "unknown buyer"} | ${e.created_at.slice(0, 10)}`).join("\n")}

Top drugs by enquiry volume:
${topEnquiryDrugs.length === 0 ? "(none)" : topEnquiryDrugs.map(([n, c]) => `- ${n}: ${c} enquiries`).join("\n")}

CROSS-COUNTRY UPSTREAM SIGNALS (drugs in your portfolio short in 3+ countries)
================================================================================
${portfolioCrossCountry.length === 0 ? "(no global concentration risk detected in your portfolio)" :
  portfolioCrossCountry.slice(0, 8).map((d) => `- ${d.drug_name}: short in ${d.countries.join(", ")} (${d.countries.length} countries)`).join("\n")}

NEW SHORTAGES IN TERRITORY (last 7 days)
=========================================
Count: ${(sevenDayShortagesRes.data ?? []).length}

ROOT CAUSE BREAKDOWN (territory-active shortages)
==================================================
${topReasons.map(([r, c]) => `- ${r}: ${c}`).join("\n") || "(no data)"}

GLOBAL CONTEXT (for foresight)
==============================
- Italy currently has 1,864 active shortages (largest market)
- US has 2,125, Canada 1,688, Switzerland 3,129
- Critical-severity shortages globally: 1,026
- Top global root cause: regulatory_action (33% of all active shortages)
- 368 drugs are simultaneously short in 3+ countries (upstream API failure)
`;

  const userPrompt = `Generate today's briefing for this supplier.

${dataContext}

Output JSON in this exact shape:

{
  "generated_for_date": "YYYY-MM-DD",
  "market_pulse": "1-2 sentence headline of what matters most this week for THIS supplier specifically. McKinsey voice — name the trend, name the implication.",
  "insights": [
    {
      "headline": "Short, decisive — under 12 words",
      "body": "2-4 sentences. Name the pattern, name the implication, give a number. End with a forward-looking statement.",
      "signal_strength": "high" | "medium" | "low",
      "recommended_action": "Specific, time-bound action the supplier should take this week.",
      "related_drug_ids": ["drug-id-1"],
      "related_country_codes": ["XX", "YY"]
    }
    // 3-5 insights total, ranked by signal_strength desc
  ],
  "watch_list": [
    "Specific signals to monitor over the next 30 days (5-8 short bullet phrases)"
  ]
}

Rules:
- Tailor to THIS supplier's territory and portfolio. Generic insights are useless.
- If the supplier has no recent enquiries, lead with portfolio risk insights instead.
- If the supplier has cross-country signals in their portfolio, those are critical — surface as high-signal insights.
- Use real numbers from the data. Don't invent.
- Foresight is mandatory. Every insight must have a forward-looking implication ("expect", "trajectory").
- The supplier is reading this Monday morning over coffee. Make every word count.`;

  const briefing = await generateJson<DailyBriefing>({
    system: STRATEGIST_PERSONA,
    user: userPrompt,
    maxTokens: 2000,
  });

  // Cache for 24h
  await saveCachedInsight(supplierId, "daily_briefing", null, briefing, 24);

  return NextResponse.json({ ...briefing, cached: false });
}
