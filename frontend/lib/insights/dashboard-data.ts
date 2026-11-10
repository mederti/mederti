import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * National Shortage Dashboard — live data, one builder for every surface
 * (page, AI market read, PDF) so they can never disagree.
 *
 * Replaces lib/insights/dashboard-snapshot.ts, whose figures were illustrative
 * samples ported from an HTML mockup (including invented "upstream" site
 * events naming real companies).
 *
 * Every figure here is computed from Supabase, excluding synthetic rows
 * (shortage_events.synthetic — e.g. FDA MedWatch recalls stored as events):
 *   • shortage_events             — counts, new onsets, resolution times, days short
 *   • inn_risk_scores (mig. 074)  — the essential/critical universe (WHO Model
 *     List ∪ EU Union list), supply concentration, countries short now
 *
 * What it deliberately does NOT show: a "risk" or "forecast" verdict. The
 * Phase 2 backtest (docs/risk-score-backtest.md) found the combined risk band
 * predicts neither onset nor duration, so the page shows the underlying facts
 * — concentration, essential status, spread — labelled as what they are.
 */

import {
  type BoardPoint,
  type ConcentrationTier,
  type DashboardData,
  type EssentialRow,
  COUNTRY_NAMES,
  PEER_GROUPS,
  tierFor,
} from "./dashboard-data-shared";

export type { BoardPoint, ConcentrationTier, DashboardData, EssentialRow };

const TIER_RANK: Record<ConcentrationTier, number> = {
  highly_concentrated: 3, concentrated: 2, broad: 1, unknown: 0,
};

const DAY = 86400000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

interface ScoreRow {
  inn: string;
  display_name: string;
  fragility: number | null;
  who_eml_list: "core" | "complementary" | null;
  eu_critical: boolean;
  n_api_makers: number | null;
  n_finished_firms: number | null;
  top_api_country: string | null;
  short_countries: string[];
  drug_ids: string[];
  geography: { countries?: Record<string, number> } | null;
  computed_at: string;
}

export async function buildDashboard(countryRaw: string): Promise<DashboardData> {
  const country = countryRaw.toUpperCase().slice(0, 2);
  const sb = getSupabaseAdmin();
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const since365 = new Date(now - 365 * DAY).toISOString().slice(0, 10);

  const [scoresRes, activeRes, newRes, latestRes] = await Promise.all([
    sb.from("inn_risk_scores")
      .select("inn,display_name,fragility,who_eml_list,eu_critical,n_api_makers,n_finished_firms,top_api_country,short_countries,drug_ids,geography:components->geography,computed_at")
      .limit(2000),
    sb.from("shortage_events").select("id", { count: "exact", head: true })
      .eq("country_code", country).eq("status", "active").or("synthetic.is.null,synthetic.eq.false"),
    sb.from("shortage_events").select("id", { count: "exact", head: true })
      .eq("country_code", country).neq("status", "anticipated").gte("start_date", since30).or("synthetic.is.null,synthetic.eq.false"),
    sb.from("shortage_events").select("updated_at")
      .eq("country_code", country).order("updated_at", { ascending: false }).limit(1),
  ]);
  if (scoresRes.error) throw scoresRes.error;
  const scores = (scoresRes.data ?? []) as unknown as ScoreRow[];

  // Resolved in the last 12 months → median days from start to end.
  const durations: number[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("shortage_events").select("start_date,end_date")
      .eq("country_code", country).eq("status", "resolved").gte("end_date", since365).or("synthetic.is.null,synthetic.eq.false")
      .not("start_date", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      // Same-day start/end is a scraper artefact (no real shortage resolves
      // the day it starts), so only positive durations count.
      const d = (Date.parse(r.end_date as string) - Date.parse(r.start_date as string)) / DAY;
      if (d >= 1) durations.push(Math.round(d));
    }
    if (!data || data.length < 1000) break;
  }

  // Essential molecules short here: days since the earliest active report.
  const shortHere = scores.filter((s) => s.short_countries.includes(country));
  const drugToInn = new Map<string, string>();
  for (const s of shortHere) for (const id of s.drug_ids) drugToInn.set(id, s.inn);
  const earliest = new Map<string, number>();
  const ids = [...drugToInn.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from("shortage_events").select("drug_id,start_date")
      .eq("country_code", country).eq("status", "active").in("drug_id", ids.slice(i, i + 150)).or("synthetic.is.null,synthetic.eq.false");
    if (error) throw error;
    for (const r of data ?? []) {
      if (!r.start_date) continue;
      const inn = drugToInn.get(r.drug_id as string)!;
      const t = Date.parse(r.start_date as string);
      if (!earliest.has(inn) || t < earliest.get(inn)!) earliest.set(inn, t);
    }
  }

  const topShare = (s: ScoreRow): number | null => {
    const c = s.geography?.countries;
    if (!c || !s.top_api_country) return null;
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    return total ? (c[s.top_api_country] ?? 0) / total : null;
  };

  const essential: EssentialRow[] = shortHere
    .map((s) => ({
      inn: s.inn,
      name: s.display_name,
      whoList: s.who_eml_list,
      euCritical: s.eu_critical,
      daysShort: earliest.has(s.inn) ? Math.max(0, Math.round((now - earliest.get(s.inn)!) / DAY)) : null,
      tier: tierFor(s.fragility),
      nApiMakers: s.n_api_makers,
      nFinishedFirms: s.n_finished_firms,
      topApiCountry: s.top_api_country,
      topApiShare: topShare(s),
      countriesShort: s.short_countries.length,
    }))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || (b.daysShort ?? -1) - (a.daysShort ?? -1));

  const peerSet = PEER_GROUPS[country] ?? [];
  const earlyWarning = scores
    .filter((s) => !s.short_countries.includes(country))
    .map((s) => ({ s, peers: s.short_countries.filter((c) => peerSet.includes(c)) }))
    .filter((x) => x.peers.length >= 2)
    .sort((a, b) => b.peers.length - a.peers.length || TIER_RANK[tierFor(b.s.fragility)] - TIER_RANK[tierFor(a.s.fragility)])
    .map(({ s, peers }) => ({ inn: s.inn, name: s.display_name, peers, tier: tierFor(s.fragility) }));

  const board: BoardPoint[] = scores
    .filter((s) => s.fragility != null)
    .map((s) => ({
      inn: s.inn,
      name: s.display_name,
      concentration: Number(s.fragility),
      countriesShort: s.short_countries.length,
      shortHere: s.short_countries.includes(country),
      tier: tierFor(s.fragility),
      nApiMakers: s.n_api_makers,
    }));

  const shortByCountry = new Map<string, number>();
  for (const s of scores) for (const c of s.short_countries) shortByCountry.set(c, (shortByCountry.get(c) ?? 0) + 1);
  const peers = [country, ...peerSet]
    .map((c) => ({ country: c, essentialShort: shortByCountry.get(c) ?? 0, self: c === country }))
    .sort((a, b) => b.essentialShort - a.essentialShort);

  const apiCountryCounts = new Map<string, number>();
  for (const s of scores) {
    if (s.fragility != null && s.top_api_country) {
      apiCountryCounts.set(s.top_api_country, (apiCountryCounts.get(s.top_api_country) ?? 0) + 1);
    }
  }
  const apiCountries = [...apiCountryCounts.entries()]
    .map(([c, n]) => ({ country: c, molecules: n }))
    .sort((a, b) => b.molecules - a.molecules)
    .slice(0, 8);

  return {
    country,
    generatedAt: new Date(now).toISOString(),
    latestReportAt: (latestRes.data?.[0]?.updated_at as string | undefined) ?? null,
    universeSize: scores.length,
    kpis: {
      activeReports: activeRes.count ?? 0,
      newLast30: newRes.count ?? 0,
      essentialShort: essential.length,
      essentialShortConcentrated: essential.filter((e) => e.tier === "highly_concentrated" || e.tier === "concentrated").length,
      medianResolutionDays: median(durations),
      resolvedLast12mo: durations.length,
      earlyWarning: earlyWarning.length,
    },
    essential,
    earlyWarning,
    board,
    peers,
    apiCountries,
    scoresComputedAt: scores[0]?.computed_at ?? null,
  };
}

/** Plain-text brief of the figures, for the AI market read. Lists are marked
 *  as examples with their true totals, so the model can't read "top 5" as a count. */
export function dashboardToBrief(d: DashboardData): string {
  const name = COUNTRY_NAMES[d.country] ?? d.country;
  const k = d.kpis;
  const dated = d.essential.filter((e) => e.daysShort != null);
  const overYear = dated.filter((e) => (e.daysShort ?? 0) > 365).length;
  const overFive = dated.filter((e) => (e.daysShort ?? 0) > 5 * 365).length;
  const overTen = dated.filter((e) => (e.daysShort ?? 0) > 10 * 365).length;
  const byPeerDepth = new Map<number, number>();
  for (const e of d.earlyWarning) byPeerDepth.set(e.peers.length, (byPeerDepth.get(e.peers.length) ?? 0) + 1);
  const longest = [...dated].sort((a, b) => (b.daysShort ?? 0) - (a.daysShort ?? 0)).slice(0, 5);
  const lines = [
    `Market: ${name}`,
    `Active shortage reports: ${k.activeReports}; ${k.newLast30} started in the last 30 days.`,
    `Essential/critical medicines (WHO Model List or EU Union list, ${d.universeSize} molecules) short here now: ${k.essentialShort}, of which ${k.essentialShortConcentrated} have concentrated API supply.`,
    `Of those ${k.essentialShort}, ${overYear} were first reported more than 1 year ago, ${overFive} more than 5 years ago, ${overTen} more than 10 years ago. Examples (the 5 longest, not a count): ${longest.map((e) => `${e.name} (${e.daysShort} days)`).join(", ") || "none"}.`,
    `Median duration of shortages resolved here in the last 12 months: ${k.medianResolutionDays ?? "n/a"} days (${k.resolvedLast12mo} resolved). No figure for how many were resolved in the last 30 days is available.`,
    `Essential medicines short in 2+ peer markets but not reported short here: ${k.earlyWarning} in total (this market's regulator may simply publish less); by number of peer markets short: ${[...byPeerDepth.entries()].sort((a, b) => b[0] - a[0]).map(([n, c]) => `${c} in ${n} peers`).join(", ")}. Examples (top 5 by number of peers, not a count): ${d.earlyWarning.slice(0, 5).map((e) => `${e.name} (${e.peers.join("/")})`).join(", ") || "none"}.`,
    `Essential medicines short, by market: ${d.peers.map((p) => `${p.country} ${p.essentialShort}`).join(", ")}. These counts also reflect how much each regulator publishes.`,
  ];
  return lines.join("\n");
}

/** Deterministic read used when the model is unavailable — states, never infers. */
export function buildFallbackRead(d: DashboardData): string {
  const name = COUNTRY_NAMES[d.country] ?? d.country;
  const k = d.kpis;
  return `${name} has ${k.activeReports} active shortage reports, ${k.newLast30} of them new in the last 30 days. ` +
    `${k.essentialShort} essential or critical medicines are short here now, ${k.essentialShortConcentrated} with concentrated API supply, ` +
    `and ${k.earlyWarning} more are short in two or more peer markets but not reported short here.`;
}
