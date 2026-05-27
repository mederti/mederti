"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Search, ChevronDown } from "./icons";

// Static mock — realistic numbers hardcoded for design review.
// Wire to real Supabase queries (same pattern as /dashboard components) once
// the view is promoted from mock to production.

type Sev = "Critical" | "High" | "Moderate" | "Low";
type Period = "24h" | "7d" | "30d" | "90d" | "All";
type SevFilter = Sev | "All";

// Region tree — used by the country dropdown. Each region exposes its full
// country list so the user can pick the whole continent, or expand to drill
// down to a single market.
type Country = { code: string; name: string };
type Region = { id: string; label: string; countries: Country[] };

const REGIONS: Region[] = [
  {
    id: "apac",
    label: "Asia-Pacific",
    countries: [
      { code: "AU", name: "Australia" },
      { code: "NZ", name: "New Zealand" },
      { code: "JP", name: "Japan" },
      { code: "KR", name: "South Korea" },
      { code: "SG", name: "Singapore" },
      { code: "HK", name: "Hong Kong" },
      { code: "MY", name: "Malaysia" },
      { code: "IN", name: "India" },
      { code: "CN", name: "China" },
      { code: "TH", name: "Thailand" },
    ],
  },
  {
    id: "na",
    label: "North America",
    countries: [
      { code: "US", name: "United States" },
      { code: "CA", name: "Canada" },
      { code: "MX", name: "Mexico" },
    ],
  },
  {
    id: "eu",
    label: "Europe",
    countries: [
      { code: "GB", name: "United Kingdom" },
      { code: "DE", name: "Germany" },
      { code: "FR", name: "France" },
      { code: "IT", name: "Italy" },
      { code: "ES", name: "Spain" },
      { code: "NL", name: "Netherlands" },
      { code: "BE", name: "Belgium" },
      { code: "SE", name: "Sweden" },
      { code: "DK", name: "Denmark" },
      { code: "FI", name: "Finland" },
      { code: "NO", name: "Norway" },
      { code: "CH", name: "Switzerland" },
      { code: "AT", name: "Austria" },
      { code: "IE", name: "Ireland" },
      { code: "PL", name: "Poland" },
      { code: "PT", name: "Portugal" },
      { code: "CZ", name: "Czech Republic" },
      { code: "HU", name: "Hungary" },
      { code: "GR", name: "Greece" },
    ],
  },
  {
    id: "latam",
    label: "Latin America",
    countries: [
      { code: "BR", name: "Brazil" },
      { code: "AR", name: "Argentina" },
      { code: "MX", name: "Mexico" },
      { code: "CL", name: "Chile" },
      { code: "CO", name: "Colombia" },
    ],
  },
  {
    id: "mea",
    label: "Middle East & Africa",
    countries: [
      { code: "AE", name: "United Arab Emirates" },
      { code: "SA", name: "Saudi Arabia" },
      { code: "IL", name: "Israel" },
      { code: "ZA", name: "South Africa" },
      { code: "NG", name: "Nigeria" },
      { code: "EG", name: "Egypt" },
    ],
  },
];

// User's home country — pinned at the top of the dropdown. The header already
// shows AU; if/when we honour user_profiles.country_code, replace this.
const HOME_COUNTRY: Country = { code: "AU", name: "Australia" };

// ISO-3166 alpha-2 → flag emoji via the regional-indicator codepoints.
function flagOf(code: string): string {
  if (code.length !== 2) return "🌐";
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(A + code.charCodeAt(0) - a, A + code.charCodeAt(1) - a);
}

// Selection model: world | region | country. A flat tagged union keeps the
// filter pipeline simple — derive `countries` once and consume it everywhere.
type Selection =
  | { kind: "world" }
  | { kind: "region"; regionId: string }
  | { kind: "country"; code: string };

const PERIODS: Period[] = ["24h", "7d", "30d", "90d", "All"];
const SEV_FILTERS: SevFilter[] = ["All", "Critical", "High", "Moderate", "Low"];

const SEV_DOT: Record<Sev, string> = {
  Critical: "bg-red-500",
  High: "bg-orange-400",
  Moderate: "bg-yellow-400",
  Low: "bg-green-400",
};

const SEV_BADGE: Record<Sev, string> = {
  Critical: "text-red-700 bg-red-50 border-red-200",
  High: "text-orange-700 bg-orange-50 border-orange-200",
  Moderate: "text-yellow-700 bg-yellow-50 border-yellow-200",
  Low: "text-green-700 bg-green-50 border-green-200",
};

const STATS = [
  { label: "Active Shortages", value: "2,847", sub: "global markets tracked", delta: "+38 this week", up: true },
  { label: "Critical", value: "143", sub: "severe supply risk", delta: "+12 vs last week", up: true },
  { label: "New (7 days)", value: "38", sub: "newly reported", delta: "−5 vs prior week", up: false },
  { label: "Resolved (7d)", value: "24", sub: "closed shortages", delta: null, up: null as boolean | null },
];

const RISKS = [
  { rank: 1, name: "Cisplatin", score: 91, signal: "FDA enforcement action; 2 sole-source manufacturers", countries: ["US", "AU", "GB", "CA", "DE"] },
  { rank: 2, name: "Pip/Taz", score: 84, signal: "API sourcing concentrated in single Indian plant", countries: ["AU", "GB", "NZ", "CA"] },
  { rank: 3, name: "Insulin Aspart", score: 79, signal: "Cold-chain freight disruption + Q2 demand surge", countries: ["AU", "US", "DE", "FR", "JP"] },
  { rank: 4, name: "Morphine (inj.)", score: 74, signal: "Opium poppy harvest 18% below forecast", countries: ["AU", "GB", "IE"] },
  { rank: 5, name: "Amoxicillin", score: 68, signal: "Post-winter demand surge; EU stock drawdown", countries: ["GB", "DE", "FR", "AU", "CA"] },
  { rank: 6, name: "Methotrexate", score: 61, signal: "Manufacturing shutdown at primary EU supplier", countries: ["DE", "FR", "PL"] },
];

// agoHours is the canonical age; `ago` is the display string. Adding entries
// across each period bucket so the toggle actually shows movement.
const ALERTS: Array<{
  drug: string;
  sev: Sev;
  flag: string;
  src: string;
  ago: string;
  agoHours: number;
  reason: string;
}> = [
  // Within 24h
  { drug: "Morphine (injectable)", sev: "Critical", flag: "🇦🇺", src: "TGA", ago: "2h", agoHours: 2, reason: "Manufacturing disruption" },
  { drug: "Amoxicillin/Clavulanate", sev: "High", flag: "🇬🇧", src: "MHRA", ago: "5h", agoHours: 5, reason: "Demand surge" },
  { drug: "Piperacillin-Tazobactam", sev: "High", flag: "🇨🇦", src: "HC", ago: "7h", agoHours: 7, reason: "API shortage" },
  { drug: "Insulin Glargine", sev: "Critical", flag: "🇩🇪", src: "BfArM", ago: "9h", agoHours: 9, reason: "Manufacturing issue" },
  { drug: "Cisplatin", sev: "Critical", flag: "🇺🇸", src: "FDA", ago: "12h", agoHours: 12, reason: "Quality recall" },
  { drug: "Atorvastatin", sev: "Moderate", flag: "🇳🇿", src: "Medsafe", ago: "19h", agoHours: 19, reason: "Import delay" },
  // 24h–7d
  { drug: "Methotrexate", sev: "Critical", flag: "🇩🇪", src: "BfArM", ago: "1d", agoHours: 30, reason: "Primary EU supplier shutdown" },
  { drug: "Salbutamol inhaler", sev: "Moderate", flag: "🇦🇺", src: "TGA", ago: "2d", agoHours: 52, reason: "Container delay" },
  { drug: "Levothyroxine", sev: "High", flag: "🇫🇷", src: "ANSM", ago: "3d", agoHours: 78, reason: "Bioequivalence batch fail" },
  { drug: "Furosemide (inj.)", sev: "Moderate", flag: "🇬🇧", src: "MHRA", ago: "5d", agoHours: 122, reason: "Manufacturing variance" },
  // 7d–30d
  { drug: "Diltiazem ER", sev: "Moderate", flag: "🇺🇸", src: "FDA", ago: "12d", agoHours: 290, reason: "Voluntary recall — labelling" },
  { drug: "Hydrochlorothiazide", sev: "Low", flag: "🇮🇪", src: "HPRA", ago: "18d", agoHours: 432, reason: "Reformulation delay" },
  { drug: "Insulin Aspart", sev: "Critical", flag: "🇩🇪", src: "BfArM", ago: "22d", agoHours: 528, reason: "Cold-chain freight disruption" },
  // 30d–90d
  { drug: "Pip/Taz", sev: "Critical", flag: "🇦🇺", src: "TGA", ago: "38d", agoHours: 912, reason: "API plant audit findings" },
  { drug: "Vancomycin", sev: "High", flag: "🇯🇵", src: "PMDA", ago: "55d", agoHours: 1320, reason: "API contamination" },
  { drug: "Tamoxifen", sev: "Moderate", flag: "🇳🇱", src: "CBG-MEB", ago: "72d", agoHours: 1728, reason: "Demand spike + supplier exit" },
  // >90d (in "All" only)
  { drug: "Carboplatin", sev: "High", flag: "🇺🇸", src: "FDA", ago: "118d", agoHours: 2832, reason: "Quality remediation programme" },
  { drug: "Adalimumab (orig.)", sev: "Low", flag: "🇨🇭", src: "Swissmedic", ago: "164d", agoHours: 3936, reason: "Biosimilar transition" },
];

// Period → cutoff in hours. "All" means no cap.
const PERIOD_HOURS: Record<Period, number | null> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
  All: null,
};

// Period-specific window for the time-bucketed KPI cards.
const NEW_BY_PERIOD: Record<Period, { value: string; delta: string; up: boolean }> = {
  "24h": { value: "6", delta: "+2 vs prior 24h", up: true },
  "7d": { value: "38", delta: "−5 vs prior week", up: false },
  "30d": { value: "142", delta: "+18 vs prior 30d", up: true },
  "90d": { value: "487", delta: "+62 vs prior 90d", up: true },
  All: { value: "2,847", delta: "lifetime new reports", up: true },
};
const RESOLVED_BY_PERIOD: Record<Period, { value: string; sub: string }> = {
  "24h": { value: "4", sub: "closed shortages" },
  "7d": { value: "24", sub: "closed shortages" },
  "30d": { value: "89", sub: "closed shortages" },
  "90d": { value: "312", sub: "closed shortages" },
  All: { value: "2,104", sub: "lifetime resolutions" },
};
const NEW_LABEL: Record<Period, string> = {
  "24h": "New (24h)",
  "7d": "New (7 days)",
  "30d": "New (30d)",
  "90d": "New (90d)",
  All: "New (all-time)",
};
const RESOLVED_LABEL: Record<Period, string> = {
  "24h": "Resolved (24h)",
  "7d": "Resolved (7d)",
  "30d": "Resolved (30d)",
  "90d": "Resolved (90d)",
  All: "Resolved (all-time)",
};
const ALERTS_WINDOW_LABEL: Record<Period, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  All: "All open alerts",
};

export function DashboardView({ onAsk }: { onAsk: (q: string) => void }) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({ kind: "world" });
  const [period, setPeriod] = useState<Period>("7d");
  const [severity, setSeverity] = useState<SevFilter>("All");
  const [regionOpen, setRegionOpen] = useState(false);
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({ apac: true });
  const regionRef = useRef<HTMLDivElement>(null);

  // Close the region dropdown on outside click.
  useEffect(() => {
    if (!regionOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (regionRef.current && !regionRef.current.contains(e.target as Node)) {
        setRegionOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [regionOpen]);

  // Derive the active filter (label for the trigger button + the country set
  // used by the row/alert filters below).
  const active = useMemo(() => {
    if (selection.kind === "world") {
      return { label: "World (All Countries)", emoji: "🌐", countries: [] as string[], id: "world" };
    }
    if (selection.kind === "region") {
      const r = REGIONS.find((x) => x.id === selection.regionId);
      if (!r) return { label: "World (All Countries)", emoji: "🌐", countries: [], id: "world" };
      return { label: r.label, emoji: "🌐", countries: r.countries.map((c) => c.code), id: r.id };
    }
    // single country
    const allCountries = REGIONS.flatMap((r) => r.countries);
    const c = allCountries.find((x) => x.code === selection.code);
    return {
      label: c?.name ?? selection.code,
      emoji: flagOf(selection.code),
      countries: [selection.code],
      id: `country:${selection.code}`,
    };
  }, [selection]);

  const filteredRisks = useMemo(() => {
    return RISKS.filter((r) => {
      if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
      if (active.countries.length > 0) {
        const overlap = r.countries.some((c) => active.countries.includes(c));
        if (!overlap) return false;
      }
      return true;
    });
  }, [query, active.id, active.countries]);

  const insight = useMemo(() => {
    // One-line takeaway, adapts to the active filters.
    const isCountry = selection.kind === "country";
    const cc = isCountry ? selection.code : null;

    if (cc === "AU") {
      return severity === "Critical"
        ? "AU critical signals are dominated by Morphine (inj.) — TGA-confirmed manufacturing disruption, no like-for-like substitute on-market."
        : "AU exposure is broad — injectable oncology (Cisplatin, Pip/Taz) and Morphine are the standout TGA shortages this week.";
    }
    if (cc === "US") {
      return "US is anchored by Cisplatin's FDA enforcement action — 2 sole-source manufacturers; oncology contingency plans now active.";
    }
    if (cc === "GB") {
      return "UK lead signal is Amoxicillin/Clavulanate demand surge (MHRA) on top of post-winter EU stock drawdown.";
    }
    if (cc === "DE") {
      return "Germany sees the Methotrexate primary-supplier shutdown plus Insulin Glargine BfArM-flagged manufacturing issues — both EU-wide knock-on risk.";
    }
    if (cc) {
      return `Filtering to ${active.label} — ${filteredRisks.length} risk row(s) match. Click below to ask the AI for a country-level read.`;
    }
    if (severity === "Critical" && active.id === "apac") {
      return "AU dominates APAC critical risk — Morphine (inj.) manufacturing disruption is the highest-impact open signal; no domestic substitute.";
    }
    if (severity === "Critical") {
      return "Manufacturing disruption is driving 3 of the last 24h critical alerts; injectable oncology and analgesia are most exposed.";
    }
    if (active.id === "apac") {
      return "Pip/Taz API concentration in a single Indian plant is the standout APAC choke point — AU appears in 4 of 5 filtered risks.";
    }
    if (active.id === "eu") {
      return "Methotrexate's primary-EU supplier shutdown is the lead signal; post-winter demand pressure on Amoxicillin is the secondary one.";
    }
    if (active.id === "na") {
      return "Cisplatin's FDA enforcement action is the dominant NA signal — 2 sole-source manufacturers, no near-term substitute.";
    }
    if (query) {
      return `Filtering on "${query}" — ${filteredRisks.length} risk rows match; ask the AI for a deeper read.`;
    }
    if (period === "24h") {
      return "Last 24h: 6 new alerts; Morphine (inj.) AU is the freshest critical — 2h ago, TGA manufacturing disruption.";
    }
    if (period === "30d") {
      return "Past 30d adds Diltiazem ER recall and a BfArM Insulin Aspart cold-chain freight event — supply-side and demand-side risk both up.";
    }
    if (period === "90d") {
      return "90-day view exposes the Pip/Taz API-plant audit and Vancomycin contamination — both still open, both supply-side.";
    }
    if (period === "All") {
      return "All-time view: 2,847 cumulative shortages; long-tail signals (Carboplatin quality, Adalimumab biosimilar transition) still relevant for procurement planning.";
    }
    return "Injectable oncology drugs dominate this week — 3 of the top 6 risks are hospital-only with no easy substitute.";
  }, [severity, selection, active.id, active.label, query, filteredRisks.length, period]);

  const filteredAlerts = useMemo(() => {
    const flagToCountry: Record<string, string> = {
      "🇦🇺": "AU", "🇬🇧": "GB", "🇨🇦": "CA", "🇩🇪": "DE",
      "🇺🇸": "US", "🇳🇿": "NZ", "🇫🇷": "FR", "🇯🇵": "JP",
      "🇮🇪": "IE", "🇨🇭": "CH", "🇳🇱": "NL",
    };
    const cutoff = PERIOD_HOURS[period];
    return ALERTS.filter((a) => {
      if (query && !a.drug.toLowerCase().includes(query.toLowerCase())) return false;
      if (severity !== "All" && a.sev !== severity) return false;
      if (cutoff !== null && a.agoHours > cutoff) return false;
      if (active.countries.length > 0) {
        const country = flagToCountry[a.flag];
        if (!country || !active.countries.includes(country)) return false;
      }
      return true;
    });
  }, [query, severity, period, active.id, active.countries]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[900px] mx-auto px-8 pt-6 pb-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Global Supply Dashboard
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Real-time shortage intelligence · global markets · regulatory sources worldwide
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live · Updated just now
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5 mb-3 flex items-center gap-3 flex-wrap">
          {/* Medicine search */}
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
              <Search size={14} />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by drug name or active ingredient…"
              className="flex-1 text-[13px] text-slate-800 placeholder:text-slate-400 bg-transparent outline-none"
            />
          </div>

          {/* Region / country */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Filter by
            </span>
            <div className="relative" ref={regionRef}>
              <button
                type="button"
                onClick={() => setRegionOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <span className={selection.kind === "country" ? "" : "text-slate-400"}>
                  {active.emoji}
                </span>
                <span className="font-medium">{active.label}</span>
                <ChevronDown size={11} className="text-slate-400" />
              </button>
              {regionOpen ? (
                <div className="absolute right-0 mt-1.5 w-72 max-h-[420px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                  {/* World */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelection({ kind: "world" });
                      setRegionOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-slate-50 ${
                      selection.kind === "world" ? "text-teal-700 font-medium" : "text-slate-700"
                    }`}
                  >
                    <span className="text-slate-400">🌐</span>
                    World (All Countries)
                  </button>

                  {/* Your country — pinned shortcut */}
                  <div className="px-3 pt-2 pb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                    Your country
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelection({ kind: "country", code: HOME_COUNTRY.code });
                      setRegionOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-slate-50 ${
                      selection.kind === "country" && selection.code === HOME_COUNTRY.code
                        ? "text-teal-700 font-medium"
                        : "text-slate-700"
                    }`}
                  >
                    <span>{flagOf(HOME_COUNTRY.code)}</span>
                    {HOME_COUNTRY.name}
                  </button>

                  {/* Continents, each expandable to its country list */}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    {REGIONS.map((r) => {
                      const expanded = !!expandedRegions[r.id];
                      const regionActive =
                        selection.kind === "region" && selection.regionId === r.id;
                      return (
                        <div key={r.id}>
                          <div className="flex items-center">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRegions((m) => ({ ...m, [r.id]: !m[r.id] }))
                              }
                              className="px-2 py-1.5 text-slate-400 hover:text-slate-600"
                              aria-label={expanded ? "Collapse" : "Expand"}
                            >
                              <ChevronDown
                                size={11}
                                className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelection({ kind: "region", regionId: r.id });
                                setRegionOpen(false);
                              }}
                              className={`flex-1 text-left py-1.5 pr-3 text-[13px] hover:bg-slate-50 ${
                                regionActive ? "text-teal-700 font-medium" : "text-slate-700"
                              }`}
                            >
                              {r.label}
                              <span className="text-slate-400 text-[11px] ml-1.5">
                                · {r.countries.length}
                              </span>
                            </button>
                          </div>
                          {expanded ? (
                            <div className="pb-1">
                              {r.countries.map((c) => {
                                const countryActive =
                                  selection.kind === "country" && selection.code === c.code;
                                return (
                                  <button
                                    key={c.code}
                                    type="button"
                                    onClick={() => {
                                      setSelection({ kind: "country", code: c.code });
                                      setRegionOpen(false);
                                    }}
                                    className={`w-full text-left pl-9 pr-3 py-1 text-[12.5px] flex items-center gap-2 hover:bg-slate-50 ${
                                      countryActive
                                        ? "text-teal-700 font-medium"
                                        : "text-slate-600"
                                    }`}
                                  >
                                    <span className="text-[12px]">{flagOf(c.code)}</span>
                                    {c.name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Period toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Period
            </span>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors ${
                    period === p
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Secondary filter row — severity */}
        <div className="flex items-center gap-2 mb-6 text-[12px]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Severity
          </span>
          {SEV_FILTERS.map((s) => {
            const active = severity === s;
            const dotColor =
              s === "Critical" ? "bg-red-500" :
              s === "High" ? "bg-orange-400" :
              s === "Moderate" ? "bg-yellow-400" :
              s === "Low" ? "bg-green-400" : "";
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {s !== "All" ? (
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                ) : null}
                {s}
              </button>
            );
          })}
        </div>

        {/* KPI cards — NEW and RESOLVED swap their copy as the Period toggle changes */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[
            STATS[0],
            STATS[1],
            {
              label: NEW_LABEL[period],
              value: NEW_BY_PERIOD[period].value,
              sub: "newly reported",
              delta: NEW_BY_PERIOD[period].delta,
              up: NEW_BY_PERIOD[period].up,
            },
            {
              label: RESOLVED_LABEL[period],
              value: RESOLVED_BY_PERIOD[period].value,
              sub: RESOLVED_BY_PERIOD[period].sub,
              delta: null,
              up: null as boolean | null,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                {s.label}
              </div>
              <div className="text-[30px] font-bold text-slate-900 leading-none mb-1">
                {s.value}
              </div>
              <div className="text-[11px] text-slate-500">{s.sub}</div>
              {s.delta ? (
                <div
                  className={`text-[11px] mt-1.5 font-medium ${
                    s.up ? "text-red-500" : "text-teal-600"
                  }`}
                >
                  {s.delta}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* AI insight strip — one-line takeaway, adapts to filters */}
        <button
          type="button"
          onClick={() => onAsk(insight)}
          className="w-full text-left bg-gradient-to-r from-teal-50 via-teal-50/60 to-white border border-teal-100 rounded-xl px-3.5 py-2.5 mb-8 flex items-center gap-2.5 hover:from-teal-100/70 hover:via-teal-50 transition-colors group"
        >
          <span className="shrink-0 w-6 h-6 rounded-md bg-teal-500/10 flex items-center justify-center text-teal-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
              <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
            </svg>
          </span>
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-teal-700 shrink-0">
            AI insight
          </span>
          <span className="text-[12.5px] text-slate-700 flex-1 leading-snug">
            {insight}
          </span>
          <span className="text-[11px] text-teal-600 font-medium shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            Ask →
          </span>
        </button>

        {/* Supply Risk Index */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">Supply Risk Index</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Composite risk score · click any row to ask the AI
              </p>
            </div>
            <span className="text-[12px] text-slate-400">
              {filteredRisks.length === RISKS.length
                ? "Top 6 of 847 at-risk medicines"
                : `${filteredRisks.length} of 847 (filtered)`}
            </span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider w-8">
                    #
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">
                    Medicine
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider w-36">
                    Risk score
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">
                    Primary signal
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">
                    Countries
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRisks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      No medicines match the current filters.
                    </td>
                  </tr>
                ) : null}
                {filteredRisks.map((r) => {
                  const barColor =
                    r.score >= 80 ? "bg-red-500" : r.score >= 60 ? "bg-orange-400" : "bg-yellow-400";
                  const numColor =
                    r.score >= 80
                      ? "text-red-600"
                      : r.score >= 60
                      ? "text-orange-500"
                      : "text-yellow-600";
                  return (
                    <tr
                      key={r.name}
                      onClick={() => onAsk(`What's driving the supply risk for ${r.name}?`)}
                      className="hover:bg-teal-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-[12px] text-slate-400">{r.rank}</td>
                      <td className="px-4 py-3 text-[13px] font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-slate-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${barColor}`}
                              style={{ width: `${r.score}%` }}
                            />
                          </div>
                          <span
                            className={`text-[12px] font-mono font-semibold tabular-nums ${numColor}`}
                          >
                            {r.score}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 max-w-[240px]">
                        {r.signal}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 flex-wrap items-center">
                          {r.countries.slice(0, 4).map((c) => (
                            <span
                              key={c}
                              className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono"
                            >
                              {c}
                            </span>
                          ))}
                          {r.countries.length > 4 ? (
                            <span className="text-[10px] text-slate-400 ml-0.5">
                              +{r.countries.length - 4}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Alerts */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">Recent Alerts</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">
                {ALERTS_WINDOW_LABEL[period]} · click to ask the AI
              </p>
            </div>
            <span className="text-[12px] text-slate-400">
              {filteredAlerts.length === ALERTS.length
                ? `${filteredAlerts.length} alerts in window`
                : `${filteredAlerts.length} of ${ALERTS.length} (filtered)`}
            </span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-100">
            {filteredAlerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-slate-400">
                No alerts match the current filters.
              </div>
            ) : null}
            {filteredAlerts.map((a, i) => (
              <div
                key={i}
                onClick={() => onAsk(`Tell me about the ${a.drug} shortage`)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-teal-50/50 cursor-pointer transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[a.sev]}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-slate-900">{a.drug}</span>
                  <span className="text-[12px] text-slate-400 ml-2">— {a.reason}</span>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${SEV_BADGE[a.sev]}`}
                >
                  {a.sev}
                </span>
                <span className="text-[13px]">{a.flag}</span>
                <span className="text-[11px] text-slate-400 font-mono w-12 text-center">
                  {a.src}
                </span>
                <span className="text-[11px] text-slate-400 w-8 text-right">{a.ago}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
