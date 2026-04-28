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

  const [
    activeRes,
    criticalRes,
    recentRes,
    crossCountryRes,
  ] = await Promise.all([
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active").eq("severity", "critical"),
    sb.from("shortage_events").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("shortage_events").select("drug_id, country_code, severity, reason_category").eq("status", "active"),
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
