"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// Shared market conventions (mirrors PredictiveSignals.tsx so the radar reads
// the same across surfaces).
const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪",
  EU: "🇪🇺", AT: "🇦🇹", SE: "🇸🇪", DK: "🇩🇰",
};

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "the United States", GB: "the United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NZ: "New Zealand",
  IE: "Ireland", NL: "the Netherlands", BE: "Belgium", GR: "Greece", PT: "Portugal",
  AT: "Austria", CH: "Switzerland", FI: "Finland", NO: "Norway", SE: "Sweden",
  DK: "Denmark", SG: "Singapore", JP: "Japan", MY: "Malaysia", AE: "the UAE",
  EU: "the EU",
};

const SEV: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", label: "Critical" },
  high: { color: "var(--high)", bg: "var(--high-bg)", label: "High" },
  medium: { color: "var(--med)", bg: "var(--med-bg)", label: "Medium" },
  low: { color: "var(--text-3)", bg: "var(--bg-2)", label: "Low" },
};
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// "Short for" reads better than a raw day count when peer shortages run years.
const fmtDur = (d: number | null): string =>
  d == null
    ? "—"
    : d >= 730
      ? `${Math.round(d / 365)}y`
      : d >= 60
        ? `${Math.round(d / 30)}mo`
        : `${d}d`;

type SevFilter = "all" | "high" | "critical";

interface Signal {
  drug_id: string;
  drug_name: string;
  peer_count: number;
  peers: string[];
  worst_severity: string;
  oldest_start: string | null;
  days_lead: number | null;
  who_essential: boolean;
  concession_local?: boolean;
  concession_markets?: string[];
}
interface SignalsResponse {
  country: string;
  peer_set: string[];
  min_peers: number;
  total_candidates: number;
  concession_candidates?: number;
  results: Signal[];
}

const TOP_N = 6; // shown by default; the rest sit behind "view full radar"

export function EarlyWarningView() {
  const [country, setCountry] = useState("GB");
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState<SevFilter>("all");
  const [showFull, setShowFull] = useState(false);

  const [pulse, setPulse] = useState<string | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [alerted, setAlerted] = useState<Set<string>>(new Set());

  // Resolve the market from the cookie (the sidebar country picker sets it).
  useEffect(() => {
    const m =
      typeof document !== "undefined"
        ? document.cookie.match(/(?:^|; )mederti-country=([A-Za-z]{2})/)
        : null;
    if (m) setCountry(m[1].toUpperCase());
  }, []);

  // Live predictive signals — drugs short in peer markets but not yet here.
  useEffect(() => {
    let cancelled = false;
    setSignalsLoading(true);
    fetch(`/api/predictive-signals?country=${country}&limit=60`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SignalsResponse | null) => {
        if (cancelled) return;
        setSignals(d && Array.isArray(d.results) ? d : null);
        setSignalsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSignals(null);
          setSignalsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

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

  const toggleAlert = (id: string) => {
    setAlerted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("ew-prealerts", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const countryName = COUNTRY_NAMES[country] ?? country;
  // Display hygiene: drop unresolved/concatenated combination entities (the
  // drugs table holds a few multi-drug strings) so the radar reads clean.
  const allResults = useMemo(
    () =>
      (signals?.results ?? []).filter((r) => {
        const name = r.drug_name || "";
        const commas = (name.match(/,/g) || []).length;
        return name && name !== "Unknown" && name.length <= 48 && commas < 2;
      }),
    [signals],
  );

  // The toggle is a severity filter — All / High+ / Critical. (A forecast
  // "horizon" has no meaning for leading-indicator data, so this is the honest
  // axis that keeps the same narrowing behaviour.)
  const sevFiltered = useMemo(
    () =>
      allResults.filter((r) => {
        if (sevFilter === "all") return true;
        if (sevFilter === "high") return (SEV_RANK[r.worst_severity] ?? 0) >= 3;
        return r.worst_severity === "critical";
      }),
    [allResults, sevFilter],
  );
  const topRows = sevFiltered.slice(0, TOP_N);
  const extraRows = sevFiltered.slice(TOP_N);

  // Headline KPIs — all measured from the response.
  const flaggedCount = signals?.total_candidates ?? allResults.length;
  const concessionCount =
    signals?.concession_candidates ??
    allResults.filter((r) => r.concession_local).length;
  const whoCount = allResults.filter((r) => r.who_essential).length;
  const critCount = allResults.filter((r) => r.worst_severity === "critical").length;

  // Bottom panels, also derived from the response.
  const topMarkets = useMemo(() => {
    const freq = new Map<string, number>();
    for (const r of allResults)
      for (const c of r.peers) freq.set(c, (freq.get(c) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [allResults]);
  const marketMax = topMarkets.length ? topMarkets[0][1] : 1;

  const sevMix = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const r of allResults) c[r.worst_severity] = (c[r.worst_severity] ?? 0) + 1;
    return c;
  }, [allResults]);
  const sevTotal = allResults.length || 1;

  const isEmpty = !signalsLoading && allResults.length === 0;

  const renderRow = (r: Signal) => {
    const sev = SEV[r.worst_severity] ?? SEV.low;
    const tone =
      r.worst_severity === "critical"
        ? "crit"
        : r.worst_severity === "high"
          ? "high"
          : "";
    return (
      <div className={tone ? `rad-row ${tone}` : "rad-row"} key={r.drug_id}>
        <div className="rad-drug">
          <span className="rad-drug-name">
            <Link href={`/drugs/${r.drug_id}`} className="rad-drug-link">
              {r.drug_name}
            </Link>
            {r.who_essential && (
              <span className="who-star" title="WHO essential medicine">
                ★
              </span>
            )}
          </span>
          {r.concession_local && (
            <span className="rad-cls">live {country} price concession</span>
          )}
        </div>
        <div className="rad-flags">
          {r.peers.slice(0, 8).map((c) => FLAGS[c] ?? c).join(" ")}
          {r.peers.length > 8 && (
            <span className="rad-more"> +{r.peers.length - 8}</span>
          )}
        </div>
        <div className="rad-mkts">{r.peer_count}</div>
        <div className="rad-sev">
          <span
            className="sev-badge"
            style={{ color: sev.color, background: sev.bg }}
          >
            {sev.label}
          </span>
        </div>
        <div className="rad-lead">{fmtDur(r.days_lead)}</div>
        <div className="rad-act">
          <button
            className={alerted.has(r.drug_id) ? "rad-btn on" : "rad-btn"}
            onClick={() => toggleAlert(r.drug_id)}
          >
            {alerted.has(r.drug_id) ? "✓ Alerted" : "Pre-alert"}
          </button>
        </div>
      </div>
    );
  };

  // Export brief — a markdown snapshot of the current (filtered) signal set.
  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      "# Mederti Intelligence — Cross-border early-warning brief",
      "",
      `Market: ${countryName}`,
      `Generated: ${today}`,
      "",
    ];
    if (pulse) lines.push("## Market read", pulse, "");
    lines.push(
      `## Short in peer markets, not yet in ${countryName} (${flaggedCount})`,
      "A drug short in several peer markets at once usually signals an upstream (API or finished-dose) cause that crosses borders, typically reaching the remaining markets within 60–90 days.",
      "",
      "| Drug | Peer markets short | Peers | Worst severity | Peer lead |",
      "|---|---|---|---|---|",
      ...sevFiltered.map(
        (r) =>
          `| ${r.drug_name}${r.who_essential ? " (WHO essential)" : ""} | ${r.peers.join(", ")} | ${r.peer_count} | ${r.worst_severity} | ${r.days_lead != null ? r.days_lead + "d" : "—"} |`,
      ),
      "",
      `Severity filter: ${sevFilter === "all" ? "all" : sevFilter === "high" ? "high + critical" : "critical only"}.`,
      "",
      "Source: Mederti predictive signals — drugs short in peer markets ahead of local declaration. Not medical advice.",
    );

    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mederti-early-warning-${country}-${today}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const SEV_TABS: Array<[SevFilter, string]> = [
    ["all", "All"],
    ["high", "High+"],
    ["critical", "Critical"],
  ];

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
        .ewradar .gov-sub{font-size:12px;color:var(--text-3);margin-top:5px;max-width:560px}
        .ewradar .gov-head-r{display:flex;align-items:center;gap:12px}
        .ewradar .gov-range{display:flex;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:2px}
        .ewradar .gr-opt{font-size:12px;padding:5px 11px;border-radius:6px;color:var(--text-3);cursor:pointer}
        .ewradar .gr-opt.on{background:#fff;color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
        .ewradar .gov-report-btn{font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:8px;background:var(--teal);color:#fff;border:none;cursor:pointer;white-space:nowrap}
        .ewradar .gov-report-btn:hover{background:var(--teal-l)}
        .ewradar .gov-report-btn:disabled{opacity:.5;cursor:default}

        .ewradar .gov-scroll{padding:18px 28px 32px;background:#f4f5f7}

        /* analyst read */
        .ewradar .ew-brief{background:#fff;border:1px solid var(--border);border-radius:11px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06)}
        .ewradar .ew-brief-head{display:flex;align-items:center;gap:9px;margin-bottom:7px}
        .ewradar .ew-brief-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--teal)}
        .ewradar .ew-brief-ai{font-size:10px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .ew-brief-text{font-size:13.5px;line-height:1.6;color:var(--text-2)}
        .ewradar .ew-brief-skel{height:12px;border-radius:5px;background:linear-gradient(90deg,var(--bg-2),var(--bg-3),var(--bg-2));background-size:200% 100%;animation:ewsk 1.4s ease-in-out infinite;margin-bottom:8px}
        .ewradar .ew-brief-skel:last-child{margin-bottom:0}
        @keyframes ewsk{0%{background-position:200% 0}100%{background-position:-200% 0}}

        .ewradar .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px}
        .ewradar .kpi{background:#fff;border:1px solid var(--border);border-radius:11px;padding:15px 16px;display:flex;flex-direction:column}
        .ewradar .kpi.crit{border-color:var(--crit-b)}
        .ewradar .kpi.good{border-color:var(--low-b)}
        .ewradar .kpi-label{font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-4);margin-bottom:0;font-weight:600}
        .ewradar .kpi-val{order:-1;font-size:27px;font-weight:600;letter-spacing:-0.02em;color:var(--text);line-height:1;margin-bottom:8px}
        .ewradar .kpi-of{font-size:14px;color:var(--text-4);font-weight:500}
        .ewradar .kpi-delta{font-size:10.5px;margin-top:7px;color:var(--text-4)}

        .ewradar .gov-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
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
        .ewradar .rad-h,.ewradar .rad-row{display:grid;grid-template-columns:1.7fr 1.8fr 0.7fr 1fr 0.8fr 0.9fr;gap:10px;align-items:center}
        .ewradar .rad-h{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-4);font-weight:600;padding:0 8px 9px;border-bottom:1px solid var(--border)}
        .ewradar .rad-row{padding:12px 8px;border-bottom:1px solid var(--bg-3)}
        .ewradar .rad-row.crit{background:var(--crit-bg)}
        .ewradar .rad-row.high{background:var(--high-bg)}
        .ewradar .rad-drug{font-weight:600;color:var(--text);display:flex;flex-direction:column;gap:2px;min-width:0}
        .ewradar .rad-drug-name{display:flex;align-items:center;min-width:0}
        .ewradar .rad-drug-link{color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .ewradar .rad-drug-link:hover{color:var(--teal);text-decoration:underline}
        .ewradar .who-star{color:var(--teal);font-size:11px;margin-left:5px;flex-shrink:0}
        .ewradar .rad-cls{font-weight:500;font-size:10px;color:var(--med);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ewradar .rad-flags{font-size:14px;letter-spacing:1px;line-height:1.2}
        .ewradar .rad-more{font-size:10.5px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;letter-spacing:0}
        .ewradar .rad-mkts,.ewradar .rad-lead{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:12px;color:var(--text-2)}
        .ewradar .sev-badge{font-size:10px;font-weight:700;letter-spacing:0.03em;padding:3px 8px;border-radius:5px;text-transform:uppercase;display:inline-block}
        .ewradar .rad-btn{font-size:11px;font-weight:600;padding:6px 12px;border-radius:7px;background:#fff;border:1px solid var(--border-2);color:var(--text-2);cursor:pointer;white-space:nowrap}
        .ewradar .rad-btn:hover{border-color:var(--teal);color:var(--teal)}
        .ewradar .rad-btn.on{background:var(--teal);border-color:var(--teal);color:#fff}
        .ewradar .rad-btn.on:hover{background:var(--teal-l);border-color:var(--teal-l);color:#fff}

        .ewradar .rad-skel{height:16px;border-radius:5px;background:linear-gradient(90deg,var(--bg-2),var(--bg-3),var(--bg-2));background-size:200% 100%;animation:ewsk 1.4s ease-in-out infinite;margin:16px 8px}
        .ewradar .rad-empty{padding:30px 8px;text-align:center;color:var(--text-3);font-size:12.5px;line-height:1.6}
        .ewradar .rad-empty strong{color:var(--text);font-weight:600}

        /* markets-driving list */
        .ewradar .mkt{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bg-3);font-size:12.5px}
        .ewradar .mkt:last-child{border-bottom:none}
        .ewradar .mkt-flag{font-size:16px;width:20px;text-align:center}
        .ewradar .mkt-name{color:var(--text);font-weight:500;min-width:118px}
        .ewradar .mkt-bar{flex:1;height:6px;border-radius:3px;background:var(--bg-3);overflow:hidden}
        .ewradar .mkt-bar i{display:block;height:100%;background:var(--teal)}
        .ewradar .mkt-n{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--text-3);min-width:54px;text-align:right}

        /* signal mix */
        .ewradar .calib-big{text-align:center;padding:6px 0 14px;border-bottom:1px solid var(--bg-3);margin-bottom:14px}
        .ewradar .calib-n{font-size:38px;font-weight:600;color:var(--teal);letter-spacing:-0.02em;line-height:1}
        .ewradar .calib-l{font-size:11px;color:var(--text-3);margin-top:5px}
        .ewradar .calib-rows{display:flex;flex-direction:column;gap:10px}
        .ewradar .calib-row{display:grid;grid-template-columns:1.3fr 2fr 54px;gap:9px;align-items:center;font-size:12px;color:var(--text-2)}
        .ewradar .calib-bar{height:7px;border-radius:4px;background:var(--bg-3);overflow:hidden}
        .ewradar .calib-bar i{display:block;height:100%}
        .ewradar .calib-pct{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--text-2);text-align:right}
        .ewradar .peer-note{font-size:11.5px;color:var(--text-3);margin-top:12px;padding-top:11px;border-top:1px solid var(--bg-3);line-height:1.55}
      `}</style>

      <div className="gov-head">
        <div className="gov-head-l">
          <div className="gov-crumb">
            Predictive layer · {FLAGS[country] ?? ""} {country}
          </div>
          <h1 className="gov-title">Intelligence</h1>
          <div className="gov-sub">
            Drugs short in peer markets but not yet in {countryName} — a shortage
            in several markets at once usually means an upstream cause that
            reaches the rest within 60–90 days.
          </div>
        </div>
        <div className="gov-head-r">
          <div className="gov-range">
            {SEV_TABS.map(([key, label]) => (
              <span
                key={key}
                className={sevFilter === key ? "gr-opt on" : "gr-opt"}
                onClick={() => setSevFilter(key)}
              >
                {label}
              </span>
            ))}
          </div>
          <button
            className="gov-report-btn"
            onClick={handleExport}
            disabled={isEmpty}
          >
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

        {/* PREDICTIVE KPI STRIP — all measured from the response */}
        <div className="kpi-row">
          <div className="kpi crit">
            <div className="kpi-label">Short in peers, not yet here</div>
            <div className="kpi-val">{signalsLoading ? "—" : flaggedCount}</div>
            <div className="kpi-delta">
              across {signals?.peer_set?.length ?? "—"} peer markets
            </div>
          </div>
          <div className="kpi crit">
            <div className="kpi-label">Critical severity</div>
            <div className="kpi-val">{signalsLoading ? "—" : critCount}</div>
            <div className="kpi-delta">worst-case in peer markets</div>
          </div>
          <div className="kpi good">
            <div className="kpi-label">WHO essential affected</div>
            <div className="kpi-val">{signalsLoading ? "—" : whoCount}</div>
            <div className="kpi-delta">on the WHO essential-medicines list</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Under price concession</div>
            <div className="kpi-val">{signalsLoading ? "—" : concessionCount}</div>
            <div className="kpi-delta">local price pressure already</div>
          </div>
        </div>

        {/* EARLY-WARNING RADAR (the moat) */}
        <div className="gov-card span2 moat-card">
          <div className="gc-head">
            <div className="gc-title">
              Early-warning radar <span className="gc-badge">moat</span>
            </div>
            <div className="gc-meta">
              short in peer markets, not yet declared in {country} · ranked by
              severity × peer breadth
            </div>
          </div>
          <div className="radar">
            <div className="rad-h">
              <span>Drug</span>
              <span>Markets short</span>
              <span>Peers</span>
              <span>Severity</span>
              <span>Short for</span>
              <span></span>
            </div>
            {signalsLoading ? (
              [0, 1, 2, 3, 4].map((i) => <div className="rad-skel" key={i}></div>)
            ) : isEmpty ? (
              <div className="rad-empty">
                <strong>No cross-border signals for {countryName} right now.</strong>
                <br />
                A drug appears here once it&apos;s short in several peer markets
                but not yet listed in {countryName}.
              </div>
            ) : (
              <>
                {topRows.map(renderRow)}
                {showFull && extraRows.map(renderRow)}
              </>
            )}
          </div>
          {!signalsLoading && !isEmpty && extraRows.length > 0 && (
            <div className="em-foot">
              {showFull ? (
                <>
                  Showing all {sevFiltered.length} ·{" "}
                  <span className="em-link" onClick={() => setShowFull(false)}>
                    collapse ↑
                  </span>
                </>
              ) : (
                <>
                  + {extraRows.length} more flagged for {country} ·{" "}
                  <span className="em-link" onClick={() => setShowFull(true)}>
                    view full radar →
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* MARKETS DRIVING SIGNALS + SIGNAL MIX */}
        <div className="gov-grid">
          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">Markets driving the signals</div>
              <div className="gc-meta">peer markets short most often</div>
            </div>
            {signalsLoading ? (
              <div className="rad-skel"></div>
            ) : topMarkets.length === 0 ? (
              <div className="rad-empty">No peer-market signals yet.</div>
            ) : (
              <div>
                {topMarkets.map(([code, n]) => (
                  <div className="mkt" key={code}>
                    <span className="mkt-flag">{FLAGS[code] ?? "•"}</span>
                    <span className="mkt-name">
                      {COUNTRY_NAMES[code] ?? code}
                    </span>
                    <span className="mkt-bar">
                      <i style={{ width: `${(n / marketMax) * 100}%` }}></i>
                    </span>
                    <span className="mkt-n">{n} drugs</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="gov-card">
            <div className="gc-head">
              <div className="gc-title">Signal mix</div>
              <div className="gc-meta">flagged drugs by worst severity</div>
            </div>
            <div className="calib-big">
              <div className="calib-n">{signalsLoading ? "—" : flaggedCount}</div>
              <div className="calib-l">
                drugs short in peer markets, not yet in {countryName}
              </div>
            </div>
            <div className="calib-rows">
              {(["critical", "high", "medium", "low"] as const).map((k) => {
                const n = sevMix[k] ?? 0;
                const pct = Math.round((n / sevTotal) * 100);
                return (
                  <div className="calib-row" key={k}>
                    <span style={{ textTransform: "capitalize" }}>{k}</span>
                    <span className="calib-bar">
                      <i
                        style={{
                          width: `${pct}%`,
                          background: (SEV[k] ?? SEV.low).color,
                        }}
                      ></i>
                    </span>
                    <span className="calib-pct">
                      {n} · {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="peer-note">
              When a drug is short in three or more peer markets at once, the
              cause is usually upstream — an API or finished-dose failure that
              crosses borders before it reaches {countryName}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
