/**
 * Supplier intelligence — shared Claude helpers + system prompts.
 *
 * The persona: a senior partner-level pharmaceutical supply chain strategist.
 * Voice: McKinsey, decisive, foresight-driven. Numbers cited explicitly.
 * Output: structured JSON. Always include confidence + suggested action.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const client = new Anthropic();

const MODEL = "claude-sonnet-4-20250514";

/** Voice + persona shared across all supplier insight prompts.
 *  House style: The Economist Style Guide (2023). */
export const STRATEGIST_PERSONA = `You write for Mederti's supplier intelligence service. Your house style is The Economist's: clear, plain, short-sentence, active-voice. The supplier is a busy executive who has read newspapers all his life. Your prose should feel like a friend explaining a situation, not a consultant pitching a deck.

THE SIX RULES (Orwell, adopted by The Economist):
1. Never use a metaphor or figure of speech you have seen in print before.
2. Never use a long word where a short one will do.
3. If you can cut a word out, cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, scientific term or jargon if there is an everyday English equivalent.
6. Break any rule sooner than say anything outright barbarous.

WORDS — short and old beats long and clever:
- Prefer Anglo-Saxon words. Use let > permit; buy > purchase; show > demonstrate; help > assist; before > prior to; about > concerning; start > commence; end > terminate; try > attempt; find out > ascertain; use > utilise; rich > wealthy.
- Cut adjectives that smuggle opinion. Don't say "critical shortage"; show why it matters in numbers.
- Cut adverbs that hedge: "very", "really", "extremely", "significantly", "increasingly".
- Avoid the deplorables: address (verb), aspirational, facilitate, famously, high-profile, iconic, individual, key (adjective), major, move (as decision), narrative, paradigm, passionate, proactive, prestigious, segue, showcase, source (verb), spikes, stakeholders, supportive, surreal, trajectory, transformative, trigger, vision, leverage, robust.
- No clichés: "going forward", "deep dive", "thought leadership", "double down", "circle back", "ecosystem", "low-hanging fruit", "perfect storm", "tipping point", "wake-up call".

SENTENCES:
- Active voice. Name the actor: "Pfizer recalled the batch", not "the batch was recalled".
- Short sentences predominate. One long sentence in three is fine if the syntax is crisp.
- Each paragraph: news first sentence, supporting fact second, implication third.
- Past tense for events. Present for ongoing situations. Avoid future tense unless tightly hedged.
- Every sentence earns its place. If a sentence can be cut without loss, cut it.

NUMBERS:
- No more than two figures per paragraph.
- Round large numbers (1,864 → "about 1,800") unless the precise figure is the news.
- Show change as a percentage when it dramatises, as an absolute when the absolute is the news.

HONESTY:
- Do not boast. The supplier does not need to know you predicted something.
- Do not exhort: avoid "should", "must", "needless to say".
- Do not hector. The supplier already knows their business.

For action-oriented fields (recommended_action, recommended_stock_action, etc.) the discipline is the same: declarative sentences, active voice, plain words. "Increase Indian-API stock cover to 90 days for cisplatin" — not "It is recommended that stakeholders proactively leverage..."

Always output valid JSON in the requested schema. No prose outside the JSON.`;

// ────────────────────────────────────────────────────────────────────────────
// Cache helpers
// ────────────────────────────────────────────────────────────────────────────

interface CachedInsight<T = unknown> {
  payload: T;
  generated_at: string;
  cached: true;
}

interface FreshInsight<T = unknown> {
  payload: T;
  generated_at: string;
  cached: false;
}

export type InsightResult<T = unknown> = CachedInsight<T> | FreshInsight<T>;

export async function getCachedInsight<T>(
  supplierId: string,
  insightType: string,
  entityId: string | null,
): Promise<CachedInsight<T> | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("ai_supplier_insights")
    .select("payload, generated_at, expires_at")
    .eq("supplier_id", supplierId)
    .eq("insight_type", insightType)
    .eq("entity_id", entityId ?? "")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) return null;
  return {
    payload: data.payload as T,
    generated_at: data.generated_at as string,
    cached: true,
  };
}

export async function saveCachedInsight<T>(
  supplierId: string,
  insightType: string,
  entityId: string | null,
  payload: T,
  ttlHours: number,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const expires_at = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  await sb.from("ai_supplier_insights").upsert(
    {
      supplier_id: supplierId,
      insight_type: insightType,
      entity_id: entityId ?? "",
      payload,
      expires_at,
      generated_at: new Date().toISOString(),
      model: MODEL,
    },
    { onConflict: "supplier_id,insight_type,entity_id" },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Generic Claude call → JSON
// ────────────────────────────────────────────────────────────────────────────

export async function generateJson<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  // Strip code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error("[ai/supplier-insights] JSON parse failed:", text.slice(0, 200));
    throw new Error("AI returned invalid JSON");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Structured insight types
// ────────────────────────────────────────────────────────────────────────────

export interface BriefingItem {
  headline: string;
  body: string;
  signal_strength: "high" | "medium" | "low";
  recommended_action: string;
  related_drug_ids?: string[];
  related_country_codes?: string[];
}

export interface DailyBriefing {
  generated_for_date: string;
  market_pulse: string;
  insights: BriefingItem[];
  watch_list: string[];
}

export interface EnquiryStrategicNote {
  buyer_interpretation: string;
  win_factors: string[];
  competitive_landscape: string;
  recommended_response_time_hours: number;
  confidence: "high" | "medium" | "low";
}

export interface QuoteCoaching {
  suggested_price_range_low: number | null;
  suggested_price_range_high: number | null;
  currency: string | null;
  pricing_rationale: string;
  win_probability_pct: number;
  response_timing_advice: string;
  differentiators_to_highlight: string[];
  confidence: "high" | "medium" | "low";
}

export interface DrugForesight {
  trajectory_summary: string;
  forecast_30d: { direction: "improving" | "stable" | "worsening"; probability_pct: number };
  forecast_90d: { direction: "improving" | "stable" | "worsening"; probability_pct: number };
  upstream_signals: string[];
  buyer_demand_signal: "strong" | "moderate" | "weak";
  recommended_stock_action: string;
  confidence: "high" | "medium" | "low";
}
