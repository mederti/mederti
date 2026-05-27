// Per-call Anthropic usage logging.
//
// Closes audit FINDING-AI-02: every /api/chat and ancillary AI route writes
// one row to ai_request_log (migration 042) with model, token counts (incl.
// cache hit/miss), latency, tool-call count, and outcome. The /admin/ai-spend
// dashboard reads from v_ai_request_daily.
//
// Mirrors the demand-signal pattern (frontend/lib/demand-signal.ts):
//
//   • Fire-and-forget — failure to log NEVER blocks the user request
//   • Silent degradation if migration 042 isn't applied yet (logs to
//     console only when AI_USAGE_LOG_DEBUG is set)
//   • Caller passes the raw Anthropic SDK Message; helper extracts usage
//
// Usage in a Next.js Route Handler:
//
//   import { recordAiUsage } from "@/lib/ai/usage-log";
//   ...
//   const t0 = Date.now();
//   const response = await anthropic.messages.create({...});
//   recordAiUsage({
//     route: "/api/chip-answer",
//     model: MODEL,
//     response,
//     latency_ms: Date.now() - t0,
//   });

import type Anthropic from "@anthropic-ai/sdk";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_NOTES_LEN = 500;

export type AiUsageStatus = "success" | "error" | "rate_limited" | "fallback" | "no_key";

export type AiUsageInput = {
  /** Mederti surface that made the call (e.g. "/api/chat"). */
  route: string;
  /** Anthropic model snapshot ID actually sent. */
  model: string;
  /** Raw SDK Message — helper extracts usage. Omit for non-success rows. */
  response?: Anthropic.Message | null;
  /** End-to-end latency including any tool-use loop. */
  latency_ms?: number;
  /** Chat-only: tool-iteration count for the turn. */
  tool_calls?: number;
  /** Chat-only: hit MAX_ITERATIONS ceiling. */
  truncated?: boolean;
  /** Authenticated user_id, when the route already resolved it. */
  user_id?: string | null;
  /** Default 'success'. Set to 'fallback' / 'no_key' / 'error' / 'rate_limited' for non-success rows. */
  status?: AiUsageStatus;
  /** Free-form context: error message, fallback reason. Bounded to 500 chars. */
  notes?: string | null;
  /** Optional prompt-version stamp (audit FINDING-AI-06). */
  prompt_version?: string | null;
};

/** Fire-and-forget AI-usage write. Never throws; never delays the request. */
export function recordAiUsage(input: AiUsageInput): void {
  const usage = input.response?.usage;
  const row = {
    route: input.route,
    model: input.model,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    latency_ms: input.latency_ms ?? null,
    tool_calls: input.tool_calls ?? null,
    truncated: input.truncated ?? null,
    user_id: input.user_id ?? null,
    status: input.status ?? "success",
    notes: input.notes ? input.notes.slice(0, MAX_NOTES_LEN) : null,
    prompt_version: input.prompt_version ?? null,
  };

  void (async () => {
    try {
      const sb = getSupabaseAdmin();
      const { error } = await sb.from("ai_request_log").insert(row);
      if (error && process.env.AI_USAGE_LOG_DEBUG) {
        // Migration 042 may not be applied yet — degrade silently.
        console.warn("[ai-usage-log] insert failed (non-fatal):", error.message);
      }
    } catch (e) {
      if (process.env.AI_USAGE_LOG_DEBUG) {
        console.warn("[ai-usage-log] write threw (non-fatal):", e);
      }
    }
  })();
}
