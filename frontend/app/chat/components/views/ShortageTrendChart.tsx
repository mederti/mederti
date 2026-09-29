"use client";

import { useEffect, useMemo, useState } from "react";
import { scaleLinear, line as d3line, curveMonotoneX, max as d3max } from "d3";

/**
 * ShortageTrendChart — a self-contained combo chart of how shortages have
 * changed over time and what is coming, for one market or one drug.
 *
 *   bars   new shortages declared each period (solid) → anticipated onsets in
 *          future periods (dashed/hollow, a real regulator-published signal)
 *   line   active total open at each past period-end (the running level)
 *
 * A stock-chart style range selector (1M … MAX) re-queries the API, which
 * picks the bucket size (week / month / quarter) to suit the range. Hovering
 * shows a crosshair with that period's numbers.
 *
 * A vertical "now" divider separates observed history (left) from anticipated
 * (right). Fully self-styled so it drops into the dashboard, the intelligence
 * card or a drug page without inheriting their palettes.
 *
 * Reads /api/insights/shortage-trends?country=…|drug_id=…&range=…
 */

interface Bucket {
  month: string;
  label: string;
  future: boolean;
  current: boolean;
  onsets: number | null;
  resolved: number | null;
  active: number | null;
  anticipated: number | null;
}
type Grain = "week" | "month" | "quarter";
interface TrendsResponse {
  country: string;
  all_markets: boolean;
  degraded?: boolean;
  partial?: boolean;
  generated: string;
  grain?: Grain;
  months: Bucket[];
}

export type TrendRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "MAX";
const RANGES: TrendRange[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"];
const RANGE_PHRASE: Record<TrendRange, string> = {
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  YTD: "year to date",
  "1Y": "past year",
  "3Y": "past 3 years",
  "5Y": "past 5 years",
  MAX: "all recorded history",
};
const GRAIN_NOUN: Record<Grain, string> = { week: "week", month: "month", quarter: "quarter" };

// SVG geometry (viewBox units; the element scales to 100% container width).
const W = 720;
const H = 240;
const PAD = { top: 16, right: 40, bottom: 34, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const GRID_N = 4;

const fmt = (n: number) => n.toLocaleString("en-US");

// Smallest GRID_N × step ≥ max: any whole step up to 10, else a whole
// 1/2/2.5/5 × 10^k.
function gridTop(max: number): number {
  const raw = Math.max(max, 1) / GRID_N;
  if (raw <= 10) return Math.ceil(raw) * GRID_N;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= raw && Number.isInteger(c)) ?? Math.ceil(raw);
  return Math.max(step, 1) * GRID_N;
}

export function ShortageTrendChart({
  country,
  drugId,
  defaultRange = "1Y",
}: {
  country?: string;
  drugId?: string;
  defaultRange?: TrendRange;
}) {
  const [range, setRange] = useState<TrendRange>(defaultRange);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);

  const isDrug = !!drugId;
  const activeNoun = isDrug ? "open shortage notices" : "active shortages";

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setHover(null);
    const qs = new URLSearchParams({ range });
    if (drugId) qs.set("drug_id", drugId);
    if (country) qs.set("country", country);
    fetch(`/api/insights/shortage-trends?${qs}`)
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
  }, [country, drugId, range]);

  const geom = useMemo(() => {
    if (!data) return null;
    const rows = data.months;
    const n = rows.length;
    if (n === 0) return null;

    // Bar value per period: onsets in the past, anticipated in the future.
    const barVal = (b: Bucket) => (b.future ? (b.anticipated ?? 0) : (b.onsets ?? 0));
    const yBarMax = Math.max(d3max(rows, barVal) ?? 0, 1);
    const yLineMax = Math.max(d3max(rows, (b) => b.active ?? 0) ?? 0, 1);

    const step = PLOT_W / n;
    const barW = Math.max(Math.min(step * 0.62, 34), 1);
    const xCenter = (i: number) => PAD.left + step * (i + 0.5);

    // Two scales, two axes: bars on the left, the active line on the right.
    // Both share GRID_N gridlines, so each domain top is GRID_N × a round,
    // whole-number step (counts are integers — no "3, 5, 8" ticks).
    const yBar = scaleLinear().domain([0, gridTop(yBarMax)]).range([PAD.top + PLOT_H, PAD.top]);
    const yLine = scaleLinear().domain([0, gridTop(yLineMax)]).range([PAD.top + PLOT_H, PAD.top]);

    const bars = rows.map((b, i) => {
      const v = barVal(b);
      const y = yBar(v);
      return { i, x: xCenter(i) - barW / 2, y, w: barW, h: PAD.top + PLOT_H - y, v, future: b.future };
    });

    // Active-total line — past periods only (a stock we can't project forward
    // without assumptions we deliberately don't make).
    const past = rows.map((b, i) => ({ b, i })).filter(({ b }) => !b.future && b.active != null);
    const linePts: [number, number][] = past.map(({ b, i }) => [xCenter(i), yLine(b.active as number)]);
    const path =
      linePts.length > 1
        ? d3line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX)(linePts) ?? ""
        : "";
    // Dots only while they read as points, not a bead string.
    const activeDots = n <= 26 ? past.map(({ b, i }) => ({ cx: xCenter(i), cy: yLine(b.active as number), i })) : [];

    // "Now" divider sits between the last past period and the first future one.
    const firstFuture = rows.findIndex((b) => b.future);
    const nowX = firstFuture > 0 ? PAD.left + step * firstFuture : null;

    // Shared gridlines: same fractions on both scales so the right-axis labels
    // sit on the left-axis gridlines.
    const grid = Array.from({ length: GRID_N + 1 }, (_, k) => {
      const f = k / GRID_N;
      return {
        y: PAD.top + PLOT_H - f * PLOT_H,
        left: yBar.domain()[1] * f,
        right: yLine.domain()[1] * f,
      };
    });

    // X labels: at most ~8, evenly spaced.
    const every = Math.max(1, Math.ceil(n / 8));

    // Change over the window, like a stock quote: first vs last past period.
    const firstActive = past[0]?.b.active ?? 0;
    const lastActive = past[past.length - 1]?.b.active ?? 0;
    const anticipatedAhead = rows.reduce((s, b) => s + (b.future ? (b.anticipated ?? 0) : 0), 0);

    const hasFuture = anticipatedAhead > 0;
    const hasAny = rows.some((b) => barVal(b) > 0 || (b.active ?? 0) > 0);

    return { rows, bars, path, activeDots, nowX, grid, step, every, hasFuture, hasAny, firstActive, lastActive };
  }, [data]);

  const grain: Grain = data?.grain ?? "month";
  const delta = geom ? geom.lastActive - geom.firstActive : 0;
  // A % change off a tiny base ("+2300%" from 1) is noise, not signal.
  const pct = geom && geom.firstActive >= 10 ? Math.round((delta / geom.firstActive) * 100) : null;
  const longRange = range === "3Y" || range === "5Y" || range === "MAX";

  const hovered = geom && hover != null ? geom.rows[hover] : null;
  const hoverX = geom && hover != null ? PAD.left + geom.step * (hover + 0.5) : 0;

  return (
    <div className="strend">
      <style>{`
        .strend{--t:#0fa676;--t-l:#0c8a62;--t-fill:rgba(15,166,118,.14);--line:#0c1118;
          --ax:#98a1ac;--grid:#eef2f5;--fut:#6366f1;--fut-bg:rgba(99,102,241,.10);--up:#c2410c;--down:#0c8a62}
        .strend .st-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 16px;margin-bottom:10px}
        .strend .st-quote{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-height:30px}
        .strend .st-big{font-size:24px;font-weight:600;letter-spacing:-.02em;color:var(--line);font-variant-numeric:tabular-nums}
        .strend .st-bigl{font-size:11px;color:#6a7280}
        .strend .st-chg{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
        .strend .st-chg.up{color:var(--up)} .strend .st-chg.down{color:var(--down)} .strend .st-chg.flat{color:#6a7280}
        .strend .st-chg small{font-weight:400;color:#98a1ac;margin-left:4px}
        .strend .st-ranges{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:8px;background:#f3f5f7}
        .strend .st-rng{appearance:none;border:0;background:transparent;font-size:11px;font-weight:600;
          color:#6a7280;padding:4px 8px;border-radius:6px;cursor:pointer;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .strend .st-rng:hover{color:var(--line)}
        .strend .st-rng[aria-pressed="true"]{background:#fff;color:var(--line);box-shadow:0 1px 2px rgba(12,17,24,.08)}
        .strend .st-rng:focus-visible{outline:2px solid var(--t);outline-offset:1px}
        .strend .st-empty .st-rng{background:#f3f5f7;color:var(--line)}
        .strend .st-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:6px;font-size:11px;color:#6a7280}
        .strend .st-key{display:inline-flex;align-items:center;gap:6px}
        .strend .st-sw{width:12px;height:12px;border-radius:3px;flex-shrink:0}
        .strend .st-sw.line{width:16px;height:0;border-top:2.5px solid var(--line);border-radius:0}
        .strend .st-sw.fut{background:transparent;border:1.5px dashed var(--fut)}
        .strend .st-plot{position:relative}
        .strend .st-svg{width:100%;height:auto;display:block;touch-action:pan-y}
        .strend .st-bar{fill:var(--t);opacity:.85}
        .strend .st-bar.dim{opacity:.35}
        .strend .st-bar.fut{fill:var(--fut-bg);stroke:var(--fut);stroke-width:1.25;stroke-dasharray:3 2;opacity:1}
        .strend .st-line{fill:none;stroke:var(--line);stroke-width:2.25}
        .strend .st-dot{fill:#fff;stroke:var(--line);stroke-width:1.75}
        .strend .st-grid{stroke:var(--grid);stroke-width:1}
        .strend .st-axtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace}
        .strend .st-axtitle{fill:var(--ax);font-size:8.5px;text-transform:uppercase;letter-spacing:.06em}
        .strend .st-xtext{fill:var(--ax);font-size:9.5px;font-family:var(--font-geist-mono),ui-monospace,monospace;text-anchor:middle}
        .strend .st-now{stroke:var(--fut);stroke-width:1;stroke-dasharray:3 3;opacity:.7}
        .strend .st-nowlab{fill:var(--fut);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .strend .st-cross{stroke:#c3cad2;stroke-width:1}
        .strend .st-tip{position:absolute;top:4px;pointer-events:none;background:#0c1118;color:#fff;border-radius:8px;
          padding:8px 10px;font-size:11px;line-height:1.55;white-space:nowrap;box-shadow:0 4px 14px rgba(12,17,24,.18);z-index:2}
        .strend .st-tip b{font-weight:600}
        .strend .st-tip .k{color:#aab3bd;margin-right:6px}
        .strend .st-tip .fut{color:#a5b4fc}
        .strend .st-skel{height:200px;border-radius:8px;background:linear-gradient(90deg,#eef2f5 25%,#f6f8fa 50%,#eef2f5 75%);background-size:200% 100%;animation:stsk 1.3s ease-in-out infinite}
        @keyframes stsk{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .strend .st-empty{padding:34px 8px;text-align:center;color:#6a7280;font-size:12px;line-height:1.6}
        .strend .st-cap{font-size:11px;color:#98a1ac;margin-top:8px;line-height:1.5}
      `}</style>

      <div className="st-top">
        <div className="st-quote" aria-live="polite">
          {state === "ready" && geom && geom.hasAny && (
            <>
              <span className="st-big">{fmt(geom.lastActive)}</span>
              <span className="st-bigl">{activeNoun} now</span>
              <span className={`st-chg ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
                {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : ""}
                {fmt(delta)}
                {pct != null && ` (${delta > 0 ? "+" : ""}${pct}%)`}
                <small>{RANGE_PHRASE[range]}</small>
              </span>
            </>
          )}
        </div>
        <div className="st-ranges" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} type="button" className="st-rng" aria-pressed={r === range} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && <div className="st-skel" aria-busy="true" aria-label="Loading shortage trend" />}

      {state === "error" && (
        <div className="st-empty">Trend data isn&apos;t available for this {isDrug ? "medicine" : "market"} right now.</div>
      )}

      {state === "ready" && geom && !geom.hasAny && (
        <div className="st-empty">
          No shortage history recorded for this {isDrug ? "medicine" : "market"} in the {RANGE_PHRASE[range]}.
          {range !== "MAX" && (
            <>
              {" "}
              <button type="button" className="st-rng" onClick={() => setRange("MAX")}>
                Show all history
              </button>
            </>
          )}
        </div>
      )}

      {state === "ready" && geom && geom.hasAny && (
        <>
          <div className="st-legend">
            <span className="st-key"><span className="st-sw" style={{ background: "var(--t)" }} /> New shortages declared (left axis)</span>
            {geom.hasFuture && (
              <span className="st-key"><span className="st-sw fut" /> Anticipated (upcoming)</span>
            )}
            <span className="st-key"><span className="st-sw line" /> {isDrug ? "Open notices" : "Active total"} (right axis)</span>
          </div>

          <div className="st-plot" onMouseLeave={() => setHover(null)}>
            <svg
              className="st-svg"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Shortage trend, ${RANGE_PHRASE[range]}`}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * W;
                const i = Math.floor((x - PAD.left) / geom.step);
                setHover(i >= 0 && i < geom.rows.length ? i : null);
              }}
            >
              {/* Gridlines + dual y labels */}
              {geom.grid.map((g, k) => (
                <g key={k}>
                  <line className="st-grid" x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} />
                  <text className="st-axtext" x={PAD.left - 5} y={g.y + 3} textAnchor="end">
                    {fmt(g.left)}
                  </text>
                  <text className="st-axtext" x={W - PAD.right + 5} y={g.y + 3} textAnchor="start">
                    {fmt(g.right)}
                  </text>
                </g>
              ))}
              <text className="st-axtitle" x={PAD.left - 5} y={PAD.top - 6} textAnchor="end">New</text>
              <text className="st-axtitle" x={W - PAD.right + 5} y={PAD.top - 6} textAnchor="start">Active</text>

              {/* Hover crosshair (behind the marks) */}
              {hovered && <line className="st-cross" x1={hoverX} y1={PAD.top} x2={hoverX} y2={PAD.top + PLOT_H} />}

              {/* Bars: new (past) / anticipated (future) */}
              {geom.bars.map((b) =>
                b.h > 0 ? (
                  <rect
                    key={b.i}
                    className={b.future ? "st-bar fut" : hover != null && hover !== b.i ? "st-bar dim" : "st-bar"}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    rx={b.w > 4 ? 2 : 0}
                  />
                ) : null,
              )}

              {/* Active-total line + dots (past) */}
              {geom.path && <path className="st-line" d={geom.path} />}
              {geom.activeDots.map((d) => (
                <circle key={d.i} className="st-dot" cx={d.cx} cy={d.cy} r={hover === d.i ? 4 : 2.75} />
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

              {/* X labels, thinned to ~8 */}
              {geom.rows.map((b, i) =>
                i % geom.every === 0 ? (
                  <text key={b.month} className="st-xtext" x={PAD.left + geom.step * (i + 0.5)} y={H - 12}>
                    {b.label}
                  </text>
                ) : null,
              )}
            </svg>

            {hovered && (
              <div
                className="st-tip"
                style={
                  hoverX / W > 0.6
                    ? { right: `${(1 - hoverX / W) * 100}%`, marginRight: 10 }
                    : { left: `${(hoverX / W) * 100}%`, marginLeft: 10 }
                }
              >
                <div>
                  <b>
                    {grain === "week" ? `Week of ${hovered.label}` : hovered.label}
                    {hovered.current ? " (so far)" : ""}
                  </b>
                </div>
                {hovered.future ? (
                  <div className="fut">
                    <span className="k">Anticipated</span>
                    {fmt(hovered.anticipated ?? 0)}
                  </div>
                ) : (
                  <>
                    <div><span className="k">New</span>{fmt(hovered.onsets ?? 0)}</div>
                    <div><span className="k">Resolved</span>{fmt(hovered.resolved ?? 0)}</div>
                    <div><span className="k">{isDrug ? "Open at end" : "Active at end"}</span>{fmt(hovered.active ?? 0)}</div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="st-cap">
            Bars: shortages newly declared each {GRAIN_NOUN[grain]}
            {geom.hasFuture && (
              <>
                , continuing into regulator-published{" "}
                <span style={{ color: "var(--fut)", fontWeight: 600 }}>anticipated</span> onsets ahead
              </>
            )}
            . Line: total {isDrug ? "open notices across all markets" : "active"} at each {GRAIN_NOUN[grain]}-end.
            {geom.hasFuture && " Anticipated figures are published forward signals, not a forecast."}
            {longRange && (
              <>
                {" "}
                <span style={{ color: "#6a7280" }}>
                  Longer ranges also reflect Mederti&apos;s coverage growing — some regulators only publish current
                  shortages, and newer sources date a shortage from when we first saw it — so early years undercount.
                </span>
              </>
            )}
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
