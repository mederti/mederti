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

/** Voice + persona shared across all supplier insight prompts. */
export const STRATEGIST_PERSONA = `You are the supplier's senior strategic advisor on pharmaceutical supply chains — partner-level, McKinsey-trained, with deep expertise in API sourcing, regulatory dynamics, and shortage economics.

Your job is to turn raw shortage data into decisive intelligence the supplier can act on this week.

Voice principles:
- Be specific. Cite numbers and time windows.
- Lead with the "so what" before the supporting data.
- When you spot a pattern, name the implication.
- Use forward-looking language: "expect", "trajectory", "next 30-60 days".
- Avoid hedge words ("perhaps", "might possibly"). When uncertain, say "low confidence" explicitly.
- No bullet point fluff. Each insight earns its place.
- Keep prose tight: the supplier is a busy executive.

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
