/**
 * Types, labels and constants for the National Shortage Dashboard that both
 * the server builder (dashboard-data.ts) and browser code (the view, the PDF)
 * use. No server imports here.
 */

export type ConcentrationTier = "highly_concentrated" | "concentrated" | "broad" | "unknown";

export interface EssentialRow {
  inn: string;
  name: string;
  whoList: "core" | "complementary" | null;
  euCritical: boolean;
  daysShort: number | null;          // days since the earliest active report here was first reported
  tier: ConcentrationTier;
  nApiMakers: number | null;
  nFinishedFirms: number | null;      // US finished-dose firms (Drugs@FDA, recalls)
  topApiCountry: string | null;
  topApiShare: number | null;         // 0–1 share of API makers in that country
  countriesShort: number;             // all markets, incl. this one
}

export interface BoardPoint {
  inn: string;
  name: string;
  concentration: number;              // fragility 0–1
  countriesShort: number;
  shortHere: boolean;
  tier: ConcentrationTier;
  nApiMakers: number | null;
}

export interface DashboardData {
  country: string;
  generatedAt: string;
  latestReportAt: string | null;      // newest shortage_events.updated_at in this market
  universeSize: number;               // molecules on WHO Model List ∪ EU Union list
  kpis: {
    activeReports: number;            // active shortage_events rows in this market
    newLast30: number;                // reports starting in the last 30 days
    essentialShort: number;           // essential/critical molecules short here now
    essentialShortConcentrated: number; // …of which with concentrated supply
    medianResolutionDays: number | null; // resolved here in the last 12 months
    resolvedLast12mo: number;
    earlyWarning: number;             // essential molecules short in ≥2 peers, not reported here
  };
  essential: EssentialRow[];          // short here now, most concentrated first
  earlyWarning: Array<{ inn: string; name: string; peers: string[]; tier: ConcentrationTier }>;
  board: BoardPoint[];
  peers: Array<{ country: string; essentialShort: number; self: boolean }>;
  apiCountries: Array<{ country: string; molecules: number }>; // largest API-maker country per molecule
  scoresComputedAt: string | null;
}

// Mirrors /api/predictive-signals so "peer" means the same thing on every page.
export const PEER_GROUPS: Record<string, string[]> = {
  GB: ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  IE: ["GB", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  AU: ["NZ", "GB", "US", "CA", "SG"],
  NZ: ["AU", "GB", "US", "CA", "SG"],
  CA: ["US", "GB", "EU", "FR", "DE", "AU"],
  US: ["CA", "GB", "EU", "FR", "DE"],
  IT: ["DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  DE: ["IT", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  FR: ["IT", "DE", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  ES: ["IT", "DE", "FR", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
};

export const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada", DE: "Germany",
  FR: "France", IT: "Italy", ES: "Spain", NZ: "New Zealand", IE: "Ireland", NL: "Netherlands",
  BE: "Belgium", GR: "Greece", PT: "Portugal", AT: "Austria", CH: "Switzerland", FI: "Finland",
  NO: "Norway", SE: "Sweden", DK: "Denmark", SG: "Singapore", JP: "Japan", EU: "EU (EMA)",
  IN: "India", CN: "China",
};

/** Same cut-offs as docs/risk-score-backtest.md: ≈ ≤4 / 5–9 / 10+ API makers. */
export function tierFor(fragility: number | null): ConcentrationTier {
  if (fragility == null) return "unknown";
  if (fragility >= 0.6) return "highly_concentrated";
  if (fragility >= 0.35) return "concentrated";
  return "broad";
}

export const TIER_LABEL: Record<ConcentrationTier, string> = {
  highly_concentrated: "Highly concentrated",
  concentrated: "Concentrated",
  broad: "Broad",
  unknown: "Unknown",
};
