"use client";

import { useEffect, useState } from "react";

export function EarlyWarningView() {
  const [range, setRange] = useState<"30d" | "90d" | "6mo">("30d");
  const [pulse, setPulse] = useState<string | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [alerted, setAlerted] = useState<Set<string>>(new Set());
  const [showFull, setShowFull] = useState(false);

  // Analyst read — Claude-written market summary from live shortage data
  // (reuses the daily briefing's `market_pulse`, cached 6h server-side).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/intelligence/briefing")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d && typeof d.market_pulse === "string") setPulse(d.market_pulse);
        setPulseLoading(false);
      })
      .catch(() => {
        if (!cancelled) setPulseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the user's pre-alerts (set client-side, persisted in localStorage).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ew-prealerts") || "[]");
      if (Array.isArray(saved)) setAlerted(new Set(saved as string[]));
    } catch {}
  }, []);

  const toggleAlert = (drug: string) => {
    setAlerted((prev) => {
      const next = new Set(prev);
      if (next.has(drug)) next.delete(drug);
      else next.add(drug);
      try {
        localStorage.setItem("ew-prealerts", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  // Range = forecast horizon. Each row carries an onset (when the shortage is
  // forecast to begin); the tab filters the radar to drugs landing within it.
  const HORIZON_DAYS = { "30d": 30, "90d": 90, "6mo": 182 } as const;
  const HORIZON_LABEL = {
    "30d": "next 30 days",
    "90d": "next 90 days",
    "6mo": "next 6 months",
  } as const;
  // Drugs further down the radar (sub-45% probability), counted by horizon.
  const BELOW_THRESHOLD = { "30d": 9, "90d": 18, "6mo": 33 } as const;

  const RADAR_ROWS = [
    { drug: "Cephalexin 500mg", cls: "Antibiotic · J01DB", flag: "🇮🇳", signal: "Hyderabad GMP flag · shared API line w/ amoxicillin", window: "4–6 weeks", onsetDays: 28, prob: 87, conf: 81, tone: "crit" },
    { drug: "Methotrexate inj", cls: "Oncology · L01BA", flag: "🇨🇳", signal: "Zhejiang precursor export −34% QoQ · sole source", window: "6–9 weeks", onsetDays: 42, prob: 79, conf: 67, tone: "crit" },
    { drug: "Methylphenidate ER", cls: "CNS · N06BA", flag: "🇮🇳", signal: "Gujarat environmental closure · base API", window: "8–10 weeks", onsetDays: 56, prob: 71, conf: 73, tone: "high" },
    { drug: "Piperacillin-tazobactam", cls: "Antibiotic · J01CR", flag: "", signal: "Recurring Q3 pattern · 3 of last 4 years short", window: "10–12 weeks", onsetDays: 70, prob: 64, conf: 70, tone: "high" },
    { drug: "Atorvastatin 40mg", cls: "Statin · C10AA", flag: "", signal: "Sponsor deregistration filed · 1 of 6 brands exiting", window: "12+ weeks", onsetDays: 100, prob: 48, conf: 62, tone: "" },
  ];

  // Lower-probability forecasts (sub-45%) — revealed by "view full radar".
  const RADAR_EXTRA = [
    { drug: "Amoxicillin susp", cls: "Antibiotic · J01CA", flag: "🇮🇳", signal: "Hyderabad cluster · secondary line exposure", window: "4–5 weeks", onsetDays: 24, prob: 43, conf: 58, tone: "" },
    { drug: "Ondansetron inj", cls: "Antiemetic · A04AA", flag: "", signal: "Two sponsors on allocation · demand climbing", window: "9–11 weeks", onsetDays: 63, prob: 39, conf: 54, tone: "" },
    { drug: "Hydrocortisone inj", cls: "Cortico · H02AB", flag: "🇨🇳", signal: "Precursor lead time stretching", window: "12–16 weeks", onsetDays: 90, prob: 34, conf: 49, tone: "" },
    { drug: "Salbutamol MDI", cls: "SABA · R03AC", flag: "", signal: "Propellant transition · capacity dip", window: "18–22 weeks", onsetDays: 130, prob: 28, conf: 46, tone: "" },
  ];

  const horizonDays = HORIZON_DAYS[range];
  const visibleRows = RADAR_ROWS.filter((r) => r.onsetDays <= horizonDays);
  const extraRows = RADAR_EXTRA.filter((r) => r.onsetDays <= horizonDays);
  const belowThreshold = BELOW_THRESHOLD[range];
  const highRiskCount = visibleRows.length + belowThreshold;

  const renderRow = (r: (typeof RADAR_ROWS)[number]) => (
    <div className={r.tone ? `rad-row ${r.tone}` : "rad-row"} key={r.drug}>
      <div className="rad-drug">
        {r.drug}
        <span className="rad-cls">{r.cls}</span>
      </div>
      <div className="rad-sig">
        {r.flag && <span className="sig-flag">{r.flag}</span>}
        {r.signal}
      </div>
      <div className="rad-win">{r.window}</div>
      <div className="rad-prob">
        <span className="probbar">
          <i style={{ width: `${r.prob}%` }}></i>
        </span>
        <span className="prob-n">{r.prob}%</span>
      </div>
      <div className="rad-conf">
        {r.conf}
        <span className="conf-of">/100</span>
      </div>
      <div className="rad-act">
        <button
          className={alerted.has(r.drug) ? "rad-btn on" : "rad-btn"}
          onClick={() => toggleAlert(r.drug)}
        >
          {alerted.has(r.drug) ? "✓ Alerted" : "Pre-alert"}
        </button>
      </div>
    </div>
  );

  // Export brief — a markdown snapshot of exactly what's on screen for the
  // selected horizon. Built client-side; no backend round-trip.
  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      "# Mederti Intelligence — Early-warning brief",
      "",
      `Forecast horizon: ${HORIZON_LABEL[range]}`,
      `Generated: ${today}`,
      "",
    ];
    if (pulse) {
      lines.push("## Market read", pulse, "");
    }
    lines.push(
      `## High-risk, not yet declared (${highRiskCount})`,
      "Drugs forecast to go short — ranked by probability × clinical impact. None officially declared yet.",
      "",
      "| Drug | Class | Signal driver | Window | Probability | Confidence |",
      "|---|---|---|---|---|---|",
      ...visibleRows.map(
        (r) =>
          `| ${r.drug} | ${r.cls} | ${r.signal} | ${r.window} | ${r.prob}% | ${r.conf}/100 |`,
      ),
      "",
      `+ ${belowThreshold} more on the radar below 45% probability.`,
      "",
      "Source: Mederti early-warning radar — forecasts ahead of official declaration. Not medical advice.",
    );

    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mederti-early-warning-${range}-${today}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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

        /* analyst read */
        .ewradar .ew-brief{background:#fff;border:1px solid var(--border);border-radius:11px;padding:14px 18px;margin-bottom:14px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06)}
        .ewradar .ew-brief-head{display:flex;align-items:center;gap:9px;margin-bottom:7px}
        .ewradar .ew-brief-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--teal)}
        .ewradar .ew-brief-ai{font-size:10px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .ew-brief-text{font-size:13.5px;line-height:1.6;color:var(--text-2)}
        .ewradar .ew-brief-skel{height:12px;border-radius:5px;background:linear-gradient(90deg,var(--bg-2),var(--bg-3),var(--bg-2));background-size:200% 100%;animation:ewsk 1.4s ease-in-out infinite;margin-bottom:8px}
        .ewradar .ew-brief-skel:last-child{margin-bottom:0}
        @keyframes ewsk{0%{background-position:200% 0}100%{background-position:-200% 0}}

        .ewradar .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
        .ewradar .kpi-row.k4{grid-template-columns:repeat(4,1fr)}
        .ewradar .kpi{background:#fff;border:1px solid var(--border);border-radius:11px;padding:15px 16px}
        .ewradar .kpi.crit{border-color:var(--crit-b)}
        .ewradar .kpi.good{border-color:var(--low-b)}
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
        .ewradar .rad-btn.on{background:var(--teal);border-color:var(--teal);color:#fff}
        .ewradar .rad-btn.on:hover{background:var(--teal-l);border-color:var(--teal-l);color:#fff}

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
          <button className="gov-report-btn" onClick={handleExport}>
            ↧ Export brief
          </button>
        </div>
      </div>

      <div className="gov-scroll">
        {/* ANALYST READ — AI market summary from live data */}
        {(pulseLoading || pulse) && (
          <div className="ew-brief">
            <div className="ew-brief-head">
              <span className="ew-brief-label">Market read</span>
              <span className="ew-brief-ai">Mederti AI · live shortage data</span>
            </div>
            {pulse ? (
              <p className="ew-brief-text">{pulse}</p>
            ) : (
              <>
                <div className="ew-brief-skel" style={{ width: "94%" }}></div>
                <div className="ew-brief-skel" style={{ width: "72%" }}></div>
              </>
            )}
          </div>
        )}

        {/* PREDICTIVE KPI STRIP */}
        <div className="kpi-row k4">
          <div className="kpi crit">
            <div className="kpi-label">High-risk, not yet declared</div>
            <div className="kpi-val">{highRiskCount}</div>
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
              impact · none officially declared yet · {HORIZON_LABEL[range]}
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
            {visibleRows.map(renderRow)}
            {showFull && extraRows.map(renderRow)}
          </div>
          <div className="em-foot">
            {showFull ? (
              <>
                Showing {extraRows.length} of {belowThreshold} below-45%
                forecasts ·{" "}
                <span className="em-link" onClick={() => setShowFull(false)}>
                  collapse ↑
                </span>
              </>
            ) : (
              <>
                + {belowThreshold} more on the radar below 45% probability ·{" "}
                <span className="em-link" onClick={() => setShowFull(true)}>
                  view full radar →
                </span>
              </>
            )}
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
