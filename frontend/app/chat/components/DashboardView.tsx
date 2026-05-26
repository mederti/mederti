"use client";

// Static mock — realistic numbers hardcoded for design review.
// Wire to real Supabase queries (same pattern as /dashboard components) once
// the view is promoted from mock to production.

type Sev = "Critical" | "High" | "Moderate" | "Low";

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

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-3 mb-8">
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

        {/* Supply Risk Index */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">Supply Risk Index</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Composite risk score · click any row to ask the AI
              </p>
            </div>
            <span className="text-[12px] text-slate-400">Top 6 of 847 at-risk medicines</span>
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
                {RISKS.map((r) => {
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
            <span className="text-[12px] text-slate-400">6 of 38 alerts</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-100">
            {ALERTS.map((a, i) => (
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
