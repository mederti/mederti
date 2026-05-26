// Live coverage allowlist for chat tools. Source of truth for what countries
// the chat layer is allowed to make assertions about. Derived from a DB audit
// on 2026-05-26 (see scripts/audit_country_rows.py).
//
// IMPORTANT: when a scraper that currently produces 0 rows comes back online,
// add its country code here so the chat unblocks. To regenerate the lists,
// re-run `python3 scripts/audit_country_rows.py` and inspect which countries
// have rows in the last 30 days.

export type CoverageStatus = "live" | "stale" | "not_indexed";

// Countries with shortage rows in the last 30 days.
export const SHORTAGE_COVERAGE: Record<string, CoverageStatus> = {
  AU: "live",
  US: "live",
  CA: "live",
  DE: "live",
  FR: "live",
  IT: "live",
  ES: "live",
  NL: "live",
  IE: "live",
  CH: "live",
  NO: "live",
  FI: "live",
  NZ: "live",
  JP: "live",
  EU: "live",
  GB: "stale", // last shortage row 2026-04-24 — mhra scraper slowing
  SG: "stale", // last shortage row 2026-04-15 — hsa scraper slowing
  // Excluded (no rows in 60+ days, treat as not_indexed):
  //   BE, GR, MY, PT, AE — historical one-shot imports, scrapers not on cron
  //   AT, CZ, DK, HU, SE — cron job runs but writes zero rows (bug)
  //   BR, KR, MX, NG, SA, ZA — phase 9+ scrapers, cron job runs but writes zero rows
};

// Countries with recall rows in the last 30 days.
export const RECALL_COVERAGE: Record<string, CoverageStatus> = {
  US: "live",
  CA: "live",
  AU: "live",
  EU: "live",
  GB: "live",
  // Excluded:
  //   IT, FR — historical one-shot imports (frozen 2026-03-19), scrapers not on cron
  //   DE, ES, NZ, SG — recall scrapers exist in repo but not wired to cron
};

export function getShortageCoverage(cc: string): CoverageStatus {
  return SHORTAGE_COVERAGE[cc.toUpperCase()] ?? "not_indexed";
}

export function getRecallCoverage(cc: string): CoverageStatus {
  return RECALL_COVERAGE[cc.toUpperCase()] ?? "not_indexed";
}

export function indexedShortageCountries(): string[] {
  return Object.keys(SHORTAGE_COVERAGE).sort();
}

export function indexedRecallCountries(): string[] {
  return Object.keys(RECALL_COVERAGE).sort();
}

export type CoverageGateResult = {
  coverage_status: "not_indexed";
  country: string;
  message: string;
  indexed_countries: string[];
};

// Returns a sentinel response when the country isn't indexed for this table.
// The chat tool dispatcher returns this instead of calling the DB, so the
// model gets an explicit signal — never an empty array that could be misread
// as "no current activity in a covered country".
export function coverageGate(
  table: "shortages" | "recalls",
  country: string | undefined
): CoverageGateResult | null {
  if (!country) return null;
  const cc = country.toUpperCase();
  const status = table === "shortages" ? getShortageCoverage(cc) : getRecallCoverage(cc);
  if (status !== "not_indexed") return null;
  const indexed = table === "shortages" ? indexedShortageCountries() : indexedRecallCountries();
  return {
    coverage_status: "not_indexed",
    country: cc,
    message: `Mederti does not currently index ${table} from ${cc}. Tell the user this is a coverage gap, not "no current ${table}". Indexed ${table} countries: ${indexed.join(", ")}.`,
    indexed_countries: indexed,
  };
}
