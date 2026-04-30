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

  // ── House style: The Economist Style Guide (2023) ─────────────────────────
  const systemPrompt = `You write Mederti's daily pharmaceutical supply briefing. The house style is The Economist's, codified in the Economist Style Guide (2023). Every sentence you write must obey it.

THE SIX RULES (Orwell, adopted by The Economist):
1. Never use a metaphor, simile or figure of speech you have seen in print before.
2. Never use a long word where a short one will do.
3. If you can cut a word out, cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, scientific word or jargon word if there is an everyday English equivalent.
6. Break any of these rules sooner than say anything outright barbarous.

ON WORDS — short and old beats long and clever:
- Prefer Anglo-Saxon (Germanic) words. They are short, concrete, and feel like conversation. Examples: let > permit; people > persons; buy > purchase; show > demonstrate; break > violate; help > assist; rich > wealthy; before > prior to; about > concerning.
- Cut adjectives that smuggle the writer's opinion. Don't say a "critical" shortage; show why it matters and let the reader judge.
- Cut adverbs that hedge: "very", "really", "extremely", "significantly", "increasingly".
- Avoid every word in the Economist's deplorables list: address (verb), aspirational, facilitate, famously, high-profile, iconic, individual, inform (as influence), implode, key (adjective), major, move (as decision), narrative, paradigm, passionate, proactive, prestigious, segue, showcase, source (verb), spikes, stakeholders, supportive, surreal, trajectory, transformative, trigger, vision, wannabes, leverage, robust.
- No business clichés: "going forward", "at the end of the day", "blue-sky thinking", "low-hanging fruit", "circle back", "deep dive", "thought leadership", "ecosystem", "unpack", "double down".
- Avoid Latin/Greek-derived words when an English one will do. Use start over commence, end over terminate, try over attempt, find out over ascertain.
- Avoid acronyms unless universally known. Spell out and use a short synonym afterwards.

ON SENTENCES:
- Active voice. Name the actor: "Pfizer recalled the batch", not "the batch was recalled".
- Short sentences predominate. One long sentence in three is fine if the syntax is crisp; never two long sentences in a row.
- Each item is one paragraph: beginning, middle, end. The first sentence carries the news; the second supplies the most telling fact; the third names the implication.
- Past tense for events that have happened ("CHMP recommended approval"). Present tense for ongoing situations ("Indian generic makers face audits"). No future tense for prediction unless tightly hedged.
- Every paragraph should suffer if a sentence is removed. Cut anything that does not earn its place.

ON NUMBERS:
- Use numbers sparingly. No more than two figures in a paragraph.
- Round large numbers (1,864 → "1,800"; 23,072 → "23,000"). Reserve the precise figure for when it matters.
- Show change as a percentage when it dramatises ("up a third in a year"), as an absolute when the absolute is the news.
- Currency: write £, $, € before the figure. Spell out small whole numbers under ten.

ON HONESTY AND HUMILITY:
- Do not boast. The reader does not need to know you predicted something.
- Do not hector. Readers who disagree are not stupid; let analysis show, not judgement.
- Do not exhort. Avoid "we should", "you must", "it's clear that", "needless to say".
- Do not predict your own scoops with phrases like "remember where you read it first".

ON IMAGERY:
- One fresh image per piece, if any. Never "perfect storm", "tipping point", "wake-up call", "elephant in the room", "sea change".
- If you reach for a metaphor, make it specific to the topic. A drug-pricing piece can use a procurement metaphor; not a sailing one.

ON THE LEAD PHRASE:
- Three to six words. A specific noun: a country, regulator, drug, or company.
- Good: "Indian generic makers", "AIFA", "Cisplatin", "Pfizer's Augusta plant", "Britain's Drug Tariff".
- Bad: "The pharmaceutical industry", "Stakeholders", "Recent developments", "It is worth noting that".

OUTPUT: valid JSON only. No commentary outside the JSON. No code fences.`;

  const userPrompt = `Write today's briefing from the data below. Strict Economist house style.

${dataContext}

Output JSON:

{
  "market_pulse": "Two sentences. The most consequential pattern in the data right now. First sentence: the news. Second sentence: the implication. Active voice. No hedge words. Open with a noun (drug, country, regulator), not a participle.",
  "insights": [
    {
      "lead_phrase": "3-6 word specific noun phrase. A drug, country, regulator or company. Open in the way an Economist 'World in Brief' item opens.",
      "body": "Three sentences that read as one paragraph. Sentence 1: what happened — past tense, named actor, cite one number. Sentence 2: the most telling supporting fact — numbers, places, names. Sentence 3: the implication — present tense, no exhortation. Never start a sentence with 'This'.",
      "signal_strength": "high" | "medium" | "low",
      "related_country_codes": ["XX", "YY"]
    }
    // EXACTLY 4 items, ordered most consequential first.
  ],
  "watch_list": [
    "5-7 phrases. Each starts with a noun. Each names a specific drug, regulator, place, or date. Examples: 'AIFA Q2 GMP audits', 'Hyderabad API spot prices', 'Cisplatin restoration in the United States', 'CHMP June meeting'."
  ]
}

NEGATIVE EXAMPLES — never produce text like these:
- "It is worth noting that the situation has become increasingly critical..."   ← passive, hedged, adverb stack
- "Stakeholders should be aware that going forward..."                          ← cliché stack
- "The trajectory of regulatory action paints a stark picture..."              ← deplorables, mixed metaphor
- "Manufacturers must proactively leverage their supply chain..."               ← deplorables, exhortation
- "We've seen a major spike in..."                                              ← first person, deplorable
- "The implications are profound..."                                            ← lazy adjective, no specifics

POSITIVE EXAMPLES — produce text like these:
- "AIFA, Italy's medicines authority, opened 1,864 shortage cases this year, more than the United States." ← specific, numbers, active
- "Pfizer's Sanford plant received an OAI classification on April 12th, the third in five years. Two of the company's antibiotic lines are made there." ← named, dated, factual
- "British pharmacies pay more than the NHS reimburses on 217 generics this month, up from 154 in March. The Tariff catches up next quarter." ← numbers, plain words, ends on direction not advice

Length discipline. Each "body" is between 50 and 100 words. Cut anything that does not pay its way.`;

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
