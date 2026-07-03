"use client";

import { useEffect, useRef } from "react";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";

/**
 * Slow-spinning orthographic globe drawn on <canvas> — the landing page's
 * "calm closing visual". White sphere, light-grey country outlines, and the
 * countries Mederti actually scrapes pulsing teal like live data, with
 * shipping lanes flowing between major ports. Purely decorative (aria-hidden);
 * all work happens client-side after mount.
 */

// Same topology (and URL) the /map choropleth fetches — see MapViewClient —
// so a visitor who has seen either page gets the other from browser cache.
const WORLD_TOPOLOGY_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Countries with an active national shortage scraper (ISO 3166-1 numeric ids,
// matching world-atlas feature ids — see lib/geo/country-iso-numeric.ts).
// Small territories absent from the 110m topology (SG, HK) are covered by
// port dots instead.
const HIGHLIGHT_IDS = new Set([
  "840", "124", "484", "076", "032", "170", "604", // US CA MX BR AR CO PE
  "826", "372", "250", "276", "724", "620", "380", // GB IE FR DE ES PT IT
  "056", "528", "756", "040", "616", "203", "752", // BE NL CH AT PL CZ SE
  "578", "208", "246", "300", "642", "792", "682", // NO DK FI GR RO TR SA
  "784", "710", "566", "156", "392", "410", "764", // AE ZA NG CN JP KR TH
  "458", "036", "554", // MY AU NZ
]);

// Major container ports [lon, lat] — teal dots + endpoints for shipping lanes.
const PORTS: [number, number][] = [
  [103.85, 1.26], // Singapore
  [121.8, 31.22], // Shanghai
  [4.4, 51.92], // Rotterdam
  [-118.27, 33.73], // Los Angeles
  [-74.05, 40.66], // New York
  [9.93, 53.51], // Hamburg
  [55.03, 25.01], // Jebel Ali (Dubai)
  [72.95, 18.95], // Nhava Sheva (Mumbai)
  [-46.31, -23.98], // Santos
  [151.2, -33.96], // Sydney
  [129.06, 35.08], // Busan
  [18.43, -33.91], // Cape Town
  [139.78, 35.62], // Tokyo
];

// Great-circle lanes as index pairs into PORTS.
const LANES: [number, number][] = [
  [1, 3], // Shanghai → LA
  [12, 3], // Tokyo → LA
  [1, 0], // Shanghai → Singapore
  [0, 6], // Singapore → Jebel Ali
  [6, 2], // Jebel Ali → Rotterdam
  [7, 0], // Mumbai → Singapore
  [0, 9], // Singapore → Sydney
  [2, 4], // Rotterdam → New York
  [5, 8], // Hamburg → Santos
  [11, 6], // Cape Town → Jebel Ali
  [10, 1], // Busan → Shanghai
];

const GOLDEN_ANGLE = 2.399963229728653;
const SPIN_DEG_PER_S = 6.5;
const TILT_DEG = -16;

function smoothstep(e0: number, e1: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
}

// Per-country animated intensity: a sine with golden-angle phase spread and a
// per-country frequency, squashed through a smoothstep whose window keeps the
// country fully dark for most of its cycle — so highlights visibly toggle on
// and off rather than all breathing in unison.
function intensity(i: number, t: number): number {
  const freq = 0.11 + 0.29 * ((i * 0.7548776662466927) % 1);
  const s = 0.5 + 0.5 * Math.sin(i * GOLDEN_ANGLE + t * freq);
  return smoothstep(0.45, 0.8, s);
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export default function GlobeSection() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    let raf = 0;
    let resizeObs: ResizeObserver | null = null;
    let visObs: IntersectionObserver | null = null;

    (async () => {
      const [d3, topojson, worldRes] = await Promise.all([
        import("d3"),
        import("topojson-client"),
        fetch(WORLD_TOPOLOGY_URL),
      ]);
      if (disposed || !worldRes.ok) return;
      const world = (await worldRes.json()) as Topology;
      if (disposed) return;
      const countriesObj = world.objects.countries as GeometryCollection;
      // mesh with no filter = every boundary arc, coastlines included.
      const borders = topojson.mesh(world, countriesObj);
      const graticule = d3.geoGraticule10();
      const sphere = { type: "Sphere" } as const;
      const highlights = (
        topojson.feature(world, countriesObj) as FeatureCollection<Geometry>
      ).features.filter((f) => HIGHLIGHT_IDS.has(String(f.id)));

      const projection = d3.geoOrthographic();
      const path = d3.geoPath(projection, ctx);

      let w = 0;
      let h = 0;
      let dpr = 1;

      const size = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = canvas.clientWidth;
        h = canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      };

      const render = (t: number) => {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) * 0.42;
        projection
          .translate([cx, cy])
          .scale(r)
          .rotate([t * SPIN_DEG_PER_S, TILT_DEG]);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Sphere: white fill with a soft drop shadow for depth…
        ctx.save();
        ctx.beginPath();
        path(sphere);
        ctx.shadowColor = "rgba(12,17,24,0.16)";
        ctx.shadowBlur = r * 0.22;
        ctx.shadowOffsetY = r * 0.09;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();

        // …plus a faint radial shading, offset toward the upper-left "light".
        const shade = ctx.createRadialGradient(
          cx - r * 0.35, cy - r * 0.45, r * 0.1,
          cx, cy, r * 1.05
        );
        shade.addColorStop(0, "rgba(255,255,255,0)");
        shade.addColorStop(0.72, "rgba(140,152,158,0.05)");
        shade.addColorStop(1, "rgba(140,152,158,0.16)");
        ctx.beginPath();
        path(sphere);
        ctx.fillStyle = shade;
        ctx.fill();

        ctx.beginPath();
        path(graticule);
        ctx.strokeStyle = "rgba(120,130,135,0.14)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        path(borders);
        ctx.strokeStyle = "rgba(160,168,172,0.75)";
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Covered countries pulsing teal — colour deepens and outline
        // thickens with intensity (#2dd4bf → #0d9488 fill, → #0f766e stroke).
        for (let i = 0; i < highlights.length; i++) {
          const k = intensity(i, t);
          if (k < 0.02) continue;
          const cr = Math.round(lerp(45, 13, k));
          const cg = Math.round(lerp(212, 148, k));
          const cb = Math.round(lerp(191, 136, k));
          ctx.beginPath();
          path(highlights[i]);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.12 + 0.38 * k})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${Math.round(lerp(45, 15, k))},${Math.round(lerp(180, 118, k))},${Math.round(lerp(165, 110, k))},${0.25 + 0.6 * k})`;
          ctx.lineWidth = 0.5 + 0.9 * k;
          ctx.stroke();
        }

        // Shipping lanes: great-circle arcs (geoPath resamples LineStrings
        // along the great circle and clips them to the sphere), dashed with a
        // scrolling offset so they read as flowing.
        ctx.save();
        ctx.beginPath();
        for (const [a, b] of LANES) {
          path({ type: "LineString", coordinates: [PORTS[a], PORTS[b]] });
        }
        ctx.setLineDash([2, 7]);
        ctx.lineDashOffset = -t * 16;
        ctx.strokeStyle = "rgba(13,148,136,0.5)";
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();

        // Port dots + pulsing halos, front hemisphere only.
        const center = projection.invert!([cx, cy]);
        if (center) {
          for (let i = 0; i < PORTS.length; i++) {
            if (d3.geoDistance(PORTS[i], center) >= Math.PI / 2) continue;
            const p = projection(PORTS[i]);
            if (!p) continue;
            const pulse = 0.5 + 0.5 * Math.sin(t * 2 + i * GOLDEN_ANGLE);
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3.5 + 3.5 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(13,148,136,${0.04 + 0.18 * (1 - pulse)})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p[0], p[1], 2, 0, Math.PI * 2);
            ctx.fillStyle = "#0d9488";
            ctx.fill();
          }
        }

        ctx.beginPath();
        path(sphere);
        ctx.strokeStyle = "rgba(150,160,165,0.9)";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      };

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Fixed mid-animation instant for the static frame: a few countries lit,
      // lanes and ports in a pleasant spot.
      const STATIC_T = 21;
      let inView = true;
      const t0 = performance.now();

      const frame = () => {
        if (disposed) return;
        // Late-layout guard: if the backing store is empty or has drifted
        // from the rendered size (fonts/layout resolving after mount), re-run
        // sizing so the canvas never stays blank.
        if (
          canvas.width === 0 ||
          canvas.width !== Math.max(1, Math.round(canvas.clientWidth * dpr)) ||
          canvas.height !== Math.max(1, Math.round(canvas.clientHeight * dpr))
        ) {
          size();
        }
        if (w >= 10 && h >= 10) render((performance.now() - t0) / 1000);
        raf = requestAnimationFrame(frame);
      };

      size();
      resizeObs = new ResizeObserver(() => {
        size();
        if (reduced) render(STATIC_T);
      });
      resizeObs.observe(canvas);

      if (reduced) {
        render(STATIC_T);
        return;
      }

      // Pause the loop while scrolled out of view.
      visObs = new IntersectionObserver(([entry]) => {
        const nowInView = entry.isIntersecting;
        if (nowInView && !inView) raf = requestAnimationFrame(frame);
        if (!nowInView) cancelAnimationFrame(raf);
        inView = nowInView;
      });
      visObs.observe(canvas);

      raf = requestAnimationFrame(frame);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObs?.disconnect();
      visObs?.disconnect();
    };
  }, []);

  return (
    <section
      aria-hidden
      style={{ position: "relative", width: "100%", height: "clamp(480px, 78vh, 820px)", marginTop: 84 }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </section>
  );
}
