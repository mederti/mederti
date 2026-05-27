import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cache 5 minutes — freshness data only changes when scrapers run.
export const revalidate = 300;

/**
 * GET /api/freshness
 *
 * Public freshness dashboard endpoint. Returns per-regulator last_scraped_at
 * + reliability_weight + active flag. Credibility lever for the "world's
 * leading source" positioning (audit §12 open #5).
 *
 * No auth required. Cached for 5 minutes via the route's revalidate.
 *
 * Response shape:
 *   {
 *     generated_at: "2026-05-27T...",
 *     stale_threshold_hours: 168,
 *     regulators: [
 *       {
 *         code: "TGA",
 *         name: "Therapeutic Goods Administration",
 *         country_code: "AU",
 *         region: "Asia-Pacific",
 *         last_scraped_at: "2026-05-27T19:00:00Z",
 *         hours_since_scrape: 4,
 *         is_stale: false,
 *         freshness_label: "scraped today",
 *         reliability_weight: 0.95,
 *         scrape_frequency_hours: 24,
 *         is_active: true,
 *         source_url: "https://www.tga.gov.au/..."
 *       },
 *       ...
 *     ],
 *     summary: {
 *       total: 47,
 *       active: 31,
 *       stale: 4,
 *       fresh_today: 27,
 *     }
 *   }
 */
export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("data_sources")
    .select(
      "abbreviation,name,country_code,region,last_scraped_at,reliability_weight,scrape_frequency_hours,is_active,source_url"
    )
    .order("country_code", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const STALE_HOURS = 168; // matches frontend/lib/chat/tools.ts
  const now = Date.now();

  const regulators = (data ?? []).map((r: any) => {
    let hours_since_scrape: number | null = null;
    let freshness_label = "freshness unknown";
    let is_stale = true;
    if (r.last_scraped_at) {
      const ts = new Date(r.last_scraped_at).getTime();
      if (Number.isFinite(ts)) {
        const hrs = (now - ts) / 3_600_000;
        hours_since_scrape = Math.round(hrs * 10) / 10;
        const days = Math.round(hrs / 24);
        if (hrs < 24) {
          freshness_label = "scraped today";
          is_stale = false;
        } else if (hrs < 48) {
          freshness_label = "scraped yesterday";
          is_stale = false;
        } else if (hrs < STALE_HOURS) {
          freshness_label = `scraped ${days}d ago`;
          is_stale = false;
        } else {
          freshness_label = `scraped ${days}d ago — stale`;
          is_stale = true;
        }
      }
    }
    return {
      code: r.abbreviation,
      name: r.name,
      country_code: r.country_code,
      region: r.region,
      last_scraped_at: r.last_scraped_at,
      hours_since_scrape,
      is_stale,
      freshness_label,
      reliability_weight:
        typeof r.reliability_weight === "number" ? Number(r.reliability_weight) : null,
      scrape_frequency_hours: r.scrape_frequency_hours,
      is_active: !!r.is_active,
      source_url: r.source_url,
    };
  });

  const summary = {
    total: regulators.length,
    active: regulators.filter((r) => r.is_active).length,
    stale: regulators.filter((r) => r.is_stale && r.is_active).length,
    fresh_today: regulators.filter(
      (r) => r.hours_since_scrape != null && r.hours_since_scrape < 24
    ).length,
  };

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      stale_threshold_hours: STALE_HOURS,
      regulators,
      summary,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
