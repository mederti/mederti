import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { STRATEGIST_PERSONA } from "@/lib/ai/supplier-insights";
import { recordAiUsage } from "@/lib/ai/usage-log";
import {
  type RangeKey,
  DEFAULT_RANGE,
  isRangeKey,
  getSnapshot,
  buildFallbackSummary,
  snapshotToBrief,
} from "@/lib/insights/dashboard-snapshot";

export const runtime = "nodejs";

// Mirror the chat route's model resolution. (The shared generateJson helper
// pins an older sonnet id that 404s for this org, so we call Claude directly.)
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Refresh the market read on this cadence. The Claude call only runs on a cache
// miss; every visit in between serves the cached prose. Keep in step with how
// often the underlying figures actually move.
const REVALIDATE_SECONDS = 6 * 60 * 60; // 6 hours

const SYSTEM = `${STRATEGIST_PERSONA}

You are writing the market read that sits at the top of a national medicines-shortage dashboard, read by regulators, hospital procurement and policy staff. Given the dashboard's current figures, write 2–3 sentences of analyst commentary on the state of the market.

Interpret, do not list. The numbers are already on the page below you — your job is to say what they mean: where the real pressure is, how this market compares with its peers, and what the leading signals suggest is coming. Lead with the single most important read. Name specific drugs, classes or countries only when they carry the point.

Output strictly as JSON: {"summary": "<the 2-3 sentence commentary as one paragraph>"}. No prose outside the JSON.`;

async function generateSummary(range: RangeKey): Promise<string> {
  const snapshot = getSnapshot(range);
  const brief = snapshotToBrief(snapshot);
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM,
    messages: [{ role: "user", content: `Dashboard (${snapshot.rangeLabel}):\n\n${brief}` }],
  });
  recordAiUsage({ route: "/api/insights/dashboard-summary", model: MODEL, response, latency_ms: Date.now() - t0 });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const { summary } = JSON.parse(text) as { summary: string };
  const trimmed = (summary || "").trim();
  if (!trimmed) throw new Error("empty summary");
  return trimmed;
}

// Cache the generated prose per range so Claude is only called on a miss /
// after revalidate. Each range keeps its own cached read.
function getCachedSummary(range: RangeKey): Promise<string> {
  return unstable_cache(() => generateSummary(range), ["dashboard-market-read", range], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["dashboard-market-read"],
  })();
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("range");
  const range: RangeKey = isRangeKey(param) ? param : DEFAULT_RANGE;
  try {
    const summary = await getCachedSummary(range);
    return NextResponse.json({ summary, range, source: "ai" });
  } catch (err) {
    // No API key, model error, or invalid JSON — never leave the band empty.
    console.error("[dashboard-summary] falling back to static read:", err);
    return NextResponse.json({ summary: buildFallbackSummary(getSnapshot(range)), range, source: "fallback" });
  }
}
