import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h cache for public briefing

// In-memory cache (per server instance)
let cache: { briefing: PublicBriefing; generated: number } | null = null;

interface PublicBriefingItem {
  lead_phrase: string;     // bold lead — e.g. "Indian regulators" / "Italy's AIFA" / "Cisplatin"
  body: string;            // 2-4 editorial sentences
  signal_strength: "high" | "medium" | "low";
  related_country_codes?: string[];
}

interface PublicBriefing {
  market_pulse: string;
  insights: PublicBriefingItem[];
  watch_list: string[];
}

/**
 * GET /api/intelligence/briefing
 *
 * Public-facing daily intelligence briefing. McKinsey-voice analysis of the
 * global drug shortage landscape — for analysts, hospital procurement,
 * journalists, and pharma execs.
 *
 * Cached 6h server-side (in-memory).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  if (!force && cache && Date.now() - cache.generated < TTL_MS) {
    return NextResponse.json({ ...cache.briefing, cached: true, generated_at: new Date(cache.generated).toISOString() });
  }

  const sb = getSupabaseAdmin();

  // Pull data context — global, not supplier-specific
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [
    activeRes,
    criticalRes,
    recentRes,
    crossCountryRes,
    upcomingEventsRes,
    activeTrialsRes,
    facilityOaiRes,
    nhsConcessionsRes,
  ] = await Promise.all([
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active").eq("severity", "critical"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("shortage_events").select("drug_id, country_code, severity, reason_category").eq("status", "active"),
    sb.from("regulatory_events")
      .select("event_type, event_date, generic_name, sponsor, description, source_country")
      .eq("outcome", "scheduled")
      .gte("event_date", today)
      .lte("event_date", sixtyDaysAhead)
      .order("event_date", { ascending: true })
      .limit(15),
    sb.from("clinical_trials")
      .select("intervention_name, sponsor, primary_completion_date, conditions")
      .in("phase", ["Phase 3", "Phase 4"])
      .in("overall_status", ["RECRUITING", "ACTIVE_NOT_RECRUITING"])
      .gte("primary_completion_date", today)
      .lte("primary_completion_date", new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10))
      .order("primary_completion_date", { ascending: true })
      .limit(10),
    sb.from("manufacturing_facilities")
      .select("facility_name, country, last_inspection_classification, last_inspection_date, oai_count_5y, warning_letter_count_5y")
      .or("last_inspection_classification.eq.OAI,warning_letter_count_5y.gt.0")
      .order("last_inspection_date", { ascending: false })
      .limit(8),
    sb.from("drug_pricing_history")
      .select("country, pack_price, currency, pack_description, effective_date, product_name")
      .eq("price_type", "concession")
      .order("effective_date", { ascending: false })
      .limit(10),
  ]);

  // Compute cross-country signals
  const drugCountries = new Map<string, Set<string>>();
  const reasonCounts = new Map<string, number>();
  for (const r of (crossCountryRes.data ?? []) as { drug_id: string; country_code: string; reason_category: string | null }[]) {
    if (!drugCountries.has(r.drug_id)) drugCountries.set(r.drug_id, new Set());
    drugCountries.get(r.drug_id)!.add(r.country_code);
    const k = r.reason_category ?? "unknown";
    reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
  }
  const multiCountry = [...drugCountries.entries()].filter(([_, c]) => c.size >= 3);
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Top affected drugs (5+ countries)
  const topAffected = multiCountry
    .filter(([_, c]) => c.size >= 5)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  const topDrugIds = topAffected.map(([id]) => id);
  const drugMap = new Map<string, string>();
  if (topDrugIds.length > 0) {
    const { data: drugs } = await sb.from("drugs").select("id, generic_name").in("id", topDrugIds);
    for (const d of drugs ?? []) {
      drugMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  const dataContext = `
GLOBAL SHORTAGE STATE
=====================
- Active shortages worldwide: ${activeRes.count ?? 0}
- Critical-severity: ${criticalRes.count ?? 0}
- New events in last 7 days: ${recentRes.count ?? 0}
- Drugs in shortage in 3+ countries simultaneously: ${multiCountry.length}

ROOT CAUSE BREAKDOWN (active shortages)
========================================
${topReasons.map(([r, c]) => `- ${r}: ${c}`).join("\n")}

TOP CONCENTRATION-RISK DRUGS (5+ countries simultaneously)
==========================================================
${topAffected.map(([id, cs]) => `- ${drugMap.get(id) ?? "Unknown"}: ${cs.size} countries (${[...cs].join(", ")})`).join("\n") || "(none above threshold today)"}

INDUSTRY CONTEXT
================
- Italy is the largest reporting market (1,864+ active)
- Switzerland reported 3,129 active shortages in Q1 — the most per capita globally
- Regulatory action (GMP holds, plant suspensions) is now the #1 cause of shortages globally — surpassing demand spikes and traditional supply chain disruption combined
- Indian and Chinese API plant inspections are tightening: this manifests as cross-country shortages 60-90 days later

UPCOMING REGULATORY EVENTS (next 60 days)
==========================================
${(upcomingEventsRes.data ?? []).length === 0 ? "(no events on file yet — calendar feeds populating)" :
  (upcomingEventsRes.data ?? []).slice(0, 10).map((e) => {
    const r = e as { event_date: string; event_type: string; generic_name: string | null; sponsor: string | null; source_country: string | null; description: string | null };
    return `- ${r.event_date} | ${r.source_country} ${r.event_type} | ${r.generic_name ?? "?"} | ${r.sponsor ?? "?"} | ${(r.description ?? "").slice(0, 80)}`;
  }).join("\n")
}

ACTIVE PHASE III/IV TRIALS COMPLETING IN NEXT 6 MONTHS
========================================================
${(activeTrialsRes.data ?? []).length === 0 ? "(no trials matching catalogue yet)" :
  (activeTrialsRes.data ?? []).slice(0, 8).map((t) => {
    const r = t as { intervention_name: string | null; sponsor: string | null; primary_completion_date: string; conditions: string[] | null };
    return `- ${r.primary_completion_date} | ${r.intervention_name ?? "?"} | ${r.sponsor ?? "?"} | ${(r.conditions ?? []).slice(0, 2).join(", ")}`;
  }).join("\n")
}

MANUFACTURING QUALITY SIGNALS (FDA OAI / warning letters)
==========================================================
${(facilityOaiRes.data ?? []).length === 0 ? "(no manufacturing risk signals on file yet)" :
  (facilityOaiRes.data ?? []).slice(0, 6).map((f) => {
    const r = f as { facility_name: string; country: string; last_inspection_classification: string; oai_count_5y: number; warning_letter_count_5y: number };
    return `- ${r.country} | ${r.facility_name} | ${r.last_inspection_classification} | ${r.oai_count_5y} OAI / ${r.warning_letter_count_5y} warning letters (5y)`;
  }).join("\n")
}
These are leading indicators — OAI classification + warning letters typically precede FDA shortages by 60-90 days.

UK NHS PRICE CONCESSIONS (early shortage signal)
=================================================
${(nhsConcessionsRes.data ?? []).length === 0 ? "(no concessions ingested yet — pending NHS Drug Tariff)" :
  (nhsConcessionsRes.data ?? []).slice(0, 8).map((p) => {
    const r = p as { product_name: string; pack_description: string | null; pack_price: number | null; currency: string; effective_date: string };
    return `- ${r.effective_date} | ${r.product_name} | ${r.pack_description ?? ""} | ${r.currency} ${r.pack_price ?? "?"}`;
  }).join("\n")
}
A concession is a temporary price uplift NHS pays when wholesalers can't source at tariff. Concession volume is the most reliable forward indicator of GB community-pharmacy shortages.
`;

  const systemPrompt = `You write the daily Mederti pharmaceutical supply briefing in the editorial voice of The Economist's "The World in Brief".

Voice characteristics:
- Each item opens with a bold lead phrase: a country, agency, drug, or specific noun. Example openers: "India's drug regulator", "AIFA, Italy's medicines authority", "Cisplatin shortages", "Swiss wholesalers".
- Sentences are crisp, declarative, never breathless. Past tense for events that happened, present for ongoing situations.
- Cite numbers. Name real entities. Avoid corporate hedge phrases.
- Foresight is implicit, not screamed. End with implication or direction, not exhortation.
- 3-4 sentences per item. No bullet points within items. No exclamation marks.
- Authority comes from precision, not adjectives. Don't call things "critical" — show why they matter.

Always output valid JSON. The "lead_phrase" is the bold opening (3-6 words). The "body" is the rest of the paragraph that follows it — 2-4 sentences.`;

  const userPrompt = `Write today's pharmaceutical supply briefing — Economist "World in Brief" style — from this data:

${dataContext}

Output JSON:

{
  "market_pulse": "1-2 sentences. The single most important pattern the industry should be tracking right now. Editorial voice — no jargon.",
  "insights": [
    {
      "lead_phrase": "Bold opening 3-6 words. A country, agency, drug, or specific noun. Examples: 'India's CDSCO', 'Cisplatin', 'Italian hospital procurement', 'Active pharmaceutical ingredient prices'.",
      "body": "2-4 sentences that follow the lead phrase as one paragraph. Cite numbers from the data. Past tense for events. End with implication, not advice.",
      "signal_strength": "high" | "medium" | "low",
      "related_country_codes": ["XX", "YY"]
    }
    // exactly 4 items
  ],
  "watch_list": [
    "5-7 short phrases — concrete things to watch over the next 30 days. Name drugs, countries, agencies. e.g. 'AIFA Q2 GMP audit results', 'API price moves in Hyderabad', 'Cisplatin US supply restoration'."
  ]
}

CRITICAL: This must read like The Economist, not LinkedIn. No "we should", "you must", or "it's clear that". Just the news, with implications visible in the framing.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let briefing: PublicBriefing;
  try {
    briefing = JSON.parse(text) as PublicBriefing;
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
  }

  cache = { briefing, generated: Date.now() };
  return NextResponse.json({ ...briefing, cached: false, generated_at: new Date().toISOString() });
}
