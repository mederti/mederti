/**
 * National Shortage Dashboard — data snapshots, one per time range.
 *
 * The dashboard (GovDashboardView) currently renders illustrative sample
 * figures ported from an HTML mockup. This module is the single description of
 * those figures so the range selector (Today / Quarter / YTD / 12mo) drives the
 * KPIs, and the AI market-read prompt always agrees with the cards on screen.
 * When the cards are wired to live Supabase queries, replace the values here
 * (or generate these objects server-side, windowed by range) and both the
 * toggle and the commentary follow for free.
 */

export type RangeKey = "today" | "quarter" | "ytd" | "12mo";

export const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "quarter", label: "Quarter" },
  { key: "ytd", label: "YTD" },
  { key: "12mo", label: "12mo" },
];

export const DEFAULT_RANGE: RangeKey = "quarter";

export function isRangeKey(v: string | null | undefined): v is RangeKey {
  return v === "today" || v === "quarter" || v === "ytd" || v === "12mo";
}

/** A KPI value with its period-scoped comparison delta. */
export interface Kpi {
  value: number;
  of?: number;
  delta: string;
  /** up = rising count (bad, red); down = good (green); flat = neutral. */
  direction: "up" | "down" | "flat";
}

export interface DashboardSnapshot {
  range: RangeKey;
  rangeLabel: string;
  market: string;
  coverage: string;
  kpis: {
    activeShortages: Kpi;
    essentialShort: Kpi;
    singleSource: Kpi;
    medianResolutionDays: Kpi;
    upstreamAlerts: Kpi;
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

// ── Structural surfaces (shared across ranges) ──────────────────────────────
// Supply-base concentration, the worst-offender table and the upstream signals
// describe the system, not a time window, so they don't swing with the range.
// What moves per range is the aggregate counts and their comparison deltas.

const TOP_ESSENTIAL: DashboardSnapshot["topEssential"] = [
  { drug: "Amoxicillin 500mg", klass: "Antibiotic", suppliers: "1 of 4 active", durationDays: 42, risk: "Critical", forecast: "Aug–Oct 26" },
  { drug: "Methotrexate injection", klass: "Oncology", suppliers: "sole supplier", durationDays: 96, risk: "Critical", forecast: "Q1 27" },
  { drug: "Salbutamol CFC-free", klass: "Bronchodilator", suppliers: "2 of 5 active", durationDays: 28, risk: "High", forecast: "Jul 26" },
  { drug: "Methylphenidate ER 36mg", klass: "Paediatric CNS stimulant", suppliers: "2 of 3 active", durationDays: 61, risk: "High", forecast: "Sep 26" },
  { drug: "Insulin glargine", klass: "Antidiabetic", suppliers: "3 of 4 active", durationDays: 14, risk: "Moderate", forecast: "Jun 26" },
  { drug: "Phenytoin 100mg", klass: "Anticonvulsant", suppliers: "sole supplier", durationDays: 73, risk: "Moderate", forecast: "Aug 26" },
];

const CONCENTRATION: DashboardSnapshot["concentration"] = [
  { klass: "Beta-lactam antibiotics", singleSourcePct: 82 },
  { klass: "Oncology injectables", singleSourcePct: 74 },
  { klass: "ADHD stimulants", singleSourcePct: 61 },
  { klass: "Insulins", singleSourcePct: 48 },
  { klass: "Anticonvulsants", singleSourcePct: 39 },
  { klass: "Cardiovascular", singleSourcePct: 22 },
];

const PEERS: DashboardSnapshot["peers"] = [
  { country: "Australia", shortagesPer1000: 18.6, self: true },
  { country: "United Kingdom", shortagesPer1000: 21.3 },
  { country: "Canada", shortagesPer1000: 16.4 },
  { country: "United States", shortagesPer1000: 26.1 },
  { country: "EU (EMA average)", shortagesPer1000: 14.2 },
];

const UPSTREAM: DashboardSnapshot["upstream"] = [
  { site: "Hyderabad — Sandoz API", country: "India", severity: "High", note: "GMP inspection flag; feeds amoxicillin and cephalexin supply, 2 sponsors exposed" },
  { site: "Zhejiang — API intermediate", country: "China", severity: "Watch", note: "export volume down 34% QoQ; single source for a methotrexate precursor" },
  { site: "Gujarat — stimulant API", country: "India", severity: "Watch", note: "environmental closure order; supplies methylphenidate base" },
];

const COMMON = {
  market: "Australia",
  coverage: "TGA plus 21 benchmarked regulators",
  topEssential: TOP_ESSENTIAL,
  concentration: CONCENTRATION,
  peers: PEERS,
  upstream: UPSTREAM,
};

// ── Per-range snapshots ─────────────────────────────────────────────────────
// Counts grow as the window widens (Today → 12mo); deltas are reframed against
// the comparison that fits each window.

export const DASHBOARD_SNAPSHOTS: Record<RangeKey, DashboardSnapshot> = {
  today: {
    ...COMMON,
    range: "today",
    rangeLabel: "Today",
    kpis: {
      activeShortages: { value: 308, delta: "▲ 4 new today", direction: "up" },
      essentialShort: { value: 37, of: 204, delta: "▲ 1 today", direction: "up" },
      singleSource: { value: 19, delta: "— no change", direction: "flat" },
      medianResolutionDays: { value: 109, delta: "▼ 12 days vs peer median", direction: "down" },
      upstreamAlerts: { value: 3, delta: "▲ 1 new today", direction: "up" },
    },
  },
  quarter: {
    ...COMMON,
    range: "quarter",
    rangeLabel: "this quarter",
    kpis: {
      activeShortages: { value: 312, delta: "▲ 18 vs last qtr", direction: "up" },
      essentialShort: { value: 38, of: 204, delta: "▲ 6 WHO EML affected", direction: "up" },
      singleSource: { value: 19, delta: "— no change", direction: "flat" },
      medianResolutionDays: { value: 112, delta: "▼ 9 days vs peer median", direction: "down" },
      upstreamAlerts: { value: 7, delta: "▲ 3 India/China sites", direction: "up" },
    },
  },
  ytd: {
    ...COMMON,
    range: "ytd",
    rangeLabel: "year to date",
    kpis: {
      activeShortages: { value: 341, delta: "▲ 47 since Jan", direction: "up" },
      essentialShort: { value: 44, of: 204, delta: "▲ 12 since Jan", direction: "up" },
      singleSource: { value: 21, delta: "▲ 2 since Jan", direction: "up" },
      medianResolutionDays: { value: 118, delta: "▲ 6 days vs last year", direction: "up" },
      upstreamAlerts: { value: 14, delta: "▲ 9 since Jan", direction: "up" },
    },
  },
  "12mo": {
    ...COMMON,
    range: "12mo",
    rangeLabel: "the past 12 months",
    kpis: {
      activeShortages: { value: 388, delta: "▲ 41 vs prior 12mo", direction: "up" },
      essentialShort: { value: 51, of: 204, delta: "▲ 10 vs prior 12mo", direction: "up" },
      singleSource: { value: 23, delta: "▲ 4 vs prior 12mo", direction: "up" },
      medianResolutionDays: { value: 124, delta: "▲ 11 days vs prior 12mo", direction: "up" },
      upstreamAlerts: { value: 22, delta: "▲ 14 vs prior 12mo", direction: "up" },
    },
  },
};

export function getSnapshot(range: RangeKey): DashboardSnapshot {
  return DASHBOARD_SNAPSHOTS[range];
}

/**
 * A plain-English fallback read built straight from the snapshot's own numbers,
 * used when the AI market-read can't be generated (no API key, model error).
 * Templated from the active range so the band never empty and never contradicts
 * the cards, whichever range is selected.
 */
export function buildFallbackSummary(s: DashboardSnapshot): string {
  const k = s.kpis;
  const worstSole = s.topEssential.filter((d) => d.suppliers === "sole supplier").length;
  const topConc = s.concentration[0];
  const upstreamCount = s.upstream.length;
  return [
    `Australia carries ${k.activeShortages.value} active shortages ${s.rangeLabel}, ${k.essentialShort.value} of them on the WHO essential-medicines list, and sits mid-pack against peer regulators — below the US and UK, above the EU average.`,
    `The sharpest risk is concentration rather than count: ${topConc.klass.toLowerCase()} lean on a single API source for ${topConc.singleSourcePct}% of volume, and ${worstSole} of the worst essential shortages now run on a sole supplier.`,
    `${upstreamCount} upstream India and China sites are flagged, pointing to further antibiotic and methotrexate pressure ahead.`,
  ].join(" ");
}

/** Render a snapshot into a compact, model-readable brief for the prompt. */
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
    `TIME WINDOW: ${s.rangeLabel}.`,
    "",
    `HEADLINE NUMBERS (${s.rangeLabel}):`,
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
