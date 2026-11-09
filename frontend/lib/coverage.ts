import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export { COVERAGE_COPY } from "@/lib/coverage-copy";

/** Live coverage — see lib/coverage-copy.ts for the rules on coverage claims. */
export interface LiveCoverage {
  /** Countries with ≥1 open shortage row (excludes the EU bloc feed). */
  countries: number;
  /** Regulator feeds (data_sources) with ≥1 open shortage row. */
  regulators: number;
}

const OPEN = ["active", "anticipated"];

// Throws instead of returning null/partial: unstable_cache stores whatever we
// return for 6h, so a transient Supabase blip used to bake "—" (or an
// undercount, when a single probe failed) into the homepage for hours.
// Throwing leaves the cache empty and the next request retries.
async function computeLiveCoverage(): Promise<LiveCoverage> {
  const admin = getSupabaseAdmin();
  const { data: sources, error } = await admin.from("data_sources").select("id, country_code");
  if (error || !sources) throw new Error(`data_sources lookup failed: ${error?.message ?? "no data"}`);

  // One cheap LIMIT 1 probe per source — PostgREST aggregates are disabled
  // and head counts on the big sources are slow. Batched to stay polite.
  const live: { id: string; country_code: string | null }[] = [];
  for (let i = 0; i < sources.length; i += 10) {
    const batch = sources.slice(i, i + 10);
    const probes = await Promise.all(
      batch.map((s) =>
        admin
          .from("shortage_events")
          .select("id")
          .eq("data_source_id", s.id)
          .in("status", OPEN)
          .or("synthetic.is.null,synthetic.eq.false")
          .limit(1),
      ),
    );
    probes.forEach((p, j) => {
      if (p.error) throw new Error(`coverage probe failed for ${batch[j].id}: ${p.error.message}`);
      if (p.data && p.data.length > 0) live.push(batch[j]);
    });
  }

  const countries = new Set(
    live
      .map((s) => (s.country_code || "").toUpperCase())
      .filter((c) => c && c !== "ZZ" && c !== "EU"),
  ).size;
  return { countries, regulators: live.length };
}

/** Live coverage, cached 6h (it moves when a scraper starts/stops producing). */
const cachedLiveCoverage = unstable_cache(computeLiveCoverage, ["mederti-live-coverage"], {
  revalidate: 21600,
});

/** Null on failure (callers show "—"); failures are never cached. */
export async function liveCoverage(): Promise<LiveCoverage | null> {
  try {
    return await cachedLiveCoverage();
  } catch (err) {
    console.error("[coverage] live coverage failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
