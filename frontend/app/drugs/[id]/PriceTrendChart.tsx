"use client";

import { useEffect, useMemo, useState } from "react";
import { scaleLinear, line as d3line, area as d3area, curveMonotoneX } from "d3";

/**
 * PriceTrendChart — historical reimbursement price for one drug/market, plus a
 * gated Holt forecast. Same visual grammar as ShortageTrendChart: observed
 * history left of a "Now" divider, projection to the right.
 *
 *   line (solid)   monthly price history (representative strength)
 *   line (dashed)  central forecast, shown ONLY when the series passed the
 *                  backtest gate (see /api/insights/price-trends)
 *   band           80% prediction interval around the forecast
 *   dots (amber)   price concessions — regulator signals tied to shortage
 *
 * Reads /api/insights/price-trends?drug_id=…&country=…
 */

interface HistPoint { month: string; label: string; value: number; observed: boolean }
interface FcPoint { month: string; label: string; mid: number; lo: number; hi: number }
interface Concession { month: string; label: string; price: number }
interface TrendResponse {
  available: boolean;
  reason?: string;
  strength: string | null;
  pack: string | null;
  price_type_label: string;
  currency: string;
  source: string | null;
  history: HistPoint[];
  forecast: { eligible: boolean; reason: string | null; mapePct: number | null; points: FcPoint[] } | null;
  concessions: Concession[];
}

const W = 720;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const CCY: Record<string, string> = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$", NZD: "NZ$" };
function money(v: number, cy: string): string {
  const sym = CCY[cy] ?? "";
  return `${sym}${v < 1 ? v.toFixed(2) : v.toFixed(2)}`;
}

export function PriceTrendChart({
  drugId,
  country,
  months = 24,
  forward = 6,
}: {
  drugId: string;
  country: string;
  months?: number;
  forward?: number;
}) {
  const [data, setData] = useState<TrendResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/insights/price-trends?drug_id=${encodeURIComponent(drugId)}&country=${encodeURIComponent(country)}&months=${months}&forward=${forward}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrendResponse | null) => {
        if (cancelled) return;
        if (d && d.available && Array.isArray(d.history) && d.history.length >= 2) {
          setData(d);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [drugId, country, months, forward]);

  const geom = useMemo(() => {
    if (!data) return null;
    const hist = data.history;
    const fc = data.forecast?.eligible ? data.forecast.points : [];
    const n = hist.length;
    const total = n + fc.length;
    if (n < 2) return null;

    const allY = [
      ...hist.map((h) => h.value),
      ...fc.map((f) => f.hi),
      ...data.concessions.map((c) => c.price),
    ];
    const maxY = Math.max(...allY, 1) * 1.08;

    const x = scaleLinear().domain([0, total - 1]).range([PAD.left, PAD.left + PLOT_W]);
    const y = scaleLinear().domain([0, maxY]).range([PAD.top + PLOT_H, PAD.top]);

    // History line.
    const histPts: [number, number][] = hist.map((h, i) => [x(i), y(h.value)]);
    const lineGen = d3line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX);
    const histPath = lineGen(histPts) ?? "";

    // Forecast: band + dashed central line, both anchored at the last history pt.
    let bandPath = "";
    let fcPath = "";
    if (fc.length > 0) {
      const anchorX = x(n - 1);
      const anchorY = y(hist[n - 1].value);
      const bandPts = [
        { i: n - 1, lo: hist[n - 1].value, hi: hist[n - 1].value },
        ...fc.map((f, k) => ({ i: n + k, lo: f.lo, hi: f.hi })),
      ];
      bandPath = d3area<{ i: number; lo: number; hi: number }>()
        .x((d) => x(d.i)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX)(bandPts) ?? "";
      const fcPts: [number, number][] = [[anchorX, anchorY], ...fc.map((f, k) => [x(n + k), y(f.mid)] as [number, number])];
      fcPath = lineGen(fcPts) ?? "";
    }

    // Concession markers — place at the matching history month.
    const monthIdx = new Map(hist.map((h, i) => [h.month, i]));
    const concDots = data.concessions
      .map((c) => ({ c, i: monthIdx.get(c.month) }))
      .filter((d): d is { c: Concession; i: number } => d.i != null)
      .map(({ c, i }) => ({ cx: x(i), cy: y(c.price), price: c.price, label: c.label }));

    const nowX = fc.length > 0 ? PAD.left + (PLOT_W / (total - 1)) * (n - 1) + (PLOT_W / (total - 1)) / 2 : null;
    const ticks = y.ticks(4).filter((t) => t <= maxY);
    const step = total > 1 ? PLOT_W / (total - 1) : PLOT_W;

    return { hist, fc, n, total, x, y, histPath, bandPath, fcPath, concDots, nowX, ticks, step, maxY };
  }, [data]);

  const cy = data?.currency ?? "";
  const current = data?.history.at(-1)?.value ?? null;
  const projected = data?.forecast?.eligible ? data.forecast.points.at(-1)?.mid ?? null : null;

  return (
    <div className="ptrend">
      <style>{`
        .ptrend{--t:#0f9e73;--t-l:#0c8a62;--band:rgba(15,158,115,.16);--line:#0f9e73;
          --ax:#98a1ac;--grid:#eef2f5;--now:#0f9e73;--conc:#BA7517;}
        .ptrend .pt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
        .ptrend .pt-title{font-size:15px;font-weight:500;color:#0c1118}
        .ptrend .pt-sub{font-size:12px;color:#6a7280;margin-top:2px}
        .ptrend .pt-chip{display:inline-flex;align-items:center;gap:6px;background:#e6f7f1;color:#0c6e56;font-size:12px;padding:5px 10px;border-radius:8px;white-space:nowrap}
        .ptrend .pt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:12px 0 14px}
        .ptrend .pt-stat{background:#f6f8fa;border-radius:8px;padding:8px 12px}
        .ptrend .pt-stat .k{font-size:11px;color:#98a1ac}
        .ptrend .pt-stat .v{font-size:20px;font-weight:500;color:#0c1118;font-variant-numeric:tabular-nums}
        .ptrend .pt-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:6px;font-size:11px;color:#6a7280}
        .ptrend .pt-key{display:inline-flex;align-items:center;gap:6px}
        .ptrend .pt-sw{width:16px;height:0;border-top:2.5px solid var(--line)}
        .ptrend .pt-sw.dash{border-top:2.5px dashed var(--line)}
        .ptrend .pt-sw.band{width:12px;height:12px;border-radius:3px;border-top:0;background:var(--band)}
        .ptrend .pt-sw.conc{width:10px;height:10px;border-radius:50%;border-top:0;background:var(--conc)}
        .ptrend .pt-svg{width:100%;height:auto;display:block}
        .ptrend .pt-hist{fill:none;stroke:var(--line);stroke-width:2.4;stroke-linejoin:round}
        .ptrend .pt-fc{fill:none;stroke:var(--line);stroke-width:2.2;stroke-dasharray:5 4}
        .ptrend .pt-band{fill:var(--band);stroke:none}
        .ptrend .pt-grid{stroke:var(--grid);stroke-width:1}
        .ptrend .pt-axtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .ptrend .pt-xtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace;text-anchor:middle}
        .ptrend .pt-now{stroke:var(--now);stroke-width:1;stroke-dasharray:3 3;opacity:.7}
        .ptrend .pt-nowlab{fill:var(--now);font-size:9px;font-weight:700;letter-spacing:.06em}
        .ptrend .pt-conc{fill:var(--conc);stroke:#fff;stroke-width:1.5}
        .ptrend .pt-dot{fill:#fff;stroke:var(--line);stroke-width:2}
        .ptrend .pt-skel{height:200px;border-radius:8px;background:linear-gradient(90deg,#eef2f5 25%,#f6f8fa 50%,#eef2f5 75%);background-size:200% 100%;animation:ptsk 1.3s ease-in-out infinite}
        @keyframes ptsk{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .ptrend .pt-empty{padding:28px 8px;text-align:center;color:#6a7280;font-size:12px;line-height:1.6}
        .ptrend .pt-cap{font-size:11px;color:#98a1ac;margin-top:8px;line-height:1.5}
        .ptrend .pt-note{font-size:11px;color:#6a7280;margin-top:8px;line-height:1.5;background:#f6f8fa;border-radius:6px;padding:8px 10px}
      `}</style>

      {state === "loading" && <div className="pt-skel" aria-busy="true" aria-label="Loading price trend" />}

      {state === "error" && (
        <div className="pt-empty">No price history recorded for this market yet.</div>
      )}

      {state === "ready" && data && geom && (
        <>
          <div className="pt-head">
            <div>
              <div className="pt-title">Price trend</div>
              <div className="pt-sub">
                {[data.strength, data.pack ? `pack of ${data.pack.replace(/[^0-9]/g, "") || data.pack}` : null, data.price_type_label]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className="pt-chip">{country} · {data.source ?? "official"}</span>
          </div>

          <div className="pt-stats">
            {current != null && (
              <div className="pt-stat"><div className="k">Latest</div><div className="v">{money(current, cy)}</div></div>
            )}
            {projected != null && (
              <div className="pt-stat">
                <div className="k">{forward}-month projection</div>
                <div className="v" style={{ color: projected > (current ?? 0) ? "#BA7517" : "#0c6e56" }}>
                  {money(projected, cy)} {projected > (current ?? 0) ? "↑" : projected < (current ?? 0) ? "↓" : ""}
                </div>
              </div>
            )}
            {data.forecast?.eligible && data.forecast.mapePct != null && (
              <div className="pt-stat"><div className="k">Backtest error</div><div className="v">MAPE {data.forecast.mapePct.toFixed(1)}%</div></div>
            )}
          </div>

          <div className="pt-legend">
            <span className="pt-key"><span className="pt-sw" /> Price history</span>
            {geom.fc.length > 0 && <span className="pt-key"><span className="pt-sw dash" /> Forecast</span>}
            {geom.fc.length > 0 && <span className="pt-key"><span className="pt-sw band" /> 80% interval</span>}
            {geom.concDots.length > 0 && <span className="pt-key"><span className="pt-sw conc" /> Concession</span>}
          </div>

          <svg className="pt-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Drug price trend over time with forecast">
            {geom.ticks.map((t) => {
              const yy = geom.y(t);
              return (
                <g key={t}>
                  <line className="pt-grid" x1={PAD.left} y1={yy} x2={W - PAD.right} y2={yy} />
                  <text className="pt-axtext" x={PAD.left - 6} y={yy + 3} textAnchor="end">{money(t, cy)}</text>
                </g>
              );
            })}

            {geom.bandPath && <path className="pt-band" d={geom.bandPath} />}
            {geom.histPath && <path className="pt-hist" d={geom.histPath} />}
            {geom.fcPath && <path className="pt-fc" d={geom.fcPath} />}

            {geom.concDots.map((d, i) => (
              <circle key={i} className="pt-conc" cx={d.cx} cy={d.cy} r={4}>
                <title>{d.label}: {money(d.price, cy)} (concession)</title>
              </circle>
            ))}

            <circle className="pt-dot" cx={geom.x(geom.n - 1)} cy={geom.y(geom.hist[geom.n - 1].value)} r={3.2} />

            {geom.nowX != null && (
              <>
                <line className="pt-now" x1={geom.nowX} y1={PAD.top} x2={geom.nowX} y2={PAD.top + PLOT_H} />
                <text className="pt-nowlab" x={geom.nowX + 4} y={PAD.top + 9}>NOW</text>
              </>
            )}

            {(() => {
              const labels: React.ReactElement[] = [];
              const everyN = Math.ceil(geom.total / 8);
              const allLabels = [...geom.hist.map((h) => h.label), ...geom.fc.map((f) => f.label)];
              for (let i = 0; i < geom.total; i += everyN) {
                labels.push(
                  <text key={i} className="pt-xtext" x={geom.x(i)} y={H - 12}>{allLabels[i]}</text>,
                );
              }
              return labels;
            })()}
          </svg>

          <div className="pt-cap">
            Line: monthly {data.price_type_label.toLowerCase()} for {country}
            {data.strength ? ` (${data.strength})` : ""}.
            {data.forecast?.eligible
              ? " Right of Now: Holt exponential-smoothing forecast with an 80% prediction interval, shown because this series passed a rolling backtest."
              : ""}
            {geom.concDots.length > 0 ? " Amber marks price concessions — regulator signals tied to shortage." : ""}
          </div>

          {data.forecast && !data.forecast.eligible && (
            <div className="pt-note">
              Not enough clean history to project this price reliably yet
              {data.forecast.reason ? ` (${data.forecast.reason})` : ""}. Showing observed history only — the forecast appears automatically once the series clears the backtest.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PriceTrendChart;
