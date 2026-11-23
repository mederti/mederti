"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { ISO_NUMERIC_TO_ALPHA2 } from "@/lib/geo/country-iso-numeric";
import type { CountryOverviewRow } from "@/lib/countries-overview";

// Same world-atlas topology the globe and /map use.
const WORLD_TOPOLOGY_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const W = 960;
const H = 500;
const MAX_ZOOM = 8;

// Sequential ramp in the brand teal (light → dark) for open-notice volume. Fixed
// thresholds rather than quantiles so a country's colour only changes when
// its own count does, not when another country's does.
const BUCKETS = [
  { min: 1, label: "1–49", color: "#d4f3e9" },
  { min: 50, label: "50–249", color: "#9fe3cf" },
  { min: 250, label: "250–999", color: "#4fc3a1" },
  { min: 1000, label: "1,000–2,499", color: "#127a63" },
  { min: 2500, label: "2,500+", color: "#0a4a3c" },
] as const;
const COLOR_ZERO = "#cfd6de"; // tracked source, no open notice held
const COLOR_NONE = "#f0f2f5"; // no public source in Mederti
const COLOR_UNAVAILABLE = "#cfd6de";

function fillFor(row: CountryOverviewRow | undefined): string {
  if (!row) return COLOR_NONE;
  if (row.active === null) return COLOR_UNAVAILABLE;
  if (row.active === 0) return COLOR_ZERO;
  let c: string = BUCKETS[0].color;
  for (const b of BUCKETS) if (row.active >= b.min) c = b.color;
  return c;
}

const fmt = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));

type Shape = { id: string; code: string | null; name: string; d: string };

export default function CountriesMap({
  rows,
  generatedAt,
}: {
  rows: CountryOverviewRow[];
  generatedAt: string;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [shapes, setShapes] = useState<Shape[] | null>(null);
  const [mapError, setMapError] = useState(false);
  const [hover, setHover] = useState<{ shape: Shape; x: number; y: number } | null>(null);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d3, topojson, res] = await Promise.all([
          import("d3"),
          import("topojson-client"),
          fetch(WORLD_TOPOLOGY_URL),
        ]);
        if (!res.ok) throw new Error(`topology ${res.status}`);
        const world = (await res.json()) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
        const fc = topojson.feature(world, world.objects.countries) as FeatureCollection<Geometry, { name: string }>;
        // Antarctica (010) only wastes vertical space on a shortage map.
        const features = fc.features.filter((f) => String(f.id) !== "010" && f.properties?.name !== "Antarctica");
        const projection = d3.geoNaturalEarth1().fitSize([W, H], { type: "FeatureCollection", features });
        const path = d3.geoPath(projection);
        // A few disputed territories carry no ISO id in world-atlas, so the
        // shape key is the feature index, not the id.
        const out: Shape[] = features.map((f, i) => {
          const iso = f.id == null ? null : String(f.id).padStart(3, "0");
          return {
            id: String(i),
            code: iso ? ISO_NUMERIC_TO_ALPHA2[iso] ?? null : null,
            name: f.properties?.name ?? "",
            d: path(f) ?? "",
          };
        });
        if (!cancelled) setShapes(out);
      } catch {
        if (!cancelled) setMapError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const drawn = useMemo(() => new Set((shapes ?? []).map((s) => s.code).filter(Boolean)), [shapes]);
  // Tracked countries too small to appear at this map scale (e.g. Singapore).
  const offMap = shapes ? rows.filter((r) => !drawn.has(r.code)) : [];

  const totals = useMemo(() => {
    const withOpen = rows.filter((r) => (r.active ?? 0) > 0).length;
    return { tracked: rows.length, withOpen };
  }, [rows]);

  // Zoom / pan, in viewBox units: the country group is drawn at
  // translate(x,y) scale(k). Clamped so the map can't be dragged off-canvas.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampView = (k: number, x: number, y: number) => {
    const kk = Math.min(MAX_ZOOM, Math.max(1, k));
    return {
      k: kk,
      x: Math.min(0, Math.max(W - W * kk, x)),
      y: Math.min(0, Math.max(H - H * kk, y)),
    };
  };
  // Zoom about the centre of what's currently visible.
  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor));
      const r = k / v.k;
      return clampView(k, W / 2 - (W / 2 - v.x) * r, H / 2 - (H / 2 - v.y) * r);
    });

  const onPointerDown = (e: React.PointerEvent) => {
    if (view.k === 1 || e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      setHover(null);
    }
    // Screen pixels → viewBox units.
    const scale = W / (svgRef.current?.clientWidth || W);
    setView((v) => clampView(v.k, d.x + dx * scale, d.y + dy * scale));
  };
  const endDrag = () => {
    // Keep `moved` readable by the click that follows pointerup, then clear.
    const d = drag.current;
    setDragging(false);
    if (d) setTimeout(() => { if (drag.current === d) drag.current = null; }, 0);
  };

  const go = (row: CountryOverviewRow) => {
    if (drag.current?.moved) return; // a pan, not a click
    router.push(`/country/${row.slug}/medicine-shortages`);
  };

  const move = (e: React.MouseEvent, shape: Shape) => {
    if (drag.current?.moved) return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ shape, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const hoverRow = hover?.shape.code ? byCode.get(hover.shape.code) : undefined;
  const asOf = new Date(generatedAt).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  return (
    <div className="cm">
      <header className="cm-head">
        <h1>Shortages by country</h1>
        <p>
          Open shortage notices published by each country&apos;s official regulator.{" "}
          {totals.withOpen} of the {totals.tracked} countries with a listed source currently have open notices. Hover a country
          for its figures; click to open its page. Use + and − to zoom, then drag to move around.
        </p>
      </header>

      <div className="cm-map" ref={wrapRef} onMouseLeave={() => setHover(null)}>
        {shapes ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="World map of open shortage notices by country. The same figures are in the table below."
            className={view.k > 1 ? (dragging ? "cm-grabbing" : "cm-grab") : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {shapes.map((s) => {
              const row = s.code ? byCode.get(s.code) : undefined;
              const active = hover?.shape.id === s.id;
              return (
                <path
                  key={s.id}
                  d={s.d}
                  fill={fillFor(row)}
                  className={`cm-c${row ? " cm-link" : ""}${active ? " cm-on" : ""}`}
                  onMouseMove={(e) => move(e, s)}
                  onClick={row ? () => go(row) : undefined}
                />
              );
            })}
            </g>
          </svg>
        ) : (
          <div className="cm-ph">{mapError ? "The map couldn't load. The table below has the same figures." : "Loading map…"}</div>
        )}

        {shapes && (
          <div className="cm-zoom" role="group" aria-label="Map zoom">
            <button type="button" onClick={() => zoomBy(1.6)} disabled={view.k >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in">+</button>
            <button type="button" onClick={() => zoomBy(1 / 1.6)} disabled={view.k <= 1} aria-label="Zoom out" title="Zoom out">−</button>
            <button type="button" className="cm-zoom-reset" onClick={() => setView({ k: 1, x: 0, y: 0 })} disabled={view.k === 1} aria-label="Reset zoom" title="Reset zoom">Reset</button>
          </div>
        )}

        {hover && (
          <div
            className="cm-tip"
            style={{
              left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 236),
              // Flip above the cursor near the bottom edge so it isn't clipped.
              ...(hover.y > (wrapRef.current?.clientHeight ?? 400) - 170
                ? { bottom: (wrapRef.current?.clientHeight ?? 400) - hover.y + 14 }
                : { top: hover.y + 14 }),
            }}
          >
            <div className="cm-tip-name">{hoverRow?.name ?? hover.shape.name}</div>
            {hoverRow ? (
              <>
                {hoverRow.regulators.length > 0 && <div className="cm-tip-src">{hoverRow.regulators.join(" · ")}</div>}
                {hoverRow.active === null ? (
                  <div className="cm-tip-note">Figures unavailable right now.</div>
                ) : hoverRow.active === 0 && !hoverRow.anticipated ? (
                  <div className="cm-tip-note">
                    {hoverRow.everReceived
                      ? "Mederti holds no open notices for this country right now. Not confirmation of normal supply."
                      : "Source listed, but no notices received from it yet."}
                  </div>
                ) : (
                  <dl>
                    <div><dt>Active notices</dt><dd>{fmt(hoverRow.active)}</dd></div>
                    <div><dt>Rated critical</dt><dd>{fmt(hoverRow.critical)}</dd></div>
                    <div><dt>Anticipated</dt><dd>{fmt(hoverRow.anticipated)}</dd></div>
                  </dl>
                )}
                <div className="cm-tip-cta">Click to open country page</div>
              </>
            ) : (
              <div className="cm-tip-note">No public shortage source in Mederti.</div>
            )}
          </div>
        )}
      </div>

      <div className="cm-legend" aria-label="Legend">
        <span className="cm-leg-title">Active notices</span>
        {BUCKETS.map((b) => (
          <span key={b.label} className="cm-leg"><i style={{ background: b.color }} />{b.label}</span>
        ))}
        <span className="cm-leg"><i style={{ background: COLOR_ZERO }} />Source listed, no open notices held</span>
        <span className="cm-leg"><i style={{ background: COLOR_NONE, border: "1px solid #d5dbe2" }} />No public source</span>
      </div>

      <p className="cm-note">
        Counts are notices, not medicines. Regulators list each strength and pack separately and apply different
        reporting rules, so a darker country is not necessarily worse off than a lighter one. Mid-grey means Mederti holds no open notice
        from that country&apos;s source right now (the feed may be empty or unavailable), not that supply is normal. Pale
        countries have no public shortage source in Mederti. Figures as of {asOf} UTC.
        {offMap.length > 0 && (
          <> Too small to show at this scale, listed in the table: {offMap.map((r) => r.name).join(", ")}.</>
        )}
      </p>

      <div className="cm-tablewrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Source</th>
              <th className="num">Active notices</th>
              <th className="num">Critical</th>
              <th className="num">Anticipated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td>
                  <i className="cm-sw" style={{ background: fillFor(r) }} />
                  <Link href={`/country/${r.slug}/medicine-shortages`}>{r.name}</Link>
                </td>
                <td className="src">{r.regulators.join(", ") || (r.everReceived ? "—" : "No notices received yet")}</td>
                <td className="num">{fmt(r.active)}</td>
                <td className="num">{fmt(r.critical)}</td>
                <td className="num">{fmt(r.anticipated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
.cm{color:var(--app-text,#0c1118);padding:0 0 24px}
.cm-head h1{font-size:26px;font-weight:700;letter-spacing:-.02em;margin:0 0 6px}
.cm-head p{font-size:14px;line-height:1.6;color:var(--app-text-2,#3d4653);margin:0 0 18px;max-width:720px}
.cm-map{position:relative;border:1px solid var(--app-border,#dde3e9);border-radius:14px;background:#fff;padding:4px;overflow:hidden}
.cm-map svg{display:block;width:100%;height:auto}
.cm-c{stroke:#fff;stroke-width:.6;vector-effect:non-scaling-stroke;outline:none}
.cm-link{cursor:pointer}
.cm-map svg.cm-grab{cursor:grab}
.cm-map svg.cm-grabbing,.cm-map svg.cm-grabbing .cm-link{cursor:grabbing}
.cm-map svg{touch-action:pan-y;user-select:none}
.cm-zoom{position:absolute;top:12px;right:12px;z-index:4;display:flex;flex-direction:column;gap:4px}
.cm-zoom button{width:32px;height:32px;border:1px solid var(--app-border,#dde3e9);border-radius:8px;background:#fff;color:var(--app-text,#0c1118);font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(11,16,48,.06)}
.cm-zoom button:hover:not(:disabled){background:#f3f6f8}
.cm-zoom button:disabled{opacity:.4;cursor:default}
.cm-zoom .cm-zoom-reset{font-size:10px;font-weight:600;letter-spacing:.02em}
.cm-on{stroke:#0b1030;stroke-width:1.4}
.cm-ph{aspect-ratio:${W}/${H};display:flex;align-items:center;justify-content:center;font-size:13.5px;color:var(--app-text-3,#6a7280)}
.cm-tip{position:absolute;z-index:5;width:222px;pointer-events:none;background:#0b1030;color:#fff;border-radius:10px;padding:10px 12px;font-size:12.5px;box-shadow:0 8px 24px rgba(11,16,48,.25)}
.cm-tip-name{font-size:14px;font-weight:650}
.cm-tip-src{color:#aab3cf;margin:1px 0 8px}
.cm-tip dl{margin:0;display:grid;gap:3px}
.cm-tip dl div{display:flex;justify-content:space-between;gap:12px}
.cm-tip dt{color:#c5cce0}
.cm-tip dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.cm-tip-note{color:#c5cce0;margin-top:4px}
.cm-tip-cta{margin-top:8px;color:#8fe3df;font-size:11.5px}
.cm-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:12px 2px 0;font-size:12.5px;color:var(--app-text-2,#3d4653)}
.cm-leg-title{font-weight:600;color:var(--app-text,#0c1118)}
.cm-leg{display:inline-flex;align-items:center;gap:6px}
.cm-leg i,.cm-sw{display:inline-block;width:12px;height:12px;border-radius:3px;flex:none}
.cm-sw{margin-right:8px;vertical-align:-1px}
.cm-note{font-size:12.5px;line-height:1.6;color:var(--app-text-3,#6a7280);margin:10px 2px 22px;max-width:820px}
.cm-tablewrap{border:1px solid var(--app-border,#dde3e9);border-radius:14px;overflow-x:auto;background:#fff}
.cm-table{width:100%;border-collapse:collapse;font-size:13.5px}
.cm-table th{text-align:left;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--app-text-3,#6a7280);padding:10px 12px;border-bottom:1px solid var(--app-border,#dde3e9);white-space:nowrap}
.cm-table td{padding:9px 12px;border-bottom:1px solid var(--app-border,#eef1f4);white-space:nowrap}
.cm-table tr:last-child td{border-bottom:0}
.cm-table .num{text-align:right;font-variant-numeric:tabular-nums}
.cm-table .src{color:var(--app-text-3,#6a7280)}
.cm-table a{color:inherit;font-weight:550;text-decoration:none}
.cm-table a:hover{text-decoration:underline}
@media (max-width:640px){.cm-head h1{font-size:22px}}
      `}</style>
    </div>
  );
}
