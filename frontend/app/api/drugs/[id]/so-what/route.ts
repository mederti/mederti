import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h cache

// In-memory cache keyed by drug_id (per server instance)
const cache = new Map<string, { payload: SoWhatPayload; generated: number }>();

interface SoWhatPayload {
  headline: string;       // 4-8 word noun phrase, the "so what" in one line
  body: string;            // 60-100 word paragraph: news / supporting fact / implication
  signal: "elevated" | "stable" | "improving" | "worsening";
  confidence: "high" | "medium" | "low";
}

/**
 * GET /api/drugs/[id]/so-what
 *
 * Generates a short editorial "So What" interpretation of the drug's current
 * supply situation. Read by the user above the chat column.
 *
 * House style: The Economist (2023). 60-100 word paragraph.
 * Cached 12h in-memory per drug.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: drugId } = await ctx.params;
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  if (!force) {
    const c = cache.get(drugId);
    if (c && Date.now() - c.generated < TTL_MS) {
      return NextResponse.json({ ...c.payload, cached: true, generated_at: new Date(c.generated).toISOString() });
    }
  }

  const sb = getSupabaseAdmin();

  // Fetch the full drug context in parallel
  const altPromise = sb.from("drug_alternatives").select("alternative_drug_name").eq("drug_id", drugId).limit(8) as unknown as Promise<{ data: Array<{ alternative_drug_name: string }> | null }>;
  const altResult = await altPromise.catch(() => ({ data: [] as Array<{ alternative_drug_name: string }> }));

  const [drugRes, shortagesRes, regEventsRes, trialsRes, facilitiesRes, approvalsRes] = await Promise.all([
    sb.from("drugs").select("id, generic_name, brand_names, atc_code_full, drug_class, who_essential_medicine, critical_medicine_eu").eq("id", drugId).maybeSingle(),
    sb.from("shortage_events").select("country_code, status, severity, reason_category, start_date, end_date").eq("drug_id", drugId),
    sb.from("regulatory_events").select("event_type, event_date, source_country, sponsor, description, outcome").eq("drug_id", drugId).gte("event_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).limit(10),
    sb.from("clinical_trials").select("phase, overall_status, primary_completion_date, sponsor").eq("drug_id", drugId).in("phase", ["Phase 3", "Phase 4"]).limit(15),
    sb.from("manufacturing_facilities").select("facility_name, country, last_inspection_classification, oai_count_5y, warning_letter_count_5y").or("last_inspection_classification.eq.OAI,warning_letter_count_5y.gt.0").limit(8),
    sb.from("drug_approvals").select("authority, te_code").eq("drug_id", drugId).limit(20),
  ]);
  const alternativesRes = altResult;

  const drug = drugRes.data as { generic_name: string; brand_names: string[] | null; atc_code_full: string | null; drug_class: string | null; who_essential_medicine: boolean; critical_medicine_eu: boolean } | null;
  if (!drug) return NextResponse.json({ error: "Drug not found" }, { status: 404 });

  type ShortageRow = { country_code: string; status: string; severity: string; reason_category: string | null; end_date: string | null };
  const shortages = (shortagesRes.data ?? []) as ShortageRow[];
  const active = shortages.filter((s) => s.status === "active");
  const resolved = shortages.filter((s) => s.status === "resolved");
  const countriesAffected = Array.from(new Set(active.map((s) => s.country_code)));
  const reasons = Array.from(new Set(active.map((s) => s.reason_category).filter(Boolean)));
  const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const worstSev = active.reduce((acc: number, s: ShortageRow) => {
    const r = sevRank[s.severity] ?? 0;
    return r > acc ? r : acc;
  }, 0);

  const recentResolved = resolved.filter((s) => {
    if (!s.end_date) return false;
    return new Date(s.end_date).getTime() > Date.now() - 90 * 86400000;
  }).length;

  const teCodes = ((approvalsRes.data ?? []) as Array<{ te_code: string | null }>).map((a) => a.te_code).filter(Boolean);

  const dataContext = `
DRUG
====
Name: ${drug.generic_name}
Brands: ${(drug.brand_names ?? []).slice(0, 3).join(", ") || "none on file"}
Class: ${drug.drug_class ?? "n/a"}
ATC: ${drug.atc_code_full ?? "n/a"}
WHO Essential Medicine: ${drug.who_essential_medicine ? "yes" : "no"}
EU Critical Medicine: ${drug.critical_medicine_eu ? "yes" : "no"}

SHORTAGE STATE
==============
Active shortages: ${active.length}
Countries affected (active): ${countriesAffected.join(", ") || "none"}
Worst severity: ${["", "low", "medium", "high", "critical"][worstSev] || "n/a"}
Active reason categories: ${reasons.join(", ") || "none"}
Resolved in last 90 days: ${recentResolved}
Total shortage events on file: ${shortages.length}

REGULATORY (last 30 days + upcoming)
=====================================
${(regEventsRes.data ?? []).length === 0 ? "(none)" :
  (regEventsRes.data ?? []).slice(0, 6).map((e) => {
    const r = e as { event_date: string; event_type: string; source_country: string; description: string | null };
    return `- ${r.event_date} | ${r.source_country} ${r.event_type} | ${(r.description ?? "").slice(0, 80)}`;
  }).join("\n")}

ACTIVE PHASE III/IV TRIALS
===========================
${(trialsRes.data ?? []).filter((t) => ["RECRUITING", "ACTIVE_NOT_RECRUITING"].includes((t as { overall_status: string }).overall_status)).length} active
Sample: ${(trialsRes.data ?? []).slice(0, 3).map((t) => (t as { sponsor: string }).sponsor).join("; ") || "n/a"}

MANUFACTURING SIGNALS (global, OAI/warning letters last 5y)
============================================================
${(facilitiesRes.data ?? []).length} facilities flagged
${(facilitiesRes.data ?? []).slice(0, 4).map((f) => {
  const r = f as { facility_name: string; country: string; last_inspection_classification: string };
  return `- ${r.country} ${r.facility_name} (${r.last_inspection_classification})`;
}).join("\n")}

APPROVALS / EQUIVALENCE
========================
Authorities approved: ${Array.from(new Set((approvalsRes.data ?? []).map((a) => (a as { authority: string }).authority))).join(", ") || "n/a"}
Orange Book TE codes present: ${teCodes.length} (${Array.from(new Set(teCodes)).slice(0, 5).join(", ") || "—"})

ALTERNATIVES ON FILE
=====================
${(alternativesRes.data ?? []).length} therapeutic alternatives indexed
`;

  const systemPrompt = `You write Mederti's "So What" insight for a drug page. Strict house style: The Economist (2023).

Voice rules:
- Active voice. Named actors.
- Short, Anglo-Saxon words. Use let > permit, buy > purchase, show > demonstrate, before > prior to.
- Cut hedge adverbs ("very", "extremely", "significantly", "increasingly").
- Banned deplorables: trajectory, leverage, key (adj), major, transformative, stakeholders, going forward, deep dive, ecosystem, narrative, paradigm, supportive (try helpful), critical (as adjective dressing).
- No clichés: perfect storm, tipping point, wake-up call, low-hanging fruit, double down, circle back.
- No first person. No "we should". No "needless to say".
- Cite numbers from the data. Round large ones (1,864 → "about 1,800"). Maximum two figures.

Structure:
- One paragraph, 60-100 words.
- Sentence 1: the news — past tense, named actor, one number that matters most.
- Sentence 2: the most telling supporting fact — names, places, magnitudes.
- Sentence 3: the implication — present tense, plain words, ends on direction not advice.
- The reader has just looked at the drug status numbers. Your job is to tell them why those numbers matter — the "so what".

Output valid JSON only.`;

  const userPrompt = `Write the "So What" insight for this drug.

${dataContext}

Output JSON:

{
  "headline": "4-8 word noun phrase. Examples: 'A worsening cross-border shortage', 'Manufacturing risk in India', 'Stable supply, light pipeline'.",
  "body": "ONE paragraph, 60-100 words, three sentences. (1) news. (2) telling fact. (3) implication. Active voice. Plain words. No deplorables.",
  "signal": "elevated" | "stable" | "improving" | "worsening",
  "confidence": "high" | "medium" | "low"
}

If the data is thin (no active shortages, no upcoming events, no manufacturing signals), say so plainly. Don't invent risk that isn't there. The honest reading might be "Supply is stable. There is little forward signal worth flagging." That is fine.

NEVER produce text like:
- "The trajectory of this drug's supply situation paints a concerning picture..."
- "Stakeholders should proactively address the increasingly critical shortage..."
- "It is worth noting that going forward, the pharmaceutical landscape..."

PRODUCE text like:
- "Cisplatin is short in nine countries, including Italy, France and Germany. The cause in most is reported as manufacturing failure, not demand. The European wholesale book will tighten further in the next 60 days."
- "Amoxicillin supply is stable across the 22 markets Mederti monitors. The last European shortage cleared in February. Buyers face no obvious near-term risk on this molecule."`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
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

  let payload: SoWhatPayload;
  try {
    payload = JSON.parse(text) as SoWhatPayload;
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
  }

  cache.set(drugId, { payload, generated: Date.now() });
  return NextResponse.json({ ...payload, cached: false, generated_at: new Date().toISOString() });
}
