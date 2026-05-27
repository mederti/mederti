import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import { TOOL_DEFINITIONS, executeTool, hydrateReferencedIds, newContext } from "@/lib/chat/tools";
import { checkRateLimit, getClientIp } from "@/lib/chat/rate-limit";
import { recordDemandSignal } from "@/lib/demand-signal";
import { createServerClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITERATIONS = 12;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
// Roomy budget — Claude-led synthesis means most answers are 2–5 paragraphs
// of integrated prose alongside cards. With extended thinking enabled, the
// budget also has to cover the model's reasoning tokens.
const MAX_OUTPUT_TOKENS = 16384;

type IncomingBody = {
  messages: ChatMessage[];
};

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
  // environments where the key hasn't been provisioned yet.
  if (!process.env.ANTHROPIC_API_KEY) {
    const lastUser = [...incoming].reverse().find((m) => m.role === "user");
    const fallback = await fallbackDrugLookup(lastUser?.text || "");
    return Response.json(fallback);
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

  let truncated = false;
  let toolCalls = 0;
  let lastResponse: Anthropic.Message | null = null;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: {
          type: "adaptive",
        },
        output_config: {
          effort: "high",
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

      lastResponse = response;

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          toolCalls += 1;
          try {
            const result = await executeTool(tu.name, tu.input as Record<string, any>, ctx);
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: JSON.stringify(result ?? null),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[tool ${tu.name}] error:`, msg);
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
      lastResponse = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: {
          type: "adaptive",
        },
        output_config: {
          effort: "high",
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
      messages.push({ role: "assistant", content: lastResponse.content });
    }

    const finalText = extractText(lastResponse);

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

    return Response.json({
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
    const status = /429|rate/i.test(msg) ? 429 : 500;
    return Response.json(
      {
        content: "",
        drugs: {},
        error: `Sorry, the assistant had a hiccup: ${msg}`,
      },
      { status }
    );
  }
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
