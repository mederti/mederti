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
  const today = new Date().toISOString().slice(0, 10);
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const [
    inventoryRes,
    recentEnquiriesRes,
    sevenDayShortagesRes,
    portfolioShortagesRes,
    portfolioFacilitiesRes,
    upcomingEventsRes,
    nhsConcessionsRes,
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
    sb.from("manufacturing_facilities")
      .select("facility_name, country, last_inspection_classification, oai_count_5y, warning_letter_count_5y, last_inspection_date")
      .or("last_inspection_classification.eq.OAI,warning_letter_count_5y.gt.0")
      .order("last_inspection_date", { ascending: false })
      .limit(8),
    sb.from("regulatory_events")
      .select("event_type, event_date, generic_name, sponsor, source_country")
      .eq("outcome", "scheduled")
      .gte("event_date", today)
      .lte("event_date", sixtyDaysAhead)
      .order("event_date", { ascending: true })
      .limit(12),
    sb.from("drug_pricing_history")
      .select("country, pack_price, currency, product_name, effective_date")
      .eq("price_type", "concession")
      .order("effective_date", { ascending: false })
      .limit(10),
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

UPCOMING REGULATORY EVENTS (60 days, all markets)
==================================================
${(upcomingEventsRes.data ?? []).length === 0 ? "(none on file)" :
  (upcomingEventsRes.data ?? []).slice(0, 8).map((e) => {
    const r = e as { event_date: string; event_type: string; generic_name: string | null; sponsor: string | null; source_country: string | null };
    return `- ${r.event_date} | ${r.source_country} ${r.event_type} | ${r.generic_name ?? "?"} | ${r.sponsor ?? "?"}`;
  }).join("\n")}

MANUFACTURING QUALITY SIGNALS (FDA OAI / warning letters)
==========================================================
${(portfolioFacilitiesRes.data ?? []).length === 0 ? "(none on file yet)" :
  (portfolioFacilitiesRes.data ?? []).slice(0, 6).map((f) => {
    const r = f as { facility_name: string; country: string; last_inspection_classification: string; oai_count_5y: number; warning_letter_count_5y: number };
    return `- ${r.country} | ${r.facility_name} | ${r.last_inspection_classification} | ${r.oai_count_5y} OAI / ${r.warning_letter_count_5y} warning letters (5y)`;
  }).join("\n")}
OAI = "Official Action Indicated" — these classifications precede FDA shortages by 60-90 days.

UK NHS PRICE CONCESSIONS (early shortage signal)
=================================================
${(nhsConcessionsRes.data ?? []).length === 0 ? "(none ingested yet)" :
  (nhsConcessionsRes.data ?? []).slice(0, 6).map((p) => {
    const r = p as { product_name: string; pack_price: number | null; currency: string; effective_date: string };
    return `- ${r.effective_date} | ${r.product_name} | ${r.currency} ${r.pack_price ?? "?"}`;
  }).join("\n")}
`;

  const userPrompt = `Write today's briefing for this supplier in strict Economist house style.

${dataContext}

Output JSON in this exact shape:

{
  "generated_for_date": "YYYY-MM-DD",
  "market_pulse": "Two sentences. First: the most consequential thing this supplier should know today. Second: the implication. Active voice, plain words, named actor. No first person.",
  "insights": [
    {
      "headline": "3-7 word noun phrase. A drug, country, regulator, or facility. Examples: 'Cisplatin shortages', 'India's CDSCO audits', 'Pfizer's Sanford plant'. Not a sentence.",
      "body": "Three sentences as one paragraph. (1) What happened — past tense, named actor, one number. (2) The most telling supporting fact — places, names, magnitudes. (3) What it means now — present tense, plain words. Never start a sentence with 'This'. Never use 'trajectory', 'leverage', 'key', 'critical', 'major', 'transformative', 'stakeholders', 'going forward'. 60-100 words.",
      "signal_strength": "high" | "medium" | "low",
      "recommended_action": "One sentence, declarative, active voice. Names the action, the drug or market, and the time window. Example: 'Increase Indian-API stock cover to 90 days for cisplatin and pemetrexed.' Not 'Should consider proactively...'",
      "related_drug_ids": ["drug-id-1"],
      "related_country_codes": ["XX", "YY"]
    }
    // 3-5 insights, ordered most consequential first.
  ],
  "watch_list": [
    "5-8 phrases. Each begins with a noun. Each names a specific drug, regulator, place or date. Examples: 'Hyderabad API spot prices', 'AIFA June meeting', 'Cisplatin restoration in the United States'."
  ]
}

DISCIPLINE:
- Tailor to THIS supplier's territory and portfolio. Generic insights waste the reader's time.
- If there are no recent enquiries, lead with portfolio risk.
- If there are cross-country signals in the supplier's portfolio, those open the briefing.
- Use real numbers from the data. Never invent.
- Round large numbers (1,864 → "about 1,800") unless the precise figure is the news.
- Maximum two figures per paragraph.
- The supplier reads this Monday morning over coffee. Cut anything that does not pay its way.

NEVER PRODUCE TEXT LIKE:
- "Stakeholders should be aware of the increasingly critical trajectory..."
- "The implications of this development are profound..."
- "Going forward, suppliers must proactively leverage..."
- "It is worth noting that the situation has evolved significantly..."

PRODUCE TEXT LIKE:
- "AIFA, Italy's medicines authority, opened 1,864 shortage cases this year, more than the United States. Cefazolin, doxorubicin and pemetrexed account for one in three of them. The Italian wholesale book is the most exposed in Europe."
- "Pfizer's Sanford plant received an OAI classification on April 12th, the third in five years. Two of the firm's antibiotic lines are made there. Buyers in the United States and Britain should expect tightening within 60 days."`;

  const briefing = await generateJson<DailyBriefing>({
    system: STRATEGIST_PERSONA,
    user: userPrompt,
    maxTokens: 2000,
  });

  // Cache for 24h
  await saveCachedInsight(supplierId, "daily_briefing", null, briefing, 24);

  return NextResponse.json({ ...briefing, cached: false });
}
