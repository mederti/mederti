import type { LatLng } from "@/lib/geo/country-centroids";

/**
 * Hand-curated HQ cities for the regulators/sources in `data_sources`.
 *
 * These are stable public knowledge (agency headquarters), so a static
 * lookup is more accurate than geocoding and needs no schema change.
 * Coordinates are CITY-level, deliberately — we promise "which city",
 * not a street address.
 *
 * Resolution order in /api/map-data: abbreviation override (for sources
 * that aren't the national medicines agency, e.g. NHS-BSA in Newcastle)
 * -> national agency city by country_code -> country centroid fallback
 * (marker is then labelled country-level).
 */

export type HqLocation = LatLng & { city: string };

// National medicines-agency HQ city per country code.
export const REGULATOR_HQ_BY_COUNTRY: Record<string, HqLocation> = {
  US: { city: "Silver Spring, MD", lat: 39.004, lng: -77.019 }, // FDA
  CA: { city: "Ottawa", lat: 45.421, lng: -75.697 }, // Health Canada
  GB: { city: "London", lat: 51.507, lng: -0.128 }, // MHRA
  EU: { city: "Amsterdam", lat: 52.37, lng: 4.895 }, // EMA
  AU: { city: "Canberra", lat: -35.281, lng: 149.129 }, // TGA
  NZ: { city: "Wellington", lat: -41.286, lng: 174.776 }, // Medsafe / Pharmac
  DE: { city: "Bonn", lat: 50.735, lng: 7.1 }, // BfArM
  FR: { city: "Saint-Denis (Paris)", lat: 48.936, lng: 2.357 }, // ANSM
  IT: { city: "Rome", lat: 41.903, lng: 12.496 }, // AIFA
  ES: { city: "Madrid", lat: 40.417, lng: -3.703 }, // AEMPS
  NL: { city: "Utrecht", lat: 52.091, lng: 5.121 }, // CBG-MEB
  BE: { city: "Brussels", lat: 50.85, lng: 4.352 }, // FAMHP
  CH: { city: "Bern", lat: 46.948, lng: 7.447 }, // Swissmedic
  AT: { city: "Vienna", lat: 48.208, lng: 16.373 }, // AGES
  SE: { city: "Uppsala", lat: 59.858, lng: 17.639 }, // Läkemedelsverket
  NO: { city: "Oslo", lat: 59.913, lng: 10.752 }, // NOMA
  DK: { city: "Copenhagen", lat: 55.676, lng: 12.568 }, // DKMA
  FI: { city: "Kuopio", lat: 62.892, lng: 27.677 }, // Fimea
  IE: { city: "Dublin", lat: 53.349, lng: -6.26 }, // HPRA
  PT: { city: "Lisbon", lat: 38.722, lng: -9.139 }, // INFARMED
  GR: { city: "Athens", lat: 37.984, lng: 23.728 }, // EOF
  CZ: { city: "Prague", lat: 50.075, lng: 14.437 }, // SÚKL
  SK: { city: "Bratislava", lat: 48.148, lng: 17.107 }, // ŠÚKL SK
  HU: { city: "Budapest", lat: 47.497, lng: 19.04 }, // OGYÉI
  PL: { city: "Warsaw", lat: 52.229, lng: 21.012 }, // URPL
  SG: { city: "Singapore", lat: 1.352, lng: 103.819 }, // HSA
  MY: { city: "Petaling Jaya", lat: 3.107, lng: 101.606 }, // NPRA
  JP: { city: "Tokyo", lat: 35.676, lng: 139.65 }, // PMDA
  KR: { city: "Cheongju (Osong)", lat: 36.642, lng: 127.489 }, // MFDS
  CN: { city: "Beijing", lat: 39.904, lng: 116.407 }, // NMPA
  IN: { city: "New Delhi", lat: 28.614, lng: 77.209 }, // CDSCO
  SA: { city: "Riyadh", lat: 24.713, lng: 46.675 }, // SFDA
  AE: { city: "Abu Dhabi", lat: 24.454, lng: 54.377 }, // EDE
  BR: { city: "Brasília", lat: -15.794, lng: -47.882 }, // ANVISA
  MX: { city: "Mexico City", lat: 19.433, lng: -99.133 }, // COFEPRIS
  ZA: { city: "Pretoria", lat: -25.746, lng: 28.188 }, // SAHPRA
  NG: { city: "Abuja", lat: 9.077, lng: 7.399 }, // NAFDAC
  IL: { city: "Jerusalem", lat: 31.769, lng: 35.216 }, // Israel MoH
  TR: { city: "Ankara", lat: 39.933, lng: 32.86 }, // TITCK
  AR: { city: "Buenos Aires", lat: -34.604, lng: -58.382 }, // ANMAT
  HK: { city: "Hong Kong", lat: 22.32, lng: 114.17 }, // Drug Office
  TW: { city: "Taipei", lat: 25.033, lng: 121.565 }, // TFDA
  EE: { city: "Tartu", lat: 58.378, lng: 26.729 }, // Ravimiamet
};

// Overrides for sources that are NOT at the national agency's HQ.
// Keyed by the exact `data_sources.abbreviation` value.
export const REGULATOR_HQ_BY_ABBREVIATION: Record<string, HqLocation> = {
  "NHS-BSA": { city: "Newcastle upon Tyne", lat: 54.978, lng: -1.618 },
  NADAC: { city: "Woodlawn, MD", lat: 39.29, lng: -76.735 }, // CMS
  "EDQM-CEP": { city: "Strasbourg", lat: 48.573, lng: 7.752 },
  "CT.gov": { city: "Bethesda, MD", lat: 38.984, lng: -77.094 }, // NLM/NIH
};

export function regulatorHqLocation(
  abbreviation: string | null | undefined,
  countryCode: string | null | undefined,
): HqLocation | null {
  if (abbreviation && REGULATOR_HQ_BY_ABBREVIATION[abbreviation]) {
    return REGULATOR_HQ_BY_ABBREVIATION[abbreviation];
  }
  if (countryCode && REGULATOR_HQ_BY_COUNTRY[countryCode.toUpperCase()]) {
    return REGULATOR_HQ_BY_COUNTRY[countryCode.toUpperCase()];
  }
  return null;
}
