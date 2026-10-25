import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { STRATEGIST_PERSONA } from "@/lib/ai/supplier-insights";
import { recordAiUsage } from "@/lib/ai/usage-log";
import { buildDashboard, buildFallbackRead, dashboardToBrief } from "@/lib/insights/dashboard-data";

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

Interpret, do not list. The numbers are already on the page below you — your job is to say what they mean: where the real pressure is, how this market compares with its peers, and which medicines are short in peer markets but not reported short here. Lead with the single most important read. Name specific drugs or countries only when they carry the point.

Use only the figures given. Every number you write must appear in the figures exactly; never count the items in an example list and never write "several", "many" or "a handful" where a figure exists. Lists in the figures are examples; always use the stated totals, never the length of an example list. Do not state causes or explanations for why shortages persist or arise — none are in the figures. Do not claim trends (rising, building, worsening, faster than) — the figures are a snapshot, not a time series. Do not forecast dates or durations, do not call anything "predicted", and do not invent causes: Mederti's own backtest found supply concentration does not predict when a shortage starts or how long it lasts. "Short in peer markets, not reported here" is an observation, not a forecast: a market whose regulator publishes little will show many such medicines.

Output strictly as JSON: {"summary": "<the 2-3 sentence commentary as one paragraph>"}. No prose outside the JSON.`;

async function generateSummary(country: string): Promise<string> {
  const brief = dashboardToBrief(await buildDashboard(country));
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM,
    messages: [{ role: "user", content: `Dashboard figures (live):\n\n${brief}` }],
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

// Cache the generated prose per market so Claude is only called on a miss /
// after revalidate.
function getCachedSummary(country: string): Promise<string> {
  return unstable_cache(() => generateSummary(country), ["dashboard-market-read", "v3", country], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["dashboard-market-read"],
  })();
}

export async function GET(req: NextRequest) {
  const country = (req.nextUrl.searchParams.get("country") || "AU").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "invalid country" }, { status: 400 });
  try {
    const summary = await getCachedSummary(country);
    return NextResponse.json({ summary, country, source: "ai" });
  } catch (err) {
    // No API key, model error, or invalid JSON — fall back to a plain
    // statement of the live figures. If those fail too, say nothing.
    console.error("[dashboard-summary] falling back to deterministic read:", err);
    try {
      return NextResponse.json({ summary: buildFallbackRead(await buildDashboard(country)), country, source: "fallback" });
    } catch {
      return NextResponse.json({ summary: null, country, source: "unavailable" });
    }
  }
}
