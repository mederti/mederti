"use client";

import { useState } from "react";

export function EarlyWarningView() {
  const [range, setRange] = useState<"30d" | "90d" | "6mo">("30d");

  return (
    <div className="ewradar">
      <style>{`
        .ewradar{
          height:100%;overflow-y:auto;background:#f4f5f7;
          font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;color:#0c1118;
          --bg:#fafafa; --bg-2:#f4f4f5; --bg-3:#e4e4e7; --card:#fff; --border:#e4e4e7; --border-2:#d4d4d8;
          --text:#0c1118; --text-2:#3f3f46; --text-3:#71717a; --text-4:#a1a1aa;
          --teal:#0fa676; --teal-l:#0c8a62; --teal-bg:#e8f6f0; --teal-b:#bce4d4;
          --crit:#dc2626; --crit-bg:#fef2f2; --crit-b:#fecaca;
          --med:#ca8a04; --med-bg:#fefce8; --med-b:#f3dcae;
          --ok:#0fa676; --ok-bg:#e8f6f0; --ok-b:#bce4d4;
          --indigo:#6366f1; --ind-bg:#eef2ff; --ind-b:#c7d2fe;
          --high:#ea580c; --high-bg:#fff7ed; --high-b:#fed7aa;
          --low:#0fa676; --low-bg:#e8f6f0; --low-b:#bce4d4;
          --money:#0c8a62;
        }
        .ewradar *{margin:0;padding:0;box-sizing:border-box}

        .ewradar .gov-head{padding:22px 28px 16px;background:#fff;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-end;flex-shrink:0}
        .ewradar .gov-crumb{font-size:11px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px}
        .ewradar .gov-title{font-size:24px;font-weight:600;letter-spacing:-0.025em;color:var(--text);line-height:1.1}
        .ewradar .gov-title em{font-style:normal;color:var(--teal);font-weight:600}
        .ewradar .gov-sub{font-size:12px;color:var(--text-3);margin-top:5px}
        .ewradar .gov-head-r{display:flex;align-items:center;gap:12px}
        .ewradar .gov-range{display:flex;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:2px}
        .ewradar .gr-opt{font-size:12px;padding:5px 11px;border-radius:6px;color:var(--text-3);cursor:pointer}
        .ewradar .gr-opt.on{background:#fff;color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
        .ewradar .gov-report-btn{font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:8px;background:var(--teal);color:#fff;border:none;cursor:pointer;white-space:nowrap}
        .ewradar .gov-report-btn:hover{background:var(--teal-l)}

        .ewradar .gov-scroll{padding:18px 28px 32px;background:#f4f5f7}

        .ewradar .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
        .ewradar .kpi-row.k4{grid-template-columns:repeat(4,1fr)}
        .ewradar .kpi{background:#fff;border:1px solid var(--border);border-radius:11px;padding:15px 16px}
        .ewradar .kpi.crit{border-color:var(--crit-b);background:linear-gradient(#fff,var(--crit-bg))}
        .ewradar .kpi.good{border-color:var(--low-b);background:linear-gradient(#fff,var(--low-bg))}
        .ewradar .kpi-label{font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-4);margin-bottom:8px;font-weight:600}
        .ewradar .kpi-val{font-size:27px;font-weight:600;letter-spacing:-0.02em;color:var(--text);line-height:1}
        .ewradar .kpi-of{font-size:14px;color:var(--text-4);font-weight:500}
        .ewradar .kpi-delta{font-size:10.5px;margin-top:7px;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .kpi-delta.up{color:var(--crit)}
        .ewradar .kpi-delta.down{color:var(--low)}
        .ewradar .kpi-delta.flat{color:var(--text-4)}

        .ewradar .gov-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .ewradar .gov-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06),inset 0 1px 0 rgba(255,255,255,.7)}
        .ewradar .gov-card.span2{grid-column:1 / -1}
        .ewradar .moat-card{border-color:var(--ind-b);background:linear-gradient(#fff,#fbfbff)}
        .ewradar .gc-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:13px}
        .ewradar .gc-title{font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}
        .ewradar .gc-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--indigo);background:var(--ind-bg);border:1px solid var(--ind-b);padding:2px 6px;border-radius:5px}
        .ewradar .gc-meta{font-size:11px;color:var(--text-4)}

        .ewradar .em-foot{font-size:11.5px;color:var(--text-3);padding-top:11px}
        .ewradar .em-link{color:var(--teal);font-weight:500;cursor:pointer}

        /* radar table */
        .ewradar .radar{font-size:12.5px;margin-top:2px}
        .ewradar .rad-h,.ewradar .rad-row{display:grid;grid-template-columns:1.5fr 2.3fr 0.9fr 1.2fr 0.8fr 0.9fr;gap:10px;align-items:center}
        .ewradar .rad-h{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-4);font-weight:600;padding:0 8px 9px;border-bottom:1px solid var(--border)}
        .ewradar .rad-row{padding:12px 8px;border-bottom:1px solid var(--bg-3)}
        .ewradar .rad-row.crit{background:var(--crit-bg)}
        .ewradar .rad-row.high{background:var(--high-bg)}
        .ewradar .rad-drug{font-weight:600;color:var(--text);display:flex;flex-direction:column;gap:2px}
        .ewradar .rad-cls{font-weight:400;font-size:10.5px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .rad-sig{font-size:11.5px;color:var(--text-2);line-height:1.4}
        .ewradar .sig-flag{margin-right:5px}
        .ewradar .rad-win{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;color:var(--text-2)}
        .ewradar .rad-prob{display:flex;align-items:center;gap:8px}
        .ewradar .probbar{flex:1;height:6px;border-radius:3px;background:var(--bg-3);overflow:hidden}
        .ewradar .probbar i{display:block;height:100%;background:var(--crit)}
        .ewradar .prob-n{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11.5px;font-weight:500;color:var(--text);min-width:30px}
        .ewradar .rad-conf{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:14px;font-weight:500;color:var(--teal)}
        .ewradar .conf-of{font-size:9px;color:var(--text-4)}
        .ewradar .rad-btn{font-size:11px;font-weight:600;padding:6px 12px;border-radius:7px;background:#fff;border:1px solid var(--border-2);color:var(--text-2);cursor:pointer;white-space:nowrap}
        .ewradar .rad-btn:hover{border-color:var(--teal);color:var(--teal)}

        /* feed */
        .ewradar .feed{display:flex;flex-direction:column;gap:0}
        .ewradar .feed-item{display:flex;gap:11px;padding:11px 0;border-bottom:1px solid var(--bg-3)}
        .ewradar .feed-item:last-child{border-bottom:none}
        .ewradar .feed-dot{width:8px;height:8px;border-radius:50%;background:var(--text-4);margin-top:5px;flex-shrink:0}
        .ewradar .feed-item.crit .feed-dot{background:var(--crit)}
        .ewradar .feed-item.high .feed-dot{background:var(--high)}
        .ewradar .feed-body{min-width:0;flex:1}
        .ewradar .feed-top{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text);margin-bottom:3px}
        .ewradar .feed-top strong{font-weight:600}
        .ewradar .feed-time{margin-left:auto;font-size:10px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .feed-txt{font-size:11.5px;color:var(--text-3);line-height:1.5}

        /* calibration */
        .ewradar .calib-big{text-align:center;padding:6px 0 14px;border-bottom:1px solid var(--bg-3);margin-bottom:14px}
        .ewradar .calib-n{font-size:38px;font-weight:600;color:var(--teal);letter-spacing:-0.02em;line-height:1}
        .ewradar .calib-l{font-size:11px;color:var(--text-3);margin-top:5px}
        .ewradar .calib-rows{display:flex;flex-direction:column;gap:10px}
        .ewradar .calib-row{display:grid;grid-template-columns:1.3fr 2fr 36px;gap:9px;align-items:center;font-size:12px;color:var(--text-2)}
        .ewradar .calib-bar{height:7px;border-radius:4px;background:var(--bg-3);overflow:hidden}
        .ewradar .calib-bar i{display:block;height:100%}
        .ewradar .calib-bar i.low{background:var(--teal)}
        .ewradar .calib-bar i.med{background:var(--med)}
        .ewradar .calib-pct{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--text-2);text-align:right}
        .ewradar .peer-note{font-size:11.5px;color:var(--text-3);margin-top:12px;padding-top:11px;border-top:1px solid var(--bg-3)}
      `}</style>

      <div className="gov-head">
        <div className="gov-head-l">
          <div className="gov-crumb">Predictive layer · global</div>
          <h1 className="gov-title">Intelligence</h1>
          <div className="gov-sub">
            Shortages forecast <em>before</em> official declaration · upstream
            signals from 22 countries
          </div>
        </div>
        <div className="gov-head-r">
          <div className="gov-range">
            <span
              className={range === "30d" ? "gr-opt on" : "gr-opt"}
              onClick={() => setRange("30d")}
            >
              30d
            </span>
            <span
              className={range === "90d" ? "gr-opt on" : "gr-opt"}
              onClick={() => setRange("90d")}
            >
              90d
            </span>
            <span
              className={range === "6mo" ? "gr-opt on" : "gr-opt"}
              onClick={() => setRange("6mo")}
            >
              6mo
            </span>
          </div>
          <button className="gov-report-btn">↧ Export brief</button>
        </div>
      </div>

      <div className="gov-scroll">
        {/* PREDICTIVE KPI STRIP */}
        <div className="kpi-row k4">
          <div className="kpi crit">
            <div className="kpi-label">High-risk, not yet declared</div>
            <div className="kpi-val">23</div>
            <div className="kpi-delta up">▲ 5 entered this week</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Avg lead time vs regulator</div>
            <div className="kpi-val">
              37 <span className="kpi-of">days</span>
            </div>
            <div className="kpi-delta down">▼ earlier than official notice</div>
          </div>
          <div className="kpi good">
            <div className="kpi-label">Forecast accuracy (90d)</div>
            <div className="kpi-val">
              78<span className="kpi-of">%</span>
            </div>
            <div className="kpi-delta down">▲ 4pts vs last quarter</div>
          </div>
          <div className="kpi crit">
            <div className="kpi-label">Upstream sites in distress</div>
            <div className="kpi-val">7</div>
            <div className="kpi-delta up">▲ 3 India · 1 China new</div>
          </div>
        </div>

        {/* EARLY-WARNING RADAR (the moat) */}
        <div className="gov-card span2 moat-card">
          <div className="gc-head">
            <div className="gc-title">
              Early-warning radar <span className="gc-badge">moat</span>
            </div>
            <div className="gc-meta">
              drugs forecast to go short — ranked by probability × clinical
              impact · none officially declared yet
            </div>
          </div>
          <div className="radar">
            <div className="rad-h">
              <span>Drug / class</span>
              <span>Signal driver</span>
              <span>Window</span>
              <span>Probability</span>
              <span>Confidence</span>
              <span></span>
            </div>
            <div className="rad-row crit">
              <div className="rad-drug">
                Cephalexin 500mg
                <span className="rad-cls">Antibiotic · J01DB</span>
              </div>
              <div className="rad-sig">
                <span className="sig-flag">🇮🇳</span>Hyderabad GMP flag · shared
                API line w/ amoxicillin
              </div>
              <div className="rad-win">4–6 weeks</div>
              <div className="rad-prob">
                <span className="probbar">
                  <i style={{ width: "87%" }}></i>
                </span>
                <span className="prob-n">87%</span>
              </div>
              <div className="rad-conf">
                81<span className="conf-of">/100</span>
              </div>
              <div className="rad-act">
                <button className="rad-btn">Pre-alert</button>
              </div>
            </div>
            <div className="rad-row crit">
              <div className="rad-drug">
                Methotrexate inj
                <span className="rad-cls">Oncology · L01BA</span>
              </div>
              <div className="rad-sig">
                <span className="sig-flag">🇨🇳</span>Zhejiang precursor export
                −34% QoQ · sole source
              </div>
              <div className="rad-win">6–9 weeks</div>
              <div className="rad-prob">
                <span className="probbar">
                  <i style={{ width: "79%" }}></i>
                </span>
                <span className="prob-n">79%</span>
              </div>
              <div className="rad-conf">
                67<span className="conf-of">/100</span>
              </div>
              <div className="rad-act">
                <button className="rad-btn">Pre-alert</button>
              </div>
            </div>
            <div className="rad-row high">
              <div className="rad-drug">
                Methylphenidate ER
                <span className="rad-cls">CNS · N06BA</span>
              </div>
              <div className="rad-sig">
                <span className="sig-flag">🇮🇳</span>Gujarat environmental
                closure · base API
              </div>
              <div className="rad-win">8–10 weeks</div>
              <div className="rad-prob">
                <span className="probbar">
                  <i style={{ width: "71%" }}></i>
                </span>
                <span className="prob-n">71%</span>
              </div>
              <div className="rad-conf">
                73<span className="conf-of">/100</span>
              </div>
              <div className="rad-act">
                <button className="rad-btn">Pre-alert</button>
              </div>
            </div>
            <div className="rad-row high">
              <div className="rad-drug">
                Piperacillin-tazobactam
                <span className="rad-cls">Antibiotic · J01CR</span>
              </div>
              <div className="rad-sig">
                Recurring Q3 pattern · 3 of last 4 years short
              </div>
              <div className="rad-win">10–12 weeks</div>
              <div className="rad-prob">
                <span className="probbar">
                  <i style={{ width: "64%" }}></i>
                </span>
                <span className="prob-n">64%</span>
              </div>
              <div className="rad-conf">
                70<span className="conf-of">/100</span>
              </div>
              <div className="rad-act">
                <button className="rad-btn">Pre-alert</button>
              </div>
            </div>
            <div className="rad-row">
              <div className="rad-drug">
                Atorvastatin 40mg
                <span className="rad-cls">Statin · C10AA</span>
              </div>
              <div className="rad-sig">
                Sponsor deregistration filed · 1 of 6 brands exiting
              </div>
              <div className="rad-win">12+ weeks</div>
              <div className="rad-prob">
                <span className="probbar">
                  <i style={{ width: "48%" }}></i>
                </span>
                <span className="prob-n">48%</span>
              </div>
              <div className="rad-conf">
                62<span className="conf-of">/100</span>
              </div>
              <div className="rad-act">
                <button className="rad-btn">Pre-alert</button>
              </div>
            </div>
          </div>
          <div className="em-foot">
            + 18 more on the radar below 45% probability ·{" "}
            <span className="em-link">view full radar →</span>
          </div>
        </div>

        {/* UPSTREAM FEED + FORECAST CALIBRATION */}
        <div className="gov-grid">
          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">
                Upstream site feed <span className="gc-badge">moat</span>
              </div>
              <div className="gc-meta">India CDSCO · China NMPA · live</div>
            </div>
            <div className="feed">
              <div className="feed-item crit">
                <div className="feed-dot"></div>
                <div className="feed-body">
                  <div className="feed-top">
                    <span className="sig-flag">🇮🇳</span>
                    <strong>Hyderabad — Sandoz API</strong>
                    <span className="feed-time">6d</span>
                  </div>
                  <div className="feed-txt">
                    GMP inspection flag. Feeds amoxicillin + cephalexin AU
                    supply. 2 sponsors exposed.
                  </div>
                </div>
              </div>
              <div className="feed-item high">
                <div className="feed-dot"></div>
                <div className="feed-body">
                  <div className="feed-top">
                    <span className="sig-flag">🇨🇳</span>
                    <strong>Zhejiang — intermediate</strong>
                    <span className="feed-time">11d</span>
                  </div>
                  <div className="feed-txt">
                    Export volume −34% QoQ. Sole source for methotrexate
                    precursor.
                  </div>
                </div>
              </div>
              <div className="feed-item high">
                <div className="feed-dot"></div>
                <div className="feed-body">
                  <div className="feed-top">
                    <span className="sig-flag">🇮🇳</span>
                    <strong>Gujarat — stimulant API</strong>
                    <span className="feed-time">3d</span>
                  </div>
                  <div className="feed-txt">
                    Environmental closure order. Methylphenidate base.
                    Paediatric exposure.
                  </div>
                </div>
              </div>
              <div className="feed-item">
                <div className="feed-dot"></div>
                <div className="feed-body">
                  <div className="feed-top">
                    <span className="sig-flag">🇮🇳</span>
                    <strong>Visakhapatnam — sterile inj</strong>
                    <span className="feed-time">15d</span>
                  </div>
                  <div className="feed-txt">
                    Capacity expansion approved — easing signal for
                    cephalosporin lines.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">Forecast confidence</div>
              <div className="gc-meta">how calibrated our predictions are</div>
            </div>
            <div className="calib">
              <div className="calib-big">
                <div className="calib-n">78%</div>
                <div className="calib-l">
                  of 90-day forecasts landed within window
                </div>
              </div>
              <div className="calib-rows">
                <div className="calib-row">
                  <span>Upstream-driven</span>
                  <span className="calib-bar">
                    <i style={{ width: "84%" }} className="low"></i>
                  </span>
                  <span className="calib-pct">84%</span>
                </div>
                <div className="calib-row">
                  <span>Pattern / recurrence</span>
                  <span className="calib-bar">
                    <i style={{ width: "76%" }} className="low"></i>
                  </span>
                  <span className="calib-pct">76%</span>
                </div>
                <div className="calib-row">
                  <span>Sponsor exit</span>
                  <span className="calib-bar">
                    <i style={{ width: "69%" }} className="med"></i>
                  </span>
                  <span className="calib-pct">69%</span>
                </div>
                <div className="calib-row">
                  <span>Demand spike</span>
                  <span className="calib-bar">
                    <i style={{ width: "58%" }} className="med"></i>
                  </span>
                  <span className="calib-pct">58%</span>
                </div>
              </div>
              <div className="peer-note">
                Upstream signals are our most reliable predictor — and the
                hardest for competitors to replicate.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
