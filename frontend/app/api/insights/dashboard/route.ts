import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { buildDashboard } from "@/lib/insights/dashboard-data";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// GET /api/insights/dashboard?country=AU — live National Shortage Dashboard
// data (see lib/insights/dashboard-data.ts). Cached per market for 30 minutes:
// the inputs move on daily scraper and nightly risk-score cadences.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const getCached = (country: string) =>
  unstable_cache(() => buildDashboard(country), ["insights-dashboard", "v4", country], {
    revalidate: 1800,
    tags: ["insights-dashboard"],
  })();

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "strict");
  if (limited) return limited;
  const country = (req.nextUrl.searchParams.get("country") || "AU").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "invalid country" }, { status: 400 });
  try {
    return NextResponse.json(await getCached(country));
  } catch (err) {
    console.error("[insights/dashboard] build failed:", err);
    return NextResponse.json({ error: "dashboard unavailable" }, { status: 500 });
  }
}
