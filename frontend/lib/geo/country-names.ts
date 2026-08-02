/**
 * Single source of truth for country code → display name, for every country
 * Mederti tracks (or has tracked) shortage data in.
 *
 * NOTE: COUNTRY_NAMES maps are currently copy-pasted in ~13 files with
 * inconsistent coverage (19–37 entries each). New code should import from
 * here; migrating the existing duplicates is a follow-up cleanup.
 *
 * Slugs are derived (kebab-case) and stable — they are public URL segments
 * on /country/[slug]/medicine-shortages, so never rename an entry without a
 * redirect.
 */

export const COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates",
  AR: "Argentina",
  AT: "Austria",
  AU: "Australia",
  BA: "Bosnia and Herzegovina",
  BE: "Belgium",
  BR: "Brazil",
  CA: "Canada",
  CH: "Switzerland",
  CN: "China",
  CO: "Colombia",
  CZ: "Czech Republic",
  DE: "Germany",
  DK: "Denmark",
  EE: "Estonia",
  ES: "Spain",
  EU: "European Union",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GR: "Greece",
  HK: "Hong Kong",
  HR: "Croatia",
  HU: "Hungary",
  IE: "Ireland",
  IN: "India",
  IS: "Iceland",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  LK: "Sri Lanka",
  LT: "Lithuania",
  LV: "Latvia",
  MX: "Mexico",
  MY: "Malaysia",
  NG: "Nigeria",
  NL: "Netherlands",
  NO: "Norway",
  NZ: "New Zealand",
  PE: "Peru",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  SA: "Saudi Arabia",
  SE: "Sweden",
  SG: "Singapore",
  SI: "Slovenia",
  SK: "Slovakia",
  SN: "Senegal",
  TH: "Thailand",
  TR: "Turkey",
  TW: "Taiwan",
  US: "United States",
  ZA: "South Africa",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Kebab-case URL slug for a country code, e.g. GB → "united-kingdom". */
export function countrySlug(code: string): string {
  return countryName(code)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.keys(COUNTRY_NAMES).map((code) => [countrySlug(code), code]),
);

/** Resolve a /country/[slug] URL segment back to an ISO-2 code, or null. */
export function countryCodeFromSlug(slug: string): string | null {
  return SLUG_TO_CODE[slug.toLowerCase()] ?? null;
}
