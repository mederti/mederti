import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import { TOOL_DEFINITIONS, executeTool, hydrateReferencedIds, newContext } from "@/lib/chat/tools";
import { checkRateLimit, getClientIp } from "@/lib/chat/rate-limit";
import type { ChatMessage } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITERATIONS = 8;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { content: "", drugs: {}, error: "Server missing ANTHROPIC_API_KEY." },
      { status: 500 }
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

  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ctx = newContext();

  let truncated = false;
  let toolCalls = 0;
  let lastResponse: Anthropic.Message | null = null;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
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
        max_tokens: 2048,
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

    return Response.json({
      content: finalText,
      drugs: ctx.drugs,
      subs: ctx.subs,
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
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}
