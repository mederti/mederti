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
// Headroom for tool-heavy turns + extended-thinking reasoning tokens. The
// answer prose itself is kept brief by the system prompt (cards/tables carry
// the facts); this ceiling is for thinking + multi-tool rounds, not long prose.
const MAX_OUTPUT_TOKENS = 16384;

type ArticleContext = {
  title: string;
  category?: string;
  summary?: string;
  body: string;
};

type IncomingBody = {
  messages: ChatMessage[];
  // When the chat is opened alongside an intelligence article (the reading
  // layout), the article body is passed here so answers are grounded in it.
  article_context?: ArticleContext;
};

// Build the article-grounding system block that gets appended (uncached)
// after the main cached SYSTEM_PROMPT when the user is reading an article.
// Kept separate so the big prompt stays cacheable while the per-article body
// rides as a small trailing block.
function articleSystemBlock(article: ArticleContext): string {
  // Cap the body so a very long article can't blow the context window. ~12k
  // chars (~3k tokens) is plenty for grounding; the model can still call
  // tools for live data beyond what the article states.
  const body = article.body.length > 12000 ? article.body.slice(0, 12000) + "\n\n[…article truncated]" : article.body;
  return [
    "The user is currently viewing the following Mederti content (an intelligence article, dashboard, or analytical view) and their questions are about it.",
    "Ground your answers in this content first, then use the Mederti database/tools for live shortage, drug, and substitute data when the user asks about specifics. If the content shown and the live data disagree, trust the live data and say so. Note that dashboard/view content may contain illustrative sample figures — when asked for exact current numbers, prefer the live tools.",
    "Keep answers tight and operational. Do not restate the whole thing back to the user.",
    "",
    `TITLE: ${article.title}`,
    article.category ? `CONTEXT: ${article.category}` : "",
    "--- CONTENT ---",
    body,
    "--- END CONTENT ---",
  ]
    .filter(Boolean)
    .join("\n");
}

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

// ── Tier 1 ───────────────────────────────────────────────────────────────
// Instant DB-grounded opener for single-drug questions. Bypasses Claude
// entirely for the headline + drug card so the user sees a useful answer
// within ~1–2s instead of ~10s. See call-site in POST for the full flow.

type Tier1Call = {
  name: string;
  id: string;
  input: Record<string, unknown>;
  result: unknown;
};

type Tier1Result = {
  drugId: string;
  headline: string;
  calls: Tier1Call[];
};

// Emit a tool_start, run the tool, emit a tool_done. Returns the result
// so the caller can keep working with it. Mirrors what the Tier 2 loop
// does for Claude's tool_use blocks, but without an LLM round-trip.
async function tier1RunTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ReturnType<typeof newContext>,
  write: (event: any) => Promise<void>
): Promise<{ id: string; result: unknown }> {
  // Synthetic ID. Anthropic tool_use_ids look like `toolu_...`; matching
  // that shape keeps the synthetic history believable when we feed it
  // back to Claude in Tier 2.
  const id = `toolu_t1_${Math.random().toString(36).slice(2, 14)}`;
  await write({ type: "tool_start", name, id, input });
  const t0 = Date.now();
  let result: unknown = null;
  let errored = false;
  try {
    result = await executeTool(name, input, ctx);
  } catch (err) {
    errored = true;
    console.error(`[tier1 ${name}] error:`, err);
  }
  await write({
    type: "tool_done",
    name,
    id,
    ms: Date.now() - t0,
    result_count: countResults(result),
    error: errored || undefined,
  });
  return { id, result };
}

// Stopwords + question-shape words that shouldn't be sent to FTS. The
// drug-name FTS path AND-matches every token, so a phrase like "Is X in
// shortage in Australia?" silently returns zero rows because the drugs
// table's search_vector contains the drug name, not domain words like
// "shortage" or country names. We strip these before searching.
const TIER1_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "in", "on", "at", "of", "for", "with", "by", "to", "from", "about",
  "do", "does", "did", "can", "could", "will", "would", "should",
  "has", "have", "had", "any", "some", "and", "or", "but",
  "what", "where", "when", "why", "how", "which", "who",
  "me", "my", "we", "our", "us", "you", "your", "i",
  "shortage", "shortages", "supply", "stock", "stockout", "available",
  "country", "countries", "currently", "now", "today",
  "drug", "medicine", "medication", "tell", "show", "give",
]);

// Country/region words that frequently appear in chat questions but
// would AND-out the drug name match. Stripped from the FTS query and
// re-injected as the `country` bias parameter when recognised.
const COUNTRY_HINTS: Record<string, string> = {
  australia: "AU", au: "AU", "aus": "AU",
  uk: "GB", britain: "GB", england: "GB", "united kingdom": "GB",
  us: "US", usa: "US", america: "US", "united states": "US",
  canada: "CA", germany: "DE", france: "FR", spain: "ES", italy: "IT",
  netherlands: "NL", belgium: "BE", ireland: "IE", "new zealand": "NZ",
  nz: "NZ", singapore: "SG", japan: "JP", korea: "KR",
};

function extractTier1Query(question: string): { query: string; country?: string } | null {
  const lower = question.toLowerCase();

  // Detect a country hint (longest match first so "new zealand" beats "zealand")
  let country: string | undefined;
  for (const phrase of Object.keys(COUNTRY_HINTS).sort((a, b) => b.length - a.length)) {
    if (lower.includes(phrase)) {
      country = COUNTRY_HINTS[phrase];
      break;
    }
  }

  // Tokenise on punctuation + whitespace, drop stopwords + countries +
  // short tokens. What's left should be drug-name-shaped.
  const tokens = lower
    .split(/[\s,.?!;:()/\-]+/)
    .map((t) => t.replace(/[^a-z0-9'-]/g, ""))
    .filter((t) => t.length >= 3 && !TIER1_STOPWORDS.has(t) && !COUNTRY_HINTS[t]);

  if (tokens.length === 0) return null;

  // Cap at the first 3 surviving tokens — covers single-word drugs and
  // 2-token names like "insulin glargine" or "amoxicillin clavulanate".
  return { query: tokens.slice(0, 3).join(" "), country };
}

async function runTier1({
  question,
  ctx,
  write,
}: {
  question: string;
  ctx: ReturnType<typeof newContext>;
  write: (event: any) => Promise<void>;
}): Promise<Tier1Result | null> {
  const q = question.trim();
  if (!q || q.length > 240) return null;

  // Question-shape filter: skip Tier 1 for landscape / class / macro
  // questions, which the templated headline can't sensibly answer. These
  // patterns mean "many drugs" or "structural cause" — both wrong for
  // a single-drug card.
  if (/\b(landscape|critical|globally|what['']s driving|geopolitic|macro|class|antibiotic[s]?|hormuz|recall[s]?|compare|comparison|substitut)/i.test(q)) {
    return null;
  }

  const extracted = extractTier1Query(q);
  if (!extracted) return null;

  try {
    // 1) Resolve the drug. We strip stopwords first because the drugs
    //    search vector contains drug names, not domain words like
    //    "shortage" or country names — sending the raw question would
    //    AND-out the actual drug name.
    const searchInput = {
      query: extracted.query,
      limit: 5,
      ...(extracted.country ? { country: extracted.country } : {}),
    };
    const search = await tier1RunTool("search_drugs", searchInput, ctx, write);
    const hits = Array.isArray(search.result) ? search.result : [];
    if (hits.length === 0) return null;

    // Disambiguation: prefer the hit whose generic_name is an EXACT
    // match for one of the query tokens (ignoring case). Without this
    // step `search_drugs("amoxicillin", country: "AU")` can return
    // `Amoxicillin/Clavulanate` first because of country-bias activity,
    // even though the user clearly meant plain Amoxicillin. Falling
    // back to hits[0] only when no exact match exists.
    const queryTokens = new Set(extracted.query.toLowerCase().split(/\s+/));
    type Hit = { drug_id?: string; id?: string; generic_name?: string };
    const isExact = (h: Hit) => {
      const gn = (h.generic_name || "").toLowerCase().trim();
      return queryTokens.has(gn);
    };
    const top = (hits as Hit[]).find(isExact) ?? (hits[0] as Hit);
    const drugId = top.drug_id || top.id;
    const genericName = (top.generic_name || "").trim();
    if (!drugId || !genericName) return null;

    // Confidence: the drug's name (first salient word) must appear in
    // the user's question. Filters out cases where search_drugs returned
    // a low-quality fallback match for a macro question.
    const firstWord = genericName.toLowerCase().split(/[\s/;,()]/)[0];
    const questionLower = q.toLowerCase();
    if (firstWord.length < 4 || !questionLower.includes(firstWord)) return null;

    // 2) Fetch details + substitutes in parallel — these are independent
    //    and together populate everything we need for the card +
    //    Tier 2's substitutes table.
    const detailsInput = { drug_id: drugId };
    const subsInput = { drug_id: drugId };
    const [details, subs] = await Promise.all([
      tier1RunTool("get_drug_details", detailsInput, ctx, write),
      tier1RunTool("find_substitutes", subsInput, ctx, write),
    ]);

    // 3) Compose the templated headline from ctx.drugs (populated by
    //    get_drug_details). No LLM involved.
    const detail = ctx.drugs[drugId] as
      | { generic_name?: string; active_shortage_count?: number; countries_affected?: string[] }
      | undefined;
    const drugName = detail?.generic_name || genericName;
    const active = detail?.active_shortage_count ?? 0;
    const countries = detail?.countries_affected ?? [];
    const countryStr =
      countries.length > 0
        ? ` across ${countries.length} ${countries.length === 1 ? "country" : "countries"} (${countries.slice(0, 4).join(", ")}${countries.length > 4 ? "…" : ""})`
        : "";
    const headline =
      active > 0
        ? `**Yes — ${drugName}** has ${active} active shortage${active === 1 ? "" : "s"}${countryStr}.\n\n<drug_card id="${drugId}" />\n\n`
        : `**No active shortages** on record for **${drugName}**.\n\n<drug_card id="${drugId}" />\n\n`;

    await write({ type: "text_delta", delta: headline });

    return {
      drugId,
      headline,
      calls: [
        { name: "search_drugs", id: search.id, input: searchInput, result: search.result },
        { name: "get_drug_details", id: details.id, input: detailsInput, result: details.result },
        { name: "find_substitutes", id: subs.id, input: subsInput, result: subs.result },
      ],
    };
  } catch (err) {
    console.error("[tier1] uncaught:", err);
    return null;
  }
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

  // Optional article grounding (reading layout). Validated minimally; a
  // malformed payload just falls through to a normal chat.
  const articleContext: ArticleContext | null =
    body.article_context &&
    typeof body.article_context.body === "string" &&
    body.article_context.body.length > 0 &&
    typeof body.article_context.title === "string"
      ? body.article_context
      : null;

  // System blocks: the big prompt stays cached; the per-article body rides as
  // a small trailing (uncached) block when present. Reused across the tool
  // loop and the final-synthesis stream so grounding is consistent.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (articleContext) {
    systemBlocks.push({ type: "text", text: articleSystemBlock(articleContext) });
  }

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

  const lastUserText =
    [...incoming].reverse().find((m) => m.role === "user")?.text ?? "";

  return ndjsonResponse(async (write) => {
    let truncated = false;
    let toolCalls = 0;
    let lastResponse: Anthropic.Message | null = null;
    let assembledText = "";

    // ── Tier 1: instant DB-grounded headline + drug card ─────────────────
    // For single-drug questions, the route does search_drugs +
    // get_drug_details + find_substitutes itself, in parallel, before
    // Claude is involved at all. Templated headline + <drug_card /> hit
    // the stream within ~1–2s. Claude then takes over (Tier 2) to write
    // the substitutes table + synthesis + sources, with the Tier 1 tool
    // results pre-seeded as synthetic tool_use / tool_result blocks so
    // it doesn't repeat the calls.
    //
    // Skipped when the question doesn't look single-drug (macro,
    // landscape, recall, comparison) — those fall straight through to
    // Tier 2. The confidence check is the top search_drugs hit's
    // generic-name first word appearing in the user's question.
    // Skip the single-drug Tier 1 opener when grounding on an article — the
    // templated drug headline would hijack an article-scoped question.
    const tier1 = articleContext
      ? null
      : await runTier1({ question: lastUserText, ctx, write });
    if (tier1) {
      toolCalls += tier1.calls.length;
      assembledText += tier1.headline;
      // Seed the conversation with synthetic tool history so Claude
      // sees the Tier 1 results as if it had made the calls itself.
      // The post-seed user message instructs Claude to continue from
      // the substitutes section (don't repeat the opener).
      messages.push({
        role: "assistant",
        content: tier1.calls.map((c) => ({
          type: "tool_use" as const,
          id: c.id,
          name: c.name,
          input: c.input,
        })),
      });
      messages.push({
        role: "user",
        content: tier1.calls.map((c) => ({
          type: "tool_result" as const,
          tool_use_id: c.id,
          content: JSON.stringify(c.result ?? null),
        })),
      });
      messages.push({
        role: "user",
        content: `[Continuation instruction — not from end user] You've already opened the answer with a 1-sentence headline and <drug_card id="${tier1.drugId}" />. Do NOT repeat them. Continue from the substitutes section onwards: substitutes table (use find_substitutes data above), at most 1–3 short sentences of context, <sources>, <followups>.`,
      });
    }

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          // adaptive thinking removed for latency — model still reasons
          // about tool use and synthesis, just without the explicit
          // extended-thinking budget that was adding 5–15s per round.
          output_config: {
            effort: "medium",
          },
          system: systemBlocks,
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
          // adaptive thinking removed for latency — model still reasons
          // about tool use and synthesis, just without the explicit
          // extended-thinking budget that was adding 5–15s per round.
          output_config: {
            effort: "medium",
          },
          system: systemBlocks,
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
      //
      // Tier 1's templated headline (with the only <drug_card /> tag) is
      // prepended to assembledText but NOT in Claude's final message —
      // extractText would silently drop it, and the frontend would render
      // the answer with no card. Re-prepend the Tier 1 headline when
      // extractText is the source of truth.
      const claudeText = extractText(lastResponse);
      const finalText = claudeText
        ? (tier1 ? tier1.headline + claudeText : claudeText)
        : assembledText;

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
      // Log the raw upstream detail for debugging, but never leak it to the
      // client (e.g. Anthropic "credit balance too low", rate-limit internals).
      console.error("[chat] fatal:", msg);
      await write({
        type: "error",
        message: "The AI assistant is temporarily unavailable. Please try again in a moment.",
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
