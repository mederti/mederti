import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import { TOOL_DEFINITIONS, executeTool, hydrateReferencedIds, newContext } from "@/lib/chat/tools";
import { checkRateLimit, getClientIp } from "@/lib/chat/rate-limit";
import { recordDemandSignal } from "@/lib/demand-signal";
import { recordAiUsage } from "@/lib/ai/usage-log";
import { createServerClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITERATIONS = 12;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
// Roomy budget — Claude-led synthesis means most answers are 2–5 paragraphs
// of integrated prose alongside cards. With extended thinking enabled, the
// budget also has to cover the model's reasoning tokens.
const MAX_OUTPUT_TOKENS = 16384;

type IncomingBody = {
  messages: ChatMessage[];
};

// ── Wire protocol ─────────────────────────────────────────────────────────
// NDJSON: one JSON object per line. Event shapes:
//   { type: "text_delta", delta: string }
//   { type: "tool_start", name: string, id: string, input: object }
//   { type: "tool_done",  name: string, id: string, ms: number, result_count?: number, error?: boolean }
//   { type: "done", content, drugs, subs, classes, tool_calls, truncated }
//   { type: "error", message: string }
//
// `input` on tool_start lets the UI render the actual query the model
// asked for ("Searching: lipitor EU shortage"). `result_count` on
// tool_done is a best-effort hit count derived from array-shaped results
// — used to show "7 results" next to the step row.
//
// The non-streaming JSON contract (content/drugs/subs/classes/tool_calls/
// truncated) is preserved verbatim inside the terminal "done" event, so the
// existing ChatApiResponse type still describes the final payload shape.
// ──────────────────────────────────────────────────────────────────────────

type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; name: string; id: string; input: Record<string, unknown> }
  | {
      type: "tool_done";
      name: string;
      id: string;
      ms: number;
      result_count?: number;
      error?: boolean;
    }
  | {
      type: "done";
      content: string;
      drugs: Record<string, unknown>;
      subs?: Record<string, unknown>;
      classes?: Record<string, unknown>;
      tool_calls: number;
      truncated: boolean;
    }
  | { type: "error"; message: string };

// Best-effort: if a tool returned an array, that length is "results".
// If it returned an object with an obvious list field, count that.
// Used purely for the UI step-row count — never load-bearing.
function countResults(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    for (const key of ["results", "items", "rows", "hits"]) {
      const v = (result as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v.length;
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return Response.json(
      {
        content: "",
        drugs: {},
        error: `Rate limit reached. Try again at ${new Date(rl.resetAt).toLocaleTimeString()}.`,
      },
      { status: 429 }
    );
  }

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return Response.json({ content: "", drugs: {}, error: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return Response.json({ content: "", drugs: {}, error: "No messages." }, { status: 400 });
  }

  // No API key → degraded path: do a direct drug lookup against Supabase and
  // return a drug_card. Honest, useful, and stops the chat from 500-ing in
  // environments where the key hasn't been provisioned yet. Wrapped as a
  // single "done" NDJSON event so the streaming client doesn't need a
  // separate code path for the fallback.
  if (!process.env.ANTHROPIC_API_KEY) {
    const lastUser = [...incoming].reverse().find((m) => m.role === "user");
    const fallback = await fallbackDrugLookup(lastUser?.text || "");
    return ndjsonResponse(async (write) => {
      await write({
        type: "done",
        content: fallback.content,
        drugs: fallback.drugs,
        subs: fallback.subs,
        classes: fallback.classes,
        tool_calls: 0,
        truncated: false,
      });
    });
  }

  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  // Resolve the authenticated user_id, if any. Auth-required tools
  // (get_my_portfolio_status, get_watchlist_demand, set_portfolio_alert)
  // check ctx.user_id and refuse cleanly when null. Anonymous chat continues
  // to work for every other tool.
  let userId: string | null = null;
  try {
    const sbSession = await createServerClient();
    const { data: { user } } = await sbSession.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Auth lookup failure → anonymous. Never blocks the chat.
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ctx = newContext({ user_id: userId });
  const t0 = Date.now();

  return ndjsonResponse(async (write) => {
    let truncated = false;
    let toolCalls = 0;
    let lastResponse: Anthropic.Message | null = null;
    let assembledText = "";

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          thinking: {
            type: "adaptive",
          },
          output_config: {
            effort: "medium",
          },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: TOOL_DEFINITIONS,
          messages,
        });

        // Forward text deltas to the client as they arrive. Thinking deltas
        // and tool_use input deltas are intentionally swallowed — the user
        // sees prose only, with tool calls represented as discrete status
        // events below.
        stream.on("text", (textDelta: string) => {
          if (!textDelta) return;
          assembledText += textDelta;
          // Fire-and-forget; if the client has disconnected the write will
          // become a no-op (closed flag inside ndjsonResponse).
          void write({ type: "text_delta", delta: textDelta });
        });

        const response = await stream.finalMessage();
        lastResponse = response;
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason !== "tool_use") break;

        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUses.map(async (tu) => {
            toolCalls += 1;
            const startedAt = Date.now();
            await write({
              type: "tool_start",
              name: tu.name,
              id: tu.id,
              input: (tu.input ?? {}) as Record<string, unknown>,
            });
            try {
              const result = await executeTool(tu.name, tu.input as Record<string, any>, ctx);
              await write({
                type: "tool_done",
                name: tu.name,
                id: tu.id,
                ms: Date.now() - startedAt,
                result_count: countResults(result),
              });
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: JSON.stringify(result ?? null),
              };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[tool ${tu.name}] error:`, msg);
              await write({
                type: "tool_done",
                name: tu.name,
                id: tu.id,
                ms: Date.now() - startedAt,
                error: true,
              });
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: JSON.stringify({ error: msg }),
                is_error: true,
              };
            }
          })
        );

        messages.push({ role: "user", content: toolResults });
      }

      // If we exited the loop while Claude was still calling tools, force one
      // final no-tools synthesis so the user gets an answer (not an interim
      // "let me search for more…" thought).
      if (lastResponse && lastResponse.stop_reason === "tool_use") {
        truncated = true;
        messages.push({
          role: "user",
          content:
            "You've hit the tool-call budget for this turn. Do not call any more tools. Synthesize a final answer for the user from the data already collected. If the data is incomplete, say so honestly and surface the best partial answer you can.",
        });
        const finalStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          thinking: {
            type: "adaptive",
          },
          output_config: {
            effort: "medium",
          },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          // Intentionally omit `tools` — forces Claude to produce a text answer.
          messages,
        });
        finalStream.on("text", (textDelta: string) => {
          if (!textDelta) return;
          assembledText += textDelta;
          void write({ type: "text_delta", delta: textDelta });
        });
        lastResponse = await finalStream.finalMessage();
        messages.push({ role: "assistant", content: lastResponse.content });
      }

      // Prefer the structured extract from the final Message (handles split
      // text blocks from web search citations). Fall back to the
      // concatenated stream text only if extract returns empty.
      const finalText = extractText(lastResponse) || assembledText;

      try {
        await hydrateReferencedIds(finalText, ctx);
      } catch (err) {
        console.error("[chat] hydrate error (non-fatal):", err);
      }

      if (lastResponse) {
        const usage = lastResponse.usage;
        console.log(
          `[chat] ip=${ip} model=${MODEL} tool_calls=${toolCalls} in=${usage?.input_tokens ?? "?"} out=${usage?.output_tokens ?? "?"} truncated=${truncated}`
        );
        recordAiUsage({
          route: "/api/chat",
          model: MODEL,
          response: lastResponse,
          latency_ms: Date.now() - t0,
          tool_calls: toolCalls,
          truncated,
          user_id: userId,
        });
      }

      // Demand-signal instrumentation — chip_click signal per drug surfaced
      // in the answer. ctx.drugs is keyed by UUID and populated by tool
      // hydration as the model emits <drug_card /> tags. One signal per
      // distinct drug per chat turn — buyer-side demand picture.
      for (const drugId of Object.keys(ctx.drugs)) {
        recordDemandSignal({
          signal_type: "chip_click",
          drug_id: drugId,
          identifier: ip,
        });
      }

      await write({
        type: "done",
        content: finalText,
        drugs: ctx.drugs,
        subs: ctx.subs,
        classes: ctx.classes,
        tool_calls: toolCalls,
        truncated,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chat] fatal:", msg);
      await write({
        type: "error",
        message: `Sorry, the assistant had a hiccup: ${msg}`,
      });
    }
  });
}

// Wrap an async producer in an NDJSON ReadableStream Response. Each event is
// JSON.stringify'd and followed by a newline. The producer is invoked once
// with a `write(event)` helper; the response closes when the producer
// resolves. Writes after client-disconnect become no-ops instead of throwing.
function ndjsonResponse(
  producer: (write: (event: StreamEvent) => Promise<void>) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = async (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected — stop trying to write.
          closed = true;
        }
      };
      try {
        await producer(write);
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // Already closed — no-op.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Disable proxy buffering so deltas reach the browser immediately.
      "X-Accel-Buffering": "no",
    },
  });
}

function extractText(msg: Anthropic.Message | null): string {
  if (!msg) return "";
  // Web search splits a single response into multiple text blocks where
  // citations attach. Joining with "\n\n" would turn each split into its own
  // paragraph and orphan fragments like ", and" onto their own lines. Use a
  // blank separator so the prose flows; Claude already emits its own \n\n
  // between real paragraphs inside each block.
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function fallbackDrugLookup(rawQuery: string) {
  const ctx = newContext();
  const query = rawQuery.trim();
  if (!query) {
    return {
      content:
        "The AI assistant isn't configured on this server yet (missing `ANTHROPIC_API_KEY`). I can still look drugs up directly — try typing a drug name like *amoxicillin* or *insulin glargine*.",
      drugs: ctx.drugs,
      subs: ctx.subs,
      classes: ctx.classes,
      degraded: true,
    };
  }

  try {
    const hits = (await executeTool("search_drugs", { query, limit: 5 }, ctx)) as Array<{
      drug_id: string;
      generic_name: string;
    }>;

    if (!hits || hits.length === 0) {
      return {
        content: `I couldn't find a drug matching **${query}** in the Mederti database. The AI assistant isn't configured on this server (missing \`ANTHROPIC_API_KEY\`), so I can only do direct database lookups right now. Try a generic name like *amoxicillin* or *insulin glargine*.`,
        drugs: ctx.drugs,
        subs: ctx.subs,
        classes: ctx.classes,
        degraded: true,
      };
    }

    const top = hits[0];
    await executeTool("get_drug_details", { drug_id: top.drug_id }, ctx);
    const detail = ctx.drugs[top.drug_id];
    const active = detail?.active_shortage_count ?? 0;
    const countries = detail?.countries_affected?.length ?? 0;

    const headline = active > 0
      ? `**${detail?.generic_name ?? top.generic_name}** — ${active} active shortage${active === 1 ? "" : "s"} across ${countries} ${countries === 1 ? "country" : "countries"}.`
      : `**${detail?.generic_name ?? top.generic_name}** — no active shortages on record.`;

    const altLine =
      hits.length > 1
        ? `\n\nOther matches: ${hits.slice(1).map((h) => h.generic_name).join(", ")}.`
        : "";

    const footnote =
      "\n\n_AI assistant is offline (missing `ANTHROPIC_API_KEY`) — showing direct database lookup. Synthesis, multi-drug comparisons, and macro questions won't work until the key is provisioned._";

    return {
      content: `${headline}\n\n<drug_card id="${top.drug_id}" />${altLine}${footnote}`,
      drugs: ctx.drugs,
      subs: ctx.subs,
      classes: ctx.classes,
      degraded: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chat fallback] error:", msg);
    return {
      content: "",
      drugs: ctx.drugs,
      subs: ctx.subs,
      classes: ctx.classes,
      error: `Lookup failed: ${msg}`,
      degraded: true,
    };
  }
}
