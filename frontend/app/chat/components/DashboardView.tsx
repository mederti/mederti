"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Search, ChevronDown } from "./icons";

// Static mock — realistic numbers hardcoded for design review.
// Wire to real Supabase queries (same pattern as /dashboard components) once
// the view is promoted from mock to production.

type Sev = "Critical" | "High" | "Moderate" | "Low";
type Period = "24h" | "7d" | "30d" | "90d" | "All";
type SevFilter = Sev | "All";

// Region groupings — used by the country dropdown so users can pick a whole
// continent or drill down to a single market.
const REGIONS: Array<{ id: string; label: string; countries: string[] }> = [
  { id: "world", label: "World (All Countries)", countries: [] },
  { id: "na", label: "North America", countries: ["US", "CA", "MX"] },
  { id: "eu", label: "Europe", countries: ["GB", "DE", "FR", "IT", "ES", "NL", "BE", "SE", "DK", "FI", "NO", "CH", "AT", "IE", "PL", "PT", "CZ", "HU", "GR"] },
  { id: "apac", label: "Asia-Pacific", countries: ["AU", "NZ", "JP", "KR", "SG", "HK", "MY", "IN", "CN", "TH"] },
  { id: "latam", label: "Latin America", countries: ["BR", "AR", "MX", "CL", "CO"] },
  { id: "mea", label: "Middle East & Africa", countries: ["AE", "SA", "IL", "ZA", "NG", "EG"] },
];

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

const ALERTS = [
  { drug: "Morphine (injectable)", sev: "Critical" as Sev, flag: "🇦🇺", src: "TGA", ago: "2h", reason: "Manufacturing disruption" },
  { drug: "Amoxicillin/Clavulanate", sev: "High" as Sev, flag: "🇬🇧", src: "MHRA", ago: "5h", reason: "Demand surge" },
  { drug: "Piperacillin-Tazobactam", sev: "High" as Sev, flag: "🇨🇦", src: "HC", ago: "7h", reason: "API shortage" },
  { drug: "Insulin Glargine", sev: "Critical" as Sev, flag: "🇩🇪", src: "BfArM", ago: "9h", reason: "Manufacturing issue" },
  { drug: "Cisplatin", sev: "Critical" as Sev, flag: "🇺🇸", src: "FDA", ago: "12h", reason: "Quality recall" },
  { drug: "Atorvastatin", sev: "Moderate" as Sev, flag: "🇳🇿", src: "Medsafe", ago: "19h", reason: "Import delay" },
];

export function DashboardView({ onAsk }: { onAsk: (q: string) => void }) {
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("world");
  const [period, setPeriod] = useState<Period>("All");
  const [severity, setSeverity] = useState<SevFilter>("All");
  const [regionOpen, setRegionOpen] = useState(false);
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

  const activeRegion = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0];

  const filteredRisks = useMemo(() => {
    return RISKS.filter((r) => {
      if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
      if (activeRegion.countries.length > 0) {
        const overlap = r.countries.some((c) => activeRegion.countries.includes(c));
        if (!overlap) return false;
      }
      return true;
    });
  }, [query, activeRegion]);

  const insight = useMemo(() => {
    // One-line takeaway, adapts to the active filters.
    if (severity === "Critical" && activeRegion.id === "apac") {
      return "AU dominates APAC critical risk — Morphine (inj.) manufacturing disruption is the highest-impact open signal; no domestic substitute.";
    }
    if (severity === "Critical") {
      return "Manufacturing disruption is driving 3 of the last 24h critical alerts; injectable oncology and analgesia are most exposed.";
    }
    if (activeRegion.id === "apac") {
      return "Pip/Taz API concentration in a single Indian plant is the standout APAC choke point — AU appears in 4 of 5 filtered risks.";
    }
    if (activeRegion.id === "eu") {
      return "Methotrexate's primary-EU supplier shutdown is the lead signal; post-winter demand pressure on Amoxicillin is the secondary one.";
    }
    if (activeRegion.id === "na") {
      return "Cisplatin's FDA enforcement action is the dominant NA signal — 2 sole-source manufacturers, no near-term substitute.";
    }
    if (query) {
      return `Filtering on "${query}" — ${filteredRisks.length} risk rows match; ask the AI for a deeper read.`;
    }
    return "Injectable oncology drugs dominate this week — 3 of the top 6 risks are hospital-only with no easy substitute.";
  }, [severity, activeRegion, query, filteredRisks.length]);

  const filteredAlerts = useMemo(() => {
    const flagToCountry: Record<string, string> = {
      "🇦🇺": "AU", "🇬🇧": "GB", "🇨🇦": "CA", "🇩🇪": "DE",
      "🇺🇸": "US", "🇳🇿": "NZ", "🇫🇷": "FR", "🇯🇵": "JP",
    };
    return ALERTS.filter((a) => {
      if (query && !a.drug.toLowerCase().includes(query.toLowerCase())) return false;
      if (severity !== "All" && a.sev !== severity) return false;
      if (activeRegion.countries.length > 0) {
        const country = flagToCountry[a.flag];
        if (!country || !activeRegion.countries.includes(country)) return false;
      }
      return true;
    });
  }, [query, severity, activeRegion]);

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
                <span className="text-slate-400">🌐</span>
                <span className="font-medium">{activeRegion.label}</span>
                <ChevronDown size={11} className="text-slate-400" />
              </button>
              {regionOpen ? (
                <div className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                  {REGIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setRegionId(r.id);
                        setRegionOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-slate-50 ${
                        r.id === regionId ? "text-teal-700 font-medium" : "text-slate-700"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
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

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          {STATS.map((s) => (
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
                Last 24 hours · click to ask the AI
              </p>
            </div>
            <span className="text-[12px] text-slate-400">
              {filteredAlerts.length === ALERTS.length
                ? "6 of 38 alerts"
                : `${filteredAlerts.length} of 38 (filtered)`}
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
