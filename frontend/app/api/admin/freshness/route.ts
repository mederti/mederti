import { NextResponse } from "next/server";
import { serverError } from "@/lib/security/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Substrings whose presence in drugs.generic_name marks a row as a recall
// headline mistakenly stored as a drug — kept in sync with
// backend/health/detectors._HEADLINE_SUBSTRINGS.
const HEADLINE_SUBSTRINGS = [
  " and the risk of",
  " due to medication",
  " important safety information",
  " updated labelling for",
  " updated labeling for",
  " updated information for",
  " health canada ",
  " recall of ",
  " warning about ",
  " new safety information",
] as const;

const isHeadlineLike = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const padded = ` ${name.toLowerCase()} `;
  return HEADLINE_SUBSTRINGS.some((s) => padded.includes(s));
};

type SourceRow = {
  abbreviation: string;
  country_code: string;
  region: string | null;
  scrape_frequency_hours: number;
  last_scraped_at: string | null;
  is_active: boolean;
};

type SourceFreshness = {
  abbreviation: string;
  country_code: string;
  region: string | null;
  scrape_frequency_hours: number;
  last_scraped_at: string | null;
  hours_since_scrape: number | null;
  status: "ok" | "stale" | "never";
};

const STALE_GRACE_HOURS = 12;

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const now = Date.now();

  // ── 1. Data source freshness ───────────────────────────────────────────────
  const { data: sources, error: srcErr } = await admin
    .from("data_sources")
    .select(
      "abbreviation, country_code, region, scrape_frequency_hours, last_scraped_at, is_active",
    )
    .eq("is_active", true)
    .order("abbreviation");

  if (srcErr) {
    return serverError(srcErr);
  }

  const enriched: SourceFreshness[] = (sources as SourceRow[] | null ?? []).map(
    (s) => {
      if (!s.last_scraped_at) {
        return {
          abbreviation: s.abbreviation,
          country_code: s.country_code,
          region: s.region,
          scrape_frequency_hours: s.scrape_frequency_hours,
          last_scraped_at: null,
          hours_since_scrape: null,
          status: "never",
        };
      }
      const scrapedAt = Date.parse(s.last_scraped_at);
      const hours = (now - scrapedAt) / 3_600_000;
      const threshold = Math.max(s.scrape_frequency_hours ?? 24, 24) + STALE_GRACE_HOURS;
      return {
        abbreviation: s.abbreviation,
        country_code: s.country_code,
        region: s.region,
        scrape_frequency_hours: s.scrape_frequency_hours,
        last_scraped_at: s.last_scraped_at,
        hours_since_scrape: Number(hours.toFixed(1)),
        status: hours > threshold ? "stale" : "ok",
      };
    },
  );

  const summary = {
    active_sources: enriched.length,
    ok: enriched.filter((s) => s.status === "ok").length,
    stale: enriched.filter((s) => s.status === "stale").length,
    never_scraped: enriched.filter((s) => s.status === "never").length,
  };

  // ── 2. Drug catalogue pollution count ──────────────────────────────────────
  // Pull recall-auto-created rows; filter headline-shaped ones in JS to avoid
  // 10 OR-chained ilike filters in the query string.
  const { data: pollutionRows, error: polluteErr } = await admin
    .from("drugs")
    .select("id, generic_name, therapeutic_category")
    .ilike("therapeutic_category", "Auto-created by%Recall%")
    .limit(5000);

  const polluted_drug_count =
    polluteErr || !pollutionRows
      ? null
      : pollutionRows.filter((r) => isHeadlineLike(r.generic_name)).length;

  // ── 3. Recent shortage event count (rough freshness signal) ────────────────
  const cutoff = new Date(now - 48 * 3_600_000).toISOString();
  const { count: recent_shortages_48h } = await admin
    .from("shortage_events")
    .select("id", { count: "exact", head: true })
    .gte("last_verified_at", cutoff);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary: {
      ...summary,
      polluted_drug_count,
      recent_shortages_48h: recent_shortages_48h ?? 0,
    },
    sources: enriched,
  });
}
