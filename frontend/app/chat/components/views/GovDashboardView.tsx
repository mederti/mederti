"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type DashboardData,
  type BoardPoint,
  COUNTRY_NAMES,
  TIER_LABEL,
} from "@/lib/insights/dashboard-data-shared";
import { generateDashboardPdf } from "@/lib/insights/dashboard-pdf";
import { ShortageTrendChart } from "./ShortageTrendChart";
import { WatchlistRiskBoard } from "./WatchlistRiskBoard";

// National Shortage Dashboard. Every figure is live (see
// lib/insights/dashboard-data.ts). It previously rendered illustrative sample
// figures from an HTML mockup, including invented "upstream" site events.

const ESSENTIAL_PREVIEW = 8;

const relTime = (iso: string | null): string => {
  if (!iso) return "unknown";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
};

const drugHref = (name: string) => `/search?q=${encodeURIComponent(name)}`;

function ConcentrationBoard({ points, country }: { points: BoardPoint[]; country: string }) {
  const W = 640, H = 260, L = 40, R = 12, T = 12, B = 34;
  const maxY = Math.max(5, ...points.map((p) => p.countriesShort));
  const x = (v: number) => L + v * (W - L - R);
  const y = (v: number) => H - B - (v / maxY) * (H - T - B);
  const yTicks = [0, Math.round(maxY / 2), maxY];
  return (
    <>
      <svg className="board-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Essential medicines plotted by API supply concentration against number of countries short now; red dots are short in ${country}`}>
        <rect x={x(0.6)} y={T} width={x(1) - x(0.6)} height={H - T - B} fill="var(--crit-bg)" />
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--bg-3)" />
            <text x={L - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill="var(--text-4)">{t}</text>
          </g>
        ))}
        {[0, 0.35, 0.6, 1].map((t) => (
          <text key={t} x={x(t)} y={H - B + 14} fontSize="10" textAnchor={t === 1 ? "end" : t === 0 ? "start" : "middle"} fill="var(--text-4)">{t === 0 ? "Broad" : t === 1 ? "Single maker" : t}</text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} fontSize="10.5" textAnchor="middle" fill="var(--text-3)">API supply concentration →</text>
        <text x={10} y={T + 4} fontSize="10.5" fill="var(--text-3)" transform={`rotate(-90 10 ${T + 4})`} textAnchor="end">Countries short now →</text>
        {points.filter((p) => !p.shortHere).map((p) => (
          <Link key={p.inn} href={drugHref(p.name)}>
            <circle className="board-dot" cx={x(p.concentration)} cy={y(p.countriesShort)} r={3.5} fill="var(--text-4)" fillOpacity={0.45}>
              <title>{`${p.name}: ${TIER_LABEL[p.tier]} (${p.nApiMakers ?? "?"} API makers), short in ${p.countriesShort} countries`}</title>
            </circle>
          </Link>
        ))}
        {points.filter((p) => p.shortHere).map((p) => (
          <Link key={p.inn} href={drugHref(p.name)}>
            <circle className="board-dot" cx={x(p.concentration)} cy={y(p.countriesShort)} r={4.5} fill="var(--crit)" stroke="#fff" strokeWidth={1}>
              <title>{`${p.name}: ${TIER_LABEL[p.tier]} (${p.nApiMakers ?? "?"} API makers), short in ${p.countriesShort} countries incl. ${country}`}</title>
            </circle>
          </Link>
        ))}
      </svg>
      <div className="board-legend">
        <span><i style={{ background: "var(--crit)" }} />Short in {country} now</span>
        <span><i style={{ background: "var(--text-4)", opacity: 0.45 }} />Not short in {country}</span>
        <span><i style={{ background: "var(--crit-bg)", borderRadius: 2, border: "1px solid var(--crit-b)" }} />Highly concentrated (about 4 or fewer API makers)</span>
      </div>
    </>
  );
}

export function GovDashboardView() {
  const [country, setCountry] = useState("AU");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryDone, setSummaryDone] = useState(false);
  const [showAllEssential, setShowAllEssential] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Market from the sidebar country picker's cookie (same as the Intelligence page).
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )mederti-country=([A-Za-z]{2})/);
    if (m) setCountry(m[1].toUpperCase());
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    fetch(`/api/insights/dashboard?country=${country}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: DashboardData) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [country]);

  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryDone(false);
    fetch(`/api/insights/dashboard-summary?country=${country}`)
      .then((r) => r.json())
      .then((d) => alive && setSummary(typeof d?.summary === "string" ? d.summary : null))
      .catch(() => {})
      .finally(() => alive && setSummaryDone(true));
    return () => { alive = false; };
  }, [country]);

  const market = COUNTRY_NAMES[country] ?? country;
  const essentialShown = useMemo(
    () => (data ? (showAllEssential ? data.essential : data.essential.slice(0, ESSENTIAL_PREVIEW)) : []),
    [data, showAllEssential],
  );
  const peerMax = data ? Math.max(1, ...data.peers.map((p) => p.essentialShort)) : 1;
  const apiMax = data ? Math.max(1, ...data.apiCountries.map((c) => c.molecules)) : 1;

  const downloadReport = async () => {
    if (pdfBusy || !data) return;
    setPdfBusy(true);
    try {
      await generateDashboardPdf(data, summary);
    } catch (err) {
      console.error("[dashboard] PDF generation failed:", err);
    } finally {
      setPdfBusy(false);
    }
  };

  const k = data?.kpis;

  return (
    <div className="govdash">
      <style>{`
.govdash{
  /* Aligned to the tuned reskin palette (matches /search + /drugs).
     Was a Tailwind/zinc default palette from the original HTML mockup. */
  --bg:#fff; --bg-2:#fafbfc; --bg-3:#eef2f5; --card:#fff; --border:#e8ecf0; --border-2:#dde3e9;
  --text:#0c1118; --text-2:#3b434e; --text-3:#6a7280; --text-4:#98a1ac;
  --teal:#0fa676; --teal-l:#0c8a62; --teal-bg:#e8f6f0; --teal-b:#bce4d4;
  --crit:#dc2647; --crit-bg:#fdeef1; --crit-b:#f8cdd6;
  --med:#b46708; --med-bg:#fdf6e9; --med-b:#f3dcae;
  --ok:#0fa676; --ok-bg:#e8f6f0; --ok-b:#bce4d4;
  --indigo:#6366f1; --ind-bg:#eef2ff; --ind-b:#c7d2fe;
  --high:#c2410c; --high-bg:#fdf1ea; --high-b:#fbd2bb;
  --low:#0fa676; --low-bg:#e8f6f0; --low-b:#bce4d4;

  height:100%;
  overflow-y:auto;
  background:var(--bg-2);
  font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;
  color:var(--text);
  display:flex;
  flex-direction:column;
}
.govdash *{margin:0;padding:0;box-sizing:border-box}

/* PAGE HEADER */
.govdash .gov-head{padding:22px 28px 16px;background:#fff;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-end;flex-shrink:0}
.govdash .gov-crumb{font-size:11px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px}
.govdash .gov-title{font-size:24px;font-weight:600;letter-spacing:-0.025em;color:var(--text);line-height:1.1}
.govdash .gov-sub{font-size:12px;color:var(--text-3);margin-top:5px}
.govdash .gov-head-r{display:flex;align-items:center;gap:12px}
.govdash .gov-report-btn{font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:8px;background:var(--teal);color:#fff;border:none;cursor:pointer;white-space:nowrap}
.govdash .gov-report-btn:hover{background:var(--teal-l)}
.govdash .gov-report-btn:disabled{opacity:0.6;cursor:default}

.govdash .gov-scroll{flex:1;overflow-y:auto;padding:18px 28px 32px;background:#f4f5f7}

/* AI MARKET READ — analyst commentary band */
.govdash .gov-read{background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06)}
.govdash .gov-read-head{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.govdash .gov-read-spark{font-size:12px;line-height:1}
.govdash .gov-read-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--teal-l)}
.govdash .gov-read-meta{font-size:10px;color:var(--text-4);margin-left:auto}
.govdash .gov-read-body{font-size:13px;line-height:1.62;color:var(--text-2)}
.govdash .gov-read-skel{height:12px;border-radius:5px;background:linear-gradient(90deg,var(--bg-3) 25%,#f3f6f8 50%,var(--bg-3) 75%);background-size:200% 100%;animation:govShimmer 1.3s ease-in-out infinite;margin-bottom:8px}
.govdash .gov-read-skel:last-child{width:72%;margin-bottom:0}
@keyframes govShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.govdash .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:16px}
.govdash .kpi{background:#fff;border:1px solid var(--border);border-radius:11px;padding:15px 16px;display:flex;flex-direction:column}
.govdash .kpi.crit{border-color:var(--crit-b)}
.govdash .kpi.good{border-color:var(--low-b)}
.govdash .kpi-label{font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-4);margin-bottom:0;font-weight:600;order:2}
.govdash .kpi-val{font-size:27px;font-weight:600;letter-spacing:-0.02em;color:var(--text);line-height:1;margin-bottom:8px;order:1}
.govdash .kpi-of{font-size:14px;color:var(--text-4);font-weight:500}
.govdash .kpi-delta{font-size:10.5px;margin-top:7px;font-family:var(--font-geist-mono),ui-monospace,monospace;order:3}
.govdash .kpi-delta.up{color:var(--crit)}
.govdash .kpi-delta.down{color:var(--low)}
.govdash .kpi-delta.flat{color:var(--text-4)}

.govdash .gov-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.govdash .gov-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06),inset 0 1px 0 rgba(255,255,255,.7)}
.govdash .gov-card.span2{grid-column:1 / -1}
.govdash .gc-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:13px}
.govdash .gc-title{font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}
.govdash .gc-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--indigo);background:var(--ind-bg);border:1px solid var(--ind-b);padding:2px 6px;border-radius:5px}
.govdash .gc-meta{font-size:11px;color:var(--text-4)}

/* essential medicines table */
.govdash .emtable{font-size:12.5px}
.govdash .em-h,.govdash .em-row{display:grid;grid-template-columns:2.1fr 0.9fr 2.1fr 0.8fr;gap:10px;align-items:center}
.govdash .em-h{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-4);font-weight:600;padding:0 8px 9px;border-bottom:1px solid var(--border)}
.govdash .em-row{padding:11px 8px;border-bottom:1px solid var(--bg-3)}
.govdash .em-row.crit{background:var(--crit-bg)}
.govdash .em-row.high{background:var(--high-bg)}
.govdash .em-drug{font-weight:600;color:var(--text)}
.govdash .em-drug-link{color:inherit;text-decoration:none}
.govdash .em-drug-link:hover{color:var(--teal-l);text-decoration:underline}
.govdash .em-tag{font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:5px;vertical-align:middle}
.govdash .em-tag.who{background:var(--ind-bg);color:var(--indigo);border:1px solid var(--ind-b)}
.govdash .em-tag.onc{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit-b)}
.govdash .em-tag.pae{background:var(--med-bg);color:var(--med);border:1px solid var(--med-b)}
.govdash .em-class{color:var(--text-3);font-size:11.5px}
.govdash .em-sup{font-size:11.5px;color:var(--text-2)}
.govdash .ss-bad{color:var(--high);font-weight:600}
.govdash .ss-bad.sole{color:var(--crit)}
.govdash .em-dur{font-family:var(--font-geist-mono),ui-monospace,monospace;color:var(--text-2)}
.govdash .em-foot{font-size:11.5px;color:var(--text-3);padding-top:11px}
.govdash .em-link{color:var(--teal);font-weight:500;cursor:pointer}


/* peer */
.govdash .peer-list{display:flex;flex-direction:column;gap:10px}
.govdash .peer-row{display:grid;grid-template-columns:22px 1.4fr 2fr 40px;gap:9px;align-items:center;font-size:12px}
.govdash .peer-flag{font-size:15px}
.govdash .peer-name{color:var(--text-2)}
.govdash .peer-bar{height:8px;border-radius:4px;background:var(--bg-3);overflow:hidden}
.govdash .peer-bar i{display:block;height:100%;background:var(--text-4)}
.govdash .peer-bar i.self{background:var(--teal)}
.govdash .peer-val{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;color:var(--text-2);text-align:right}
.govdash .peer-note{font-size:11.5px;color:var(--text-3);margin-top:12px;padding-top:11px;border-top:1px solid var(--bg-3)}

/* Mobile: stack every multi-column block into a single column. */
@media(max-width:768px){
  .govdash .kpi-row{grid-template-columns:1fr}
  .govdash .gov-grid{grid-template-columns:1fr}
  .govdash .gov-head{flex-direction:column;align-items:flex-start;gap:12px}
  .govdash .gov-head-r{flex-wrap:wrap}
  .govdash .em-h,.govdash .em-row{grid-template-columns:1.5fr 0.6fr 1.5fr}
  .govdash .em-h>:nth-child(4),.govdash .em-row>:nth-child(4){display:none}
}



/* live-data additions */
.govdash .em-tag.eu{background:var(--teal-bg);color:var(--teal-l);border:1px solid var(--teal-b)}
.govdash .tier{font-size:11px;font-weight:600}
.govdash .tier.highly_concentrated{color:var(--crit)} .govdash .tier.concentrated{color:var(--high)}
.govdash .tier.broad{color:var(--text-3)} .govdash .tier.unknown{color:var(--text-4);font-weight:500}
.govdash .tier-sub{display:block;font-size:10.5px;color:var(--text-4);font-weight:400;margin-top:2px}
.govdash .em-more{font-size:12px;color:var(--teal);font-weight:500;cursor:pointer;background:none;border:none;padding:11px 8px 0}
.govdash .ew-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg-3);font-size:12px}
.govdash .ew-row:last-child{border-bottom:none}
.govdash .ew-name{font-weight:600;color:var(--text)}
.govdash .ew-peers{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--text-3);text-align:right}
.govdash .gc-link{font-size:11.5px;color:var(--teal);font-weight:500;text-decoration:none}
.govdash .board-svg{width:100%;height:auto;display:block}
.govdash .board-dot{cursor:pointer}
.govdash .board-legend{display:flex;gap:16px;font-size:11px;color:var(--text-3);margin-top:8px;flex-wrap:wrap}
.govdash .board-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.govdash .gov-note{font-size:11px;color:var(--text-4);line-height:1.55;margin-top:16px}
.govdash .gov-empty{font-size:12.5px;color:var(--text-3);padding:10px 0}
.govdash .gov-err{background:#fff;border:1px solid var(--crit-b);border-radius:12px;padding:16px 18px;font-size:13px;color:var(--text-2)}
      `}</style>

      {/* PAGE HEADER */}
      <div className="gov-head">
        <div className="gov-head-l">
          <div className="gov-crumb">National Medicines Supply · {market}</div>
          <h1 className="gov-title">Shortage Dashboard</h1>
          <div className="gov-sub">
            Live from regulator shortage reports
            {data?.latestReportAt && ` · newest ${market} report updated ${relTime(data.latestReportAt)}`}
          </div>
        </div>
        <div className="gov-head-r">
          <button className="gov-report-btn" onClick={downloadReport} disabled={pdfBusy || !data}>
            ↧ {pdfBusy ? "Preparing…" : "Download report"}
          </button>
        </div>
      </div>

      <div className="gov-scroll">
        {/* WATCHLIST RISK BOARD — signed-in users see their own medicines
            first. Renders nothing for anonymous visitors. (Feedback #5.) */}
        <WatchlistRiskBoard />

        {/* AI MARKET READ — hidden entirely if neither the model nor the
            deterministic fallback produced text. */}
        {!(summaryDone && !summary) && (
          <div className="gov-read">
            <div className="gov-read-head">
              <span className="gov-read-spark">✦</span>
              <span className="gov-read-label">AI market read</span>
              <span className="gov-read-meta">Generated by Mederti AI from the figures below</span>
            </div>
            {summary === null ? (
              <div aria-busy="true" aria-label="Generating market read">
                <div className="gov-read-skel" />
                <div className="gov-read-skel" />
                <div className="gov-read-skel" />
              </div>
            ) : (
              <p className="gov-read-body">{summary}</p>
            )}
          </div>
        )}

        {error && <div className="gov-err">The dashboard data couldn&apos;t be loaded. Try again in a minute.</div>}

        {/* KPI STRIP */}
        {k && data && (
          <div className="kpi-row">
            <div className="kpi crit">
              <div className="kpi-label">Active shortage reports</div>
              <div className="kpi-val">{k.activeReports.toLocaleString()}</div>
              <div className="kpi-delta flat">{k.newLast30} started in the last 30 days</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Essential medicines short</div>
              <div className="kpi-val">{k.essentialShort} <span className="kpi-of">/ {data.universeSize}</span></div>
              <div className="kpi-delta flat">WHO Model List or EU critical list</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">…with concentrated API supply</div>
              <div className="kpi-val">{k.essentialShortConcentrated}</div>
              <div className="kpi-delta flat">few API makers or few finished-dose firms</div>
            </div>
            <div className="kpi good">
              <div className="kpi-label">Median resolution</div>
              <div className="kpi-val">{k.medianResolutionDays ?? "—"} {k.medianResolutionDays != null && <span className="kpi-of">days</span>}</div>
              <div className="kpi-delta flat">{k.resolvedLast12mo} resolved in the last 12 months</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Short in peers, not reported here</div>
              <div className="kpi-val">{k.earlyWarning}</div>
              <div className="kpi-delta flat">essential medicines, 2+ peer markets</div>
            </div>
          </div>
        )}

        {/* SHORTAGE TREND — past changes + anticipated ahead */}
        <div className="gov-card span2" style={{ marginBottom: 16 }}>
          <div className="gc-head">
            <div className="gc-title">Shortage trend</div>
            <div className="gc-meta">new &amp; active shortages over time · anticipated onsets ahead</div>
          </div>
          <ShortageTrendChart country={country} />
        </div>

        {data && (
          <div className="gov-grid">
            {/* Essential medicines short here */}
            <div className="gov-card span2">
              <div className="gc-head">
                <div className="gc-title">Essential medicines short in {market}</div>
                <div className="gc-meta">{data.essential.length} now · most concentrated supply first</div>
              </div>
              {data.essential.length === 0 ? (
                <div className="gov-empty">No essential or critical medicines are recorded as short in {market} right now.</div>
              ) : (
                <div className="emtable">
                  <div className="em-h">
                    <div>Medicine</div>
                    <div>Days since first report</div>
                    <div>Supply base</div>
                    <div>Countries short</div>
                  </div>
                  {essentialShown.map((e) => (
                    <div key={e.inn} className={`em-row${e.tier === "highly_concentrated" ? " crit" : ""}`}>
                      <div className="em-drug">
                        <Link href={drugHref(e.name)} className="em-drug-link">{e.name}</Link>
                        {e.whoList && <span className="em-tag who">WHO {e.whoList === "core" ? "core" : "compl."}</span>}
                        {e.euCritical && <span className="em-tag eu">EU critical</span>}
                      </div>
                      <div className="em-dur">{e.daysShort ?? "—"}</div>
                      <div>
                        <span className={`tier ${e.tier}`}>{TIER_LABEL[e.tier]}</span>
                        {e.tier !== "unknown" && (
                          <span className="tier-sub">
                            {[
                              e.nApiMakers != null ? `${e.nApiMakers} API makers` : null,
                              e.nFinishedFirms != null ? `${e.nFinishedFirms} US finished-dose firms` : null,
                              e.topApiCountry && e.topApiShare != null ? `${Math.round(e.topApiShare * 100)}% of API makers in ${e.topApiCountry}` : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      <div className="em-dur">{e.countriesShort}</div>
                    </div>
                  ))}
                  {data.essential.length > ESSENTIAL_PREVIEW && (
                    <button className="em-more" onClick={() => setShowAllEssential((v) => !v)}>
                      {showAllEssential ? "Show fewer" : `Show all ${data.essential.length}`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Concentration × spread */}
            <div className="gov-card span2">
              <div className="gc-head">
                <div className="gc-title">Supply concentration and spread</div>
                <div className="gc-meta">{data.board.length} essential medicines with supplier data</div>
              </div>
              <ConcentrationBoard points={data.board} country={country} />
            </div>

            {/* Early warning */}
            <div className="gov-card">
              <div className="gc-head">
                <div className="gc-title">Short in peer markets, not reported here</div>
                <Link href="/insights/intelligence" className="gc-link">Full radar →</Link>
              </div>
              {data.earlyWarning.length === 0 ? (
                <div className="gov-empty">No essential medicines are short in two or more of {market}&apos;s peer markets without also being reported short here.</div>
              ) : (
                data.earlyWarning.slice(0, 8).map((e) => (
                  <div key={e.inn} className="ew-row">
                    <span>
                      <Link href={drugHref(e.name)} className="em-drug-link ew-name">{e.name}</Link>
                      <span className={`tier ${e.tier}`} style={{ marginLeft: 8 }}>{TIER_LABEL[e.tier]}</span>
                    </span>
                    <span className="ew-peers">{e.peers.join(" · ")}</span>
                  </div>
                ))
              )}
            </div>

            {/* Peers */}
            <div className="gov-card">
              <div className="gc-head">
                <div className="gc-title">Essential medicines short, by market</div>
                <div className="gc-meta">{market} and its peers</div>
              </div>
              <div className="peer-list">
                {data.peers.map((p) => (
                  <div key={p.country} className="peer-row">
                    <span className="peer-flag" />
                    <span className="peer-name">{COUNTRY_NAMES[p.country] ?? p.country}</span>
                    <span className="peer-bar"><i className={p.self ? "self" : ""} style={{ width: `${(100 * p.essentialShort) / peerMax}%` }} /></span>
                    <span className="peer-val">{p.essentialShort}</span>
                  </div>
                ))}
              </div>
              <div className="peer-note">Counts depend on how much each regulator publishes, so they compare reporting as much as supply. A market that publishes little will look calm here and show many &quot;short in peers&quot; medicines.</div>
            </div>

            {/* Where APIs are made */}
            <div className="gov-card span2">
              <div className="gc-head">
                <div className="gc-title">Where essential-medicine APIs are made</div>
                <div className="gc-meta">largest API-making country per medicine · FDA DMF + DECRS</div>
              </div>
              <div className="peer-list">
                {data.apiCountries.map((c) => (
                  <div key={c.country} className="peer-row">
                    <span className="peer-flag" />
                    <span className="peer-name">{COUNTRY_NAMES[c.country] ?? c.country}</span>
                    <span className="peer-bar"><i style={{ width: `${(100 * c.molecules) / apiMax}%` }} /></span>
                    <span className="peer-val">{c.molecules}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="gov-note">
          Essential medicines are those on the WHO Model List of Essential Medicines or the EU Union list of critical
          medicines. API supply concentration counts distinct API manufacturers in FDA Drug Master File and WHO
          prequalification data, which under-covers medicines not sold in the US. Concentration describes the supply
          base: Mederti&apos;s own backtest found it does not predict when a shortage starts or how long it lasts.
          {data?.scoresComputedAt && ` Supply data recomputed ${relTime(data.scoresComputedAt)}.`}
        </p>
      </div>
    </div>
  );
}
