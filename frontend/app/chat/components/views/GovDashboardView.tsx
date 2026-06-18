"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_FALLBACK_SUMMARY } from "@/lib/insights/dashboard-snapshot";

const RANGE_OPTIONS = ["Today", "Quarter", "YTD", "12mo"];

export function GovDashboardView() {
  const [activeRange, setActiveRange] = useState("Quarter");
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/insights/dashboard-summary")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setSummary(typeof d?.summary === "string" ? d.summary : DASHBOARD_FALLBACK_SUMMARY);
      })
      .catch(() => {
        if (alive) setSummary(DASHBOARD_FALLBACK_SUMMARY);
      });
    return () => {
      alive = false;
    };
  }, []);

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
.govdash .gov-range{display:flex;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:2px}
.govdash .gr-opt{font-size:12px;padding:5px 11px;border-radius:6px;color:var(--text-3);cursor:pointer}
.govdash .gr-opt.on{background:#fff;color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
.govdash .gov-report-btn{font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:8px;background:var(--teal);color:#fff;border:none;cursor:pointer;white-space:nowrap}
.govdash .gov-report-btn:hover{background:var(--teal-l)}

.govdash .gov-scroll{flex:1;overflow-y:auto;padding:18px 28px 32px;background:var(--bg-2)}

/* AI MARKET READ — analyst commentary band */
.govdash .gov-read{background:linear-gradient(180deg,var(--teal-bg),#fff);border:1px solid var(--teal-b);border-radius:12px;padding:14px 17px;margin-bottom:14px}
.govdash .gov-read-head{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.govdash .gov-read-spark{font-size:12px;line-height:1}
.govdash .gov-read-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--teal-l)}
.govdash .gov-read-meta{font-size:10px;color:var(--text-4);margin-left:auto}
.govdash .gov-read-body{font-size:13px;line-height:1.62;color:var(--text-2)}
.govdash .gov-read-skel{height:12px;border-radius:5px;background:linear-gradient(90deg,var(--bg-3) 25%,#f3f6f8 50%,var(--bg-3) 75%);background-size:200% 100%;animation:govShimmer 1.3s ease-in-out infinite;margin-bottom:8px}
.govdash .gov-read-skel:last-child{width:72%;margin-bottom:0}
@keyframes govShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.govdash .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
.govdash .kpi{background:#fff;border:1px solid var(--border);border-radius:11px;padding:15px 16px}
.govdash .kpi.crit{border-color:var(--crit-b);background:linear-gradient(#fff,var(--crit-bg))}
.govdash .kpi.good{border-color:var(--low-b);background:linear-gradient(#fff,var(--low-bg))}
.govdash .kpi-label{font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-4);margin-bottom:8px;font-weight:600}
.govdash .kpi-val{font-size:27px;font-weight:600;letter-spacing:-0.02em;color:var(--text);line-height:1}
.govdash .kpi-of{font-size:14px;color:var(--text-4);font-weight:500}
.govdash .kpi-delta{font-size:10.5px;margin-top:7px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.govdash .kpi-delta.up{color:var(--crit)}
.govdash .kpi-delta.down{color:var(--low)}
.govdash .kpi-delta.flat{color:var(--text-4)}

.govdash .gov-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.govdash .gov-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06),inset 0 1px 0 rgba(255,255,255,.7)}
.govdash .gov-card.span2{grid-column:1 / -1}
.govdash .gc-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:13px}
.govdash .gc-title{font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}
.govdash .gc-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--indigo);background:var(--ind-bg);border:1px solid var(--ind-b);padding:2px 6px;border-radius:5px}
.govdash .gc-meta{font-size:11px;color:var(--text-4)}

/* essential medicines table */
.govdash .emtable{font-size:12.5px}
.govdash .em-h,.govdash .em-row{display:grid;grid-template-columns:2.1fr 1.4fr 1.1fr 0.8fr 1.2fr 0.9fr;gap:10px;align-items:center}
.govdash .em-h{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-4);font-weight:600;padding:0 8px 9px;border-bottom:1px solid var(--border)}
.govdash .em-row{padding:11px 8px;border-bottom:1px solid var(--bg-3)}
.govdash .em-row.crit{background:var(--crit-bg)}
.govdash .em-row.high{background:var(--high-bg)}
.govdash .em-drug{font-weight:600;color:var(--text)}
.govdash .em-tag{font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:5px;vertical-align:middle}
.govdash .em-tag.who{background:var(--ind-bg);color:var(--indigo);border:1px solid var(--ind-b)}
.govdash .em-tag.onc{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit-b)}
.govdash .em-tag.pae{background:var(--med-bg);color:var(--med);border:1px solid var(--med-b)}
.govdash .em-class{color:var(--text-3);font-size:11.5px}
.govdash .em-sup{font-size:11.5px;color:var(--text-2)}
.govdash .ss-bad{color:var(--high);font-weight:600}
.govdash .ss-bad.sole{color:var(--crit)}
.govdash .em-dur{font-family:var(--font-geist-mono),ui-monospace,monospace;color:var(--text-2)}
.govdash .em-risk{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text-2)}
.govdash .riskbar{width:34px;height:5px;border-radius:3px;background:var(--bg-3);overflow:hidden;flex-shrink:0}
.govdash .riskbar i{display:block;height:100%;background:var(--crit)}
.govdash .em-fc{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--teal)}
.govdash .em-foot{font-size:11.5px;color:var(--text-3);padding-top:11px}
.govdash .em-link{color:var(--teal);font-weight:500;cursor:pointer}

/* concentration */
.govdash .conc-list{display:flex;flex-direction:column;gap:11px}
.govdash .conc-row{display:grid;grid-template-columns:1.5fr 2fr 40px;gap:10px;align-items:center;font-size:12px}
.govdash .conc-name{color:var(--text-2)}
.govdash .conc-bar{height:8px;border-radius:4px;background:var(--bg-3);overflow:hidden}
.govdash .conc-bar i{display:block;height:100%}
.govdash .conc-bar i.crit{background:var(--crit)} .govdash .conc-bar i.high{background:var(--high)} .govdash .conc-bar i.med{background:var(--med)} .govdash .conc-bar i.low{background:var(--low)}
.govdash .conc-pct{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;color:var(--text-2);text-align:right}

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

/* upstream */
.govdash .up-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}
.govdash .up-card{border:1px solid var(--border);border-radius:10px;padding:13px;background:var(--bg-2)}
.govdash .up-card.crit{border-color:var(--crit-b);background:var(--crit-bg)}
.govdash .up-card.high{border-color:var(--high-b);background:var(--high-bg)}
.govdash .up-top{display:flex;align-items:center;gap:7px;margin-bottom:8px}
.govdash .up-flag{font-size:15px}
.govdash .up-site{font-size:12px;font-weight:600;color:var(--text);flex:1;min-width:0}
.govdash .up-sev{font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px}
.govdash .up-sev.crit{background:var(--crit);color:#fff}
.govdash .up-sev.high{background:var(--high);color:#fff}
.govdash .up-body{font-size:11.5px;color:var(--text-2);line-height:1.5}
.govdash .up-foot{font-size:10px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:9px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06)}

@media(max-width:1500px){.govdash .kpi-row{grid-template-columns:repeat(5,1fr)}}
      `}</style>

      {/* PAGE HEADER */}
      <div className="gov-head">
        <div className="gov-head-l">
          <div className="gov-crumb">National Medicines Supply · Australia</div>
          <h1 className="gov-title">Shortage Dashboard</h1>
          <div className="gov-sub">Live across TGA + 21 benchmarked regulators · updated 8 min ago</div>
        </div>
        <div className="gov-head-r">
          <div className="gov-range">
            {RANGE_OPTIONS.map((opt) => (
              <span
                key={opt}
                className={`gr-opt${activeRange === opt ? " on" : ""}`}
                onClick={() => setActiveRange(opt)}
              >
                {opt}
              </span>
            ))}
          </div>
          <button className="gov-report-btn">↧ Minister&apos;s report</button>
        </div>
      </div>

      <div className="gov-scroll">
        {/* AI MARKET READ */}
        <div className="gov-read">
          <div className="gov-read-head">
            <span className="gov-read-spark">✦</span>
            <span className="gov-read-label">AI market read</span>
            <span className="gov-read-meta">Generated by Mederti AI · refreshed periodically</span>
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

        {/* KPI STRIP */}
        <div className="kpi-row">
          <div className="kpi crit">
            <div className="kpi-label">Active shortages</div>
            <div className="kpi-val">312</div>
            <div className="kpi-delta up">▲ 18 vs last qtr</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Essential medicines short</div>
            <div className="kpi-val">38 <span className="kpi-of">/ 204</span></div>
            <div className="kpi-delta up">▲ 6 WHO EML affected</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Single-source nationally</div>
            <div className="kpi-val">19</div>
            <div className="kpi-delta flat">— no change</div>
          </div>
          <div className="kpi good">
            <div className="kpi-label">Median resolution</div>
            <div className="kpi-val">112 <span className="kpi-of">days</span></div>
            <div className="kpi-delta down">▼ 9 days vs peer median</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Upstream alerts</div>
            <div className="kpi-val">7</div>
            <div className="kpi-delta up">▲ 3 India/China sites</div>
          </div>
        </div>

        {/* TWO-COLUMN: watch table + side panels */}
        <div className="gov-grid">
          {/* Essential medicines watch */}
          <div className="gov-card span2">
            <div className="gc-head">
              <div className="gc-title">Essential medicines in shortage</div>
              <div className="gc-meta">38 active · sorted by clinical criticality × duration</div>
            </div>
            <div className="emtable">
              <div className="em-h">
                <span>Drug</span><span>Class</span><span>Suppliers</span><span>Duration</span><span>Risk</span><span>Forecast</span>
              </div>
              <div className="em-row crit">
                <div className="em-drug">Amoxicillin 500mg <span className="em-tag who">WHO EML</span></div>
                <div className="em-class">Antibiotic · J01CA</div>
                <div className="em-sup"><span className="ss-bad">1 of 4 active</span></div>
                <div className="em-dur">42 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "88%" }}></i></span>Critical</div>
                <div className="em-fc">Aug–Oct 26</div>
              </div>
              <div className="em-row crit">
                <div className="em-drug">Methotrexate inj <span className="em-tag onc">Oncology</span></div>
                <div className="em-class">Antineoplastic · L01BA</div>
                <div className="em-sup"><span className="ss-bad sole">Sole supplier</span></div>
                <div className="em-dur">96 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "95%" }}></i></span>Critical</div>
                <div className="em-fc">Q1 27</div>
              </div>
              <div className="em-row high">
                <div className="em-drug">Salbutamol CFC-free <span className="em-tag who">WHO EML</span></div>
                <div className="em-class">Bronchodilator · R03AC</div>
                <div className="em-sup">2 of 5 active</div>
                <div className="em-dur">28 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "64%" }}></i></span>High</div>
                <div className="em-fc">Jul 26</div>
              </div>
              <div className="em-row high">
                <div className="em-drug">Methylphenidate ER 36mg <span className="em-tag pae">Paediatric</span></div>
                <div className="em-class">CNS stimulant · N06BA</div>
                <div className="em-sup">2 of 3 active</div>
                <div className="em-dur">61 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "70%" }}></i></span>High</div>
                <div className="em-fc">Sep 26</div>
              </div>
              <div className="em-row">
                <div className="em-drug">Insulin glargine <span className="em-tag who">WHO EML</span></div>
                <div className="em-class">Antidiabetic · A10AE</div>
                <div className="em-sup">3 of 4 active</div>
                <div className="em-dur">14 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "42%" }}></i></span>Moderate</div>
                <div className="em-fc">Jun 26</div>
              </div>
              <div className="em-row">
                <div className="em-drug">Phenytoin 100mg</div>
                <div className="em-class">Anticonvulsant · N03AB</div>
                <div className="em-sup"><span className="ss-bad sole">Sole supplier</span></div>
                <div className="em-dur">73 days</div>
                <div className="em-risk"><span className="riskbar"><i style={{ width: "55%" }}></i></span>Moderate</div>
                <div className="em-fc">Aug 26</div>
              </div>
            </div>
            <div className="em-foot">+ 32 more essential medicines affected · <span className="em-link">view full national list →</span></div>
          </div>

          {/* Concentration risk */}
          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">Concentration risk by class</div>
              <div className="gc-meta">share dependent on a single API source</div>
            </div>
            <div className="conc-list">
              <div className="conc-row"><span className="conc-name">Beta-lactam antibiotics</span><span className="conc-bar"><i style={{ width: "82%" }} className="crit"></i></span><span className="conc-pct">82%</span></div>
              <div className="conc-row"><span className="conc-name">Oncology injectables</span><span className="conc-bar"><i style={{ width: "74%" }} className="crit"></i></span><span className="conc-pct">74%</span></div>
              <div className="conc-row"><span className="conc-name">ADHD stimulants</span><span className="conc-bar"><i style={{ width: "61%" }} className="high"></i></span><span className="conc-pct">61%</span></div>
              <div className="conc-row"><span className="conc-name">Insulins</span><span className="conc-bar"><i style={{ width: "48%" }} className="high"></i></span><span className="conc-pct">48%</span></div>
              <div className="conc-row"><span className="conc-name">Anticonvulsants</span><span className="conc-bar"><i style={{ width: "39%" }} className="med"></i></span><span className="conc-pct">39%</span></div>
              <div className="conc-row"><span className="conc-name">Cardiovascular</span><span className="conc-bar"><i style={{ width: "22%" }} className="low"></i></span><span className="conc-pct">22%</span></div>
            </div>
          </div>

          {/* Peer benchmarking */}
          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">Shortage burden vs peers</div>
              <div className="gc-meta">active essential-medicine shortages per 1,000 listings</div>
            </div>
            <div className="peer-list">
              <div className="peer-row"><span className="peer-flag">🇦🇺</span><span className="peer-name">Australia</span><span className="peer-bar"><i style={{ width: "62%" }} className="self"></i></span><span className="peer-val">18.6</span></div>
              <div className="peer-row"><span className="peer-flag">🇬🇧</span><span className="peer-name">United Kingdom</span><span className="peer-bar"><i style={{ width: "71%" }}></i></span><span className="peer-val">21.3</span></div>
              <div className="peer-row"><span className="peer-flag">🇨🇦</span><span className="peer-name">Canada</span><span className="peer-bar"><i style={{ width: "55%" }}></i></span><span className="peer-val">16.4</span></div>
              <div className="peer-row"><span className="peer-flag">🇺🇸</span><span className="peer-name">United States</span><span className="peer-bar"><i style={{ width: "88%" }}></i></span><span className="peer-val">26.1</span></div>
              <div className="peer-row"><span className="peer-flag">🇪🇺</span><span className="peer-name">EU (EMA avg)</span><span className="peer-bar"><i style={{ width: "48%" }}></i></span><span className="peer-val">14.2</span></div>
            </div>
            <div className="peer-note">AU sits <strong>mid-pack</strong> — better than US/UK, worse than EU average.</div>
          </div>

          {/* Upstream signals */}
          <div className="gov-card span2">
            <div className="gc-head">
              <div className="gc-title">Upstream early-warning signals <span className="gc-badge">moat</span></div>
              <div className="gc-meta">India (CDSCO) &amp; China (NMPA) site-level distress feeding your market</div>
            </div>
            <div className="up-grid">
              <div className="up-card crit">
                <div className="up-top"><span className="up-flag">🇮🇳</span><span className="up-site">Hyderabad — Sandoz API</span><span className="up-sev crit">High</span></div>
                <div className="up-body">GMP inspection flag, 14 May. Feeds <strong>amoxicillin, cephalexin</strong> AU supply. 2 downstream sponsors exposed.</div>
                <div className="up-foot">CDSCO · 6d ago · confidence 81</div>
              </div>
              <div className="up-card high">
                <div className="up-top"><span className="up-flag">🇨🇳</span><span className="up-site">Zhejiang — API intermediate</span><span className="up-sev high">Watch</span></div>
                <div className="up-body">Export volume down 34% QoQ. Single source for <strong>methotrexate</strong> precursor. No declared shortage yet.</div>
                <div className="up-foot">NMPA + customs · 11d ago · confidence 67</div>
              </div>
              <div className="up-card high">
                <div className="up-top"><span className="up-flag">🇮🇳</span><span className="up-site">Gujarat — stimulant API</span><span className="up-sev high">Watch</span></div>
                <div className="up-body">Environmental closure order. Supplies <strong>methylphenidate</strong> base. Paediatric formulary exposure.</div>
                <div className="up-foot">CDSCO · 3d ago · confidence 73</div>
              </div>
            </div>
          </div>
        </div>
        {/* /gov-grid */}
      </div>
      {/* /gov-scroll */}
    </div>
  );
}
