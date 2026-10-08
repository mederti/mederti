/**
 * Coverage claims — the ONE place the site says how much it covers.
 *
 * Pages used to hardcode "50+", "40", "22" countries and "160K" vs "216,000"
 * drugs, and the live stat counted every data_sources row (55 — including
 * scrapers that had never written a row). An outside review lined these up
 * side by side and the disagreement read as unreliable data.
 *
 * Rules:
 *   - Live surfaces call liveCoverage(): only countries/regulators with at
 *     least one open, non-synthetic shortage row count as covered.
 *   - Static copy (metadata, SEO descriptions) uses COVERAGE_COPY, which are
 *     deliberately conservative FLOORS. Re-check them against liveCoverage()
 *     before raising — 2026-10-08: 38 countries + EU, 46 regulator feeds with
 *     open rows, 20,874 canonical medicines, 160,977 catalogue products.
 */
export const COVERAGE_COPY = {
  countries: "35+ countries",
  regulators: "40+ official regulators",
  medicines: "20,000+ medicines",
  products: "160,000+ registered products",
} as const;
