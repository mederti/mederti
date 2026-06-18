/**
 * National Shortage Dashboard — data snapshot.
 *
 * The dashboard (GovDashboardView) currently renders illustrative sample
 * figures ported from an HTML mockup. This module is the single description of
 * those figures so the AI market-read prompt always agrees with the cards on
 * screen. When the cards are wired to live Supabase queries, replace the values
 * here (or generate this object server-side) and the commentary follows for
 * free.
 */

export interface DashboardSnapshot {
  market: string;
  coverage: string;
  kpis: {
    activeShortages: { value: number; delta: string };
    essentialShort: { value: number; of: number; delta: string };
    singleSource: { value: number; delta: string };
    medianResolutionDays: { value: number; delta: string };
    upstreamAlerts: { value: number; delta: string };
  };
  topEssential: Array<{
    drug: string;
    klass: string;
    suppliers: string;
    durationDays: number;
    risk: "Critical" | "High" | "Moderate";
    forecast: string;
  }>;
  concentration: Array<{ klass: string; singleSourcePct: number }>;
  peers: Array<{ country: string; shortagesPer1000: number; self?: boolean }>;
  upstream: Array<{ site: string; country: string; severity: string; note: string }>;
}

/** Mirrors the figures rendered in GovDashboardView. */
export const DASHBOARD_SNAPSHOT: DashboardSnapshot = {
  market: "Australia",
  coverage: "TGA plus 21 benchmarked regulators",
  kpis: {
    activeShortages: { value: 312, delta: "up 18 vs last quarter" },
    essentialShort: { value: 38, of: 204, delta: "6 more WHO EML medicines affected" },
    singleSource: { value: 19, delta: "no change" },
    medianResolutionDays: { value: 112, delta: "9 days faster than the peer median" },
    upstreamAlerts: { value: 7, delta: "3 new India/China sites" },
  },
  topEssential: [
    { drug: "Amoxicillin 500mg", klass: "Antibiotic", suppliers: "1 of 4 active", durationDays: 42, risk: "Critical", forecast: "Aug–Oct 26" },
    { drug: "Methotrexate injection", klass: "Oncology", suppliers: "sole supplier", durationDays: 96, risk: "Critical", forecast: "Q1 27" },
    { drug: "Salbutamol CFC-free", klass: "Bronchodilator", suppliers: "2 of 5 active", durationDays: 28, risk: "High", forecast: "Jul 26" },
    { drug: "Methylphenidate ER 36mg", klass: "Paediatric CNS stimulant", suppliers: "2 of 3 active", durationDays: 61, risk: "High", forecast: "Sep 26" },
    { drug: "Insulin glargine", klass: "Antidiabetic", suppliers: "3 of 4 active", durationDays: 14, risk: "Moderate", forecast: "Jun 26" },
    { drug: "Phenytoin 100mg", klass: "Anticonvulsant", suppliers: "sole supplier", durationDays: 73, risk: "Moderate", forecast: "Aug 26" },
  ],
  concentration: [
    { klass: "Beta-lactam antibiotics", singleSourcePct: 82 },
    { klass: "Oncology injectables", singleSourcePct: 74 },
    { klass: "ADHD stimulants", singleSourcePct: 61 },
    { klass: "Insulins", singleSourcePct: 48 },
    { klass: "Anticonvulsants", singleSourcePct: 39 },
    { klass: "Cardiovascular", singleSourcePct: 22 },
  ],
  peers: [
    { country: "Australia", shortagesPer1000: 18.6, self: true },
    { country: "United Kingdom", shortagesPer1000: 21.3 },
    { country: "Canada", shortagesPer1000: 16.4 },
    { country: "United States", shortagesPer1000: 26.1 },
    { country: "EU (EMA average)", shortagesPer1000: 14.2 },
  ],
  upstream: [
    { site: "Hyderabad — Sandoz API", country: "India", severity: "High", note: "GMP inspection flag; feeds amoxicillin and cephalexin supply, 2 sponsors exposed" },
    { site: "Zhejiang — API intermediate", country: "China", severity: "Watch", note: "export volume down 34% QoQ; single source for a methotrexate precursor" },
    { site: "Gujarat — stimulant API", country: "India", severity: "Watch", note: "environmental closure order; supplies methylphenidate base" },
  ],
};

/**
 * Shown when the AI market-read cannot be generated (no API key, model error).
 * Hand-written in the same register so the band is never empty. Keep it broadly
 * true of the snapshot above so it never contradicts the cards.
 */
export const DASHBOARD_FALLBACK_SUMMARY =
  "Australia carries 312 active shortages, 38 of them on the WHO essential-medicines list, and sits mid-pack against peer regulators — below the US and UK, above the EU average. The sharpest risk is concentration rather than count: beta-lactam antibiotics and oncology injectables each lean on a single API source, and two of the six worst essential shortages now run on a sole supplier. Three upstream India and China sites flagged this fortnight point to further antibiotic and methotrexate pressure ahead.";

/** Render the snapshot into a compact, model-readable brief for the prompt. */
export function snapshotToBrief(s: DashboardSnapshot): string {
  const k = s.kpis;
  const essential = s.topEssential
    .map((d) => `- ${d.drug} (${d.klass}): ${d.suppliers}, ${d.durationDays} days, ${d.risk} risk, easing ${d.forecast}`)
    .join("\n");
  const conc = s.concentration.map((c) => `${c.klass} ${c.singleSourcePct}%`).join(", ");
  const peers = s.peers.map((p) => `${p.country} ${p.shortagesPer1000}${p.self ? " (this market)" : ""}`).join(", ");
  const up = s.upstream.map((u) => `${u.site} [${u.country}, ${u.severity}] — ${u.note}`).join("\n");

  return [
    `MARKET: ${s.market}. Coverage: ${s.coverage}.`,
    "",
    "HEADLINE NUMBERS (this quarter):",
    `- Active shortages: ${k.activeShortages.value} (${k.activeShortages.delta})`,
    `- Essential medicines short: ${k.essentialShort.value} of ${k.essentialShort.of} (${k.essentialShort.delta})`,
    `- Single-source nationally: ${k.singleSource.value} (${k.singleSource.delta})`,
    `- Median resolution: ${k.medianResolutionDays.value} days (${k.medianResolutionDays.delta})`,
    `- Upstream alerts: ${k.upstreamAlerts.value} (${k.upstreamAlerts.delta})`,
    "",
    "WORST ESSENTIAL-MEDICINE SHORTAGES (criticality × duration):",
    essential,
    "",
    `SINGLE-API-SOURCE CONCENTRATION BY CLASS: ${conc}.`,
    "",
    `SHORTAGE BURDEN VS PEERS (active essential shortages per 1,000 listings): ${peers}.`,
    "",
    "UPSTREAM EARLY-WARNING SIGNALS (overseas API sites feeding this market):",
    up,
  ].join("\n");
}
