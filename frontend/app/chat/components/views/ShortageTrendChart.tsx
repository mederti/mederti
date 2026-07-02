"use client";

import { useEffect, useMemo, useState } from "react";
import { scaleLinear, line as d3line, curveMonotoneX, max as d3max } from "d3";

/**
 * ShortageTrendChart — a self-contained combo chart of how shortages have
 * changed over time and what is coming, for one market.
 *
 *   bars   new shortages declared each month (solid) → anticipated onsets in
 *          future months (dashed/hollow, a real regulator-published signal)
 *   line   active total open at each past month-end (the running level)
 *
 * A vertical "now" divider separates observed history (left) from anticipated
 * (right). Fully self-styled so it drops into either the dashboard or the
 * intelligence card without inheriting their palettes.
 *
 * Reads /api/insights/shortage-trends?country=…
 */

interface MonthBucket {
  month: string;
  label: string;
  future: boolean;
  current: boolean;
  onsets: number | null;
  resolved: number | null;
  active: number | null;
  anticipated: number | null;
}
interface TrendsResponse {
  country: string;
  all_markets: boolean;
  degraded?: boolean;
  partial?: boolean;
  generated: string;
  months: MonthBucket[];
  window?: { past_months: number; forward_months: number };
}

// SVG geometry (viewBox units; the element scales to 100% container width).
const W = 720;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 34, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function ShortageTrendChart({
  country,
  forward = 6,
  months = 12,
}: {
  country: string;
  forward?: number;
  months?: number;
}) {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/insights/shortage-trends?country=${encodeURIComponent(country)}&months=${months}&forward=${forward}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrendsResponse | null) => {
        if (cancelled) return;
        if (d && !d.degraded && Array.isArray(d.months) && d.months.length > 0) {
          setData(d);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [country, months, forward]);

  const geom = useMemo(() => {
    if (!data) return null;
    const rows = data.months;
    const n = rows.length;
    if (n === 0) return null;

    // Bar value per month: onsets in the past, anticipated in the future.
    const barVal = (b: MonthBucket) => (b.future ? (b.anticipated ?? 0) : (b.onsets ?? 0));
    const maxBar = d3max(rows, barVal) ?? 0;
    const maxActive = d3max(rows, (b) => b.active ?? 0) ?? 0;
    const yBarMax = Math.max(maxBar, 1);
    const yLineMax = Math.max(maxActive, 1);

    const step = PLOT_W / n;
    const barW = Math.min(step * 0.6, 34);
    const xCenter = (i: number) => PAD.left + step * (i + 0.5);

    const yBar = scaleLinear().domain([0, yBarMax]).range([PAD.top + PLOT_H, PAD.top]);
    const yLine = scaleLinear().domain([0, yLineMax]).range([PAD.top + PLOT_H, PAD.top]);

    const bars = rows.map((b, i) => {
      const v = barVal(b);
      const y = yBar(v);
      return {
        i,
        x: xCenter(i) - barW / 2,
        y,
        w: barW,
        h: PAD.top + PLOT_H - y,
        v,
        future: b.future,
        label: b.label,
        month: b.month,
      };
    });

    // Active-total line — past months only (a stock we can't project forward
    // without assumptions the user asked us not to make).
    const linePts: [number, number][] = rows
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => !b.future && b.active != null)
      .map(({ b, i }) => [xCenter(i), yLine(b.active as number)]);

    const path =
      linePts.length > 1
        ? d3line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX)(linePts) ?? ""
        : "";

    const activeDots = rows
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => !b.future && b.active != null)
      .map(({ b, i }) => ({ cx: xCenter(i), cy: yLine(b.active as number), v: b.active as number, label: b.label }));

    // "Now" divider sits between the last past month and the first future one.
    const firstFuture = rows.findIndex((b) => b.future);
    const nowX = firstFuture > 0 ? PAD.left + step * firstFuture : null;

    // Y gridlines (based on the active-line scale — the more meaningful axis).
    const ticks = yLine.ticks(4).filter((t) => t <= yLineMax);

    const hasFuture = rows.some((b) => b.future && (b.anticipated ?? 0) > 0);
    const hasAny = rows.some((b) => barVal(b) > 0 || (b.active ?? 0) > 0);

    return { rows, bars, path, activeDots, nowX, ticks, yLine, step, hasFuture, hasAny };
  }, [data]);

  return (
    <div className="strend">
      <style>{`
        .strend{--t:#0fa676;--t-l:#0c8a62;--t-fill:rgba(15,166,118,.14);--line:#0c1118;
          --ax:#98a1ac;--grid:#eef2f5;--fut:#6366f1;--fut-bg:rgba(99,102,241,.10);}
        .strend .st-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:6px;font-size:11px;color:#6a7280}
        .strend .st-key{display:inline-flex;align-items:center;gap:6px}
        .strend .st-sw{width:12px;height:12px;border-radius:3px;flex-shrink:0}
        .strend .st-sw.line{width:16px;height:0;border-top:2.5px solid var(--line);border-radius:0}
        .strend .st-sw.fut{background:transparent;border:1.5px dashed var(--fut)}
        .strend .st-svg{width:100%;height:auto;display:block}
        .strend .st-bar{fill:var(--t);opacity:.85}
        .strend .st-bar.fut{fill:var(--fut-bg);stroke:var(--fut);stroke-width:1.25;stroke-dasharray:3 2}
        .strend .st-line{fill:none;stroke:var(--line);stroke-width:2.25}
        .strend .st-dot{fill:#fff;stroke:var(--line);stroke-width:1.75}
        .strend .st-grid{stroke:var(--grid);stroke-width:1}
        .strend .st-axtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .strend .st-xtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace;text-anchor:middle}
        .strend .st-now{stroke:var(--fut);stroke-width:1;stroke-dasharray:3 3;opacity:.7}
        .strend .st-nowlab{fill:var(--fut);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .strend .st-skel{height:200px;border-radius:8px;background:linear-gradient(90deg,#eef2f5 25%,#f6f8fa 50%,#eef2f5 75%);background-size:200% 100%;animation:stsk 1.3s ease-in-out infinite}
        @keyframes stsk{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .strend .st-empty{padding:34px 8px;text-align:center;color:#6a7280;font-size:12px;line-height:1.6}
        .strend .st-cap{font-size:11px;color:#98a1ac;margin-top:8px;line-height:1.5}
      `}</style>

      {state === "loading" && <div className="st-skel" aria-busy="true" aria-label="Loading shortage trend" />}

      {state === "error" && (
        <div className="st-empty">Trend data isn&apos;t available for this market right now.</div>
      )}

      {state === "ready" && geom && !geom.hasAny && (
        <div className="st-empty">No shortage history recorded for this market yet.</div>
      )}

      {state === "ready" && geom && geom.hasAny && (
        <>
          <div className="st-legend">
            <span className="st-key"><span className="st-sw" style={{ background: "var(--t)" }} /> New shortages declared</span>
            {geom.hasFuture && (
              <span className="st-key"><span className="st-sw fut" /> Anticipated (upcoming)</span>
            )}
            <span className="st-key"><span className="st-sw line" /> Active total</span>
          </div>

          <svg className="st-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Shortage trend over time">
            {/* Y gridlines + labels (active-total scale) */}
            {geom.ticks.map((t) => {
              const y = geom.yLine(t);
              return (
                <g key={t}>
                  <line className="st-grid" x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} />
                  <text className="st-axtext" x={PAD.left - 5} y={y + 3} textAnchor="end">
                    {t}
                  </text>
                </g>
              );
            })}

            {/* Bars: new (past) / anticipated (future) */}
            {geom.bars.map((b) =>
              b.h > 0 ? (
                <rect
                  key={b.i}
                  className={b.future ? "st-bar fut" : "st-bar"}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={2}
                >
                  <title>
                    {b.label}: {b.v} {b.future ? "anticipated" : "new"} shortage{b.v === 1 ? "" : "s"}
                  </title>
                </rect>
              ) : null,
            )}

            {/* Active-total line + dots (past) */}
            {geom.path && <path className="st-line" d={geom.path} />}
            {geom.activeDots.map((d, i) => (
              <circle key={i} className="st-dot" cx={d.cx} cy={d.cy} r={2.75}>
                <title>
                  {d.label}: {d.v} active
                </title>
              </circle>
            ))}

            {/* "Now" divider */}
            {geom.nowX != null && (
              <>
                <line className="st-now" x1={geom.nowX} y1={PAD.top} x2={geom.nowX} y2={PAD.top + PLOT_H} />
                <text className="st-nowlab" x={geom.nowX + 4} y={PAD.top + 9}>
                  Now
                </text>
              </>
            )}

            {/* X labels (every other month to avoid crowding) */}
            {geom.bars.map((b, i) =>
              i % 2 === 0 ? (
                <text key={b.i} className="st-xtext" x={PAD.left + geom.step * (i + 0.5)} y={H - 12}>
                  {b.label}
                </text>
              ) : null,
            )}
          </svg>

          <div className="st-cap">
            Bars: shortages newly declared each month, continuing into regulator-published{" "}
            <span style={{ color: "var(--fut)", fontWeight: 600 }}>anticipated</span> onsets ahead. Line: total active at each
            month-end. Anticipated figures are published forward signals, not a forecast.
            {data?.partial && (
              <>
                {" "}
                <span style={{ color: "#b46708", fontWeight: 600 }}>
                  Counts are provisional — the shortage database is under heavy load and returned partial data.
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
