"use client";

import { useEffect, useRef, useState } from "react";
// NOTE: maplibre-gl must stay OUT of the bundler's reach entirely — both a
// static JS import here AND its stylesheet anywhere in the page graph
// (client import, server-page import, or a vendored local copy) silently
// break browser hydration of the whole page under Turbopack (Next 16.1.6):
// SSR renders, no error, but the client bundle never links. So the JS is
// loaded via dynamic import in the init effect below, and the CSS is a
// vendored copy in /public injected as a <link> tag at runtime (the bundler
// never sees it). Re-copy public/maplibre-gl.css when upgrading maplibre-gl.
// Type-only imports are erased at build time and safe.
import type maplibreglNs from "maplibre-gl";
import type { Topology, GeometryCollection } from "topojson-specification";
import { Map as MapIcon } from "lucide-react";
import { ISO_NUMERIC_TO_ALPHA2 } from "@/lib/geo/country-iso-numeric";
import { recolorBasemap } from "@/lib/geo/recolor-basemap";
import "./map-view.css";

// A MapLibre IControl-shaped "reset to global view" button, styled with the
// built-in maplibregl-ctrl classes so it sits under the zoom/compass control
// and inherits its look. MapLibre has no built-in reset button.
function makeResetControl(onReset: () => void) {
  let container: HTMLDivElement;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = "Reset to global view";
      btn.setAttribute("aria-label", "Reset to global view");
      btn.style.cssText = "display:flex;align-items:center;justify-content:center;";
      // Globe icon (inherits currentColor).
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/></svg>';
      btn.addEventListener("click", onReset);
      container.appendChild(btn);
      return container;
    },
    onRemove() {
      container.remove();
    },
  };
}

// Versioned: the soft-launch middleware used to 308-redirect the bare
// /maplibre-gl.css path (fixed in proxy.ts by excluding .css), but a 308 is a
// PERMANENT redirect browsers cache hard — anyone who loaded the map before
// that fix would keep getting the cached redirect (unstyled controls). The
// ?v query is a fresh URL that was never redirected. Bump on CSS upgrades.
const MAPLIBRE_CSS_HREF = "/maplibre-gl.css?v=1";
function ensureMaplibreCss() {
  if (document.querySelector(`link[href="${MAPLIBRE_CSS_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_CSS_HREF;
  document.head.appendChild(link);
}

// OpenFreeMap's public "liberty" style — free vector basemap, no API key,
// no billing account. Gives the same zoom/pan/compass interactions as
// Google Maps without the recurring-cost + secret-management tradeoff.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Initial (and "reset to global") camera. Shared by map init + the reset button.
const INITIAL_CENTER: [number, number] = [10, 25];
const INITIAL_ZOOM = 1.4;
// Country polygons for the shortage choropleth — same world-atlas topology
// the SpinningGlobe component already fetches.
const WORLD_TOPOLOGY_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const CHORO_SOURCE_ID = "mv-choropleth";
const CHORO_FILL_LAYER_ID = "mv-choropleth-fill";
const CHORO_LINE_LAYER_ID = "mv-choropleth-line";

// Hospitals layer: a single static PMTiles file built from Overture Maps
// places (see backend/scripts/build_healthcare_tiles.py). MapLibre streams
// only the tiles for the current viewport — no API route, no DB rows.
// Served from /public in dev; point the env var at object storage in prod.
const HOSPITALS_TILES_PATH =
  process.env.NEXT_PUBLIC_HOSPITALS_TILES_URL ?? "/tiles/hospitals.pmtiles";
const HOSPITALS_SOURCE_ID = "mv-hospitals";
const HOSPITALS_LAYER_ID = "mv-hospitals-circles";
// Must match the `-l` layer name in build_healthcare_tiles.py.
const HOSPITALS_TILE_LAYER = "hospitals";

// The dynamically-loaded maplibre-gl module (see hydration note above).
type MaplibreModule = typeof maplibreglNs;

// Register the pmtiles:// protocol once per page load. Imported dynamically —
// the library is only needed when the hospitals toggle is first enabled.
let pmtilesRegistered = false;
async function ensurePmtilesProtocol(ml: MaplibreModule): Promise<void> {
  if (pmtilesRegistered) return;
  const { Protocol } = await import("pmtiles");
  ml.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

type Horizon = "today" | "30" | "60" | "90" | "180" | "365";

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "30", label: "30d" },
  { value: "60", label: "60d" },
  { value: "90", label: "90d" },
  { value: "180", label: "6mo" },
  { value: "365", label: "12mo" },
];

type LatLng = { lat: number; lng: number };

type ShortageMarker = {
  country: string;
  country_code: string;
  world_region: string | null;
  count: number;
  severity: string | null;
  centroid: LatLng | null;
};

type ManufacturingCluster = {
  country: string;
  city: string | null;
  lat: number;
  lng: number;
  count: number;
  max_oai: number;
  any_import_alert: boolean;
};

type ManufacturerMarker = {
  name?: string | null;
  country: string;
  country_code: string;
  count: number;
  city?: string | null;
  centroid: LatLng | null;
  granularity: "city" | "country";
};

type RegulatorMarker = {
  id: string;
  name: string;
  abbreviation: string | null;
  country: string | null;
  country_code: string;
  region: string | null;
  city: string | null;
  centroid: LatLng | null;
  granularity: "city" | "country";
};

type MapDataResponse = {
  horizon: string;
  layers: string[];
  shortages?: ShortageMarker[];
  manufacturing?: ManufacturingCluster[];
  manufacturers?: ManufacturerMarker[];
  regulators?: RegulatorMarker[];
};

// Sequential heat ramp (light amber -> deep red) for the shortage choropleth.
const HEAT_RAMP = ["#fbe3c0", "#f2b273", "#e07a44", "#c74632", "#9c1f30"];

// Shortage counts are heavily skewed (one market can have 30x the rows of
// another purely from regulator reporting style), so scale on log(count)
// rather than raw count — a linear ramp paints one country dark and leaves
// the rest indistinguishable from zero.
function heatColor(count: number, max: number): string {
  const t = Math.log(count + 1) / Math.log(max + 1);
  const idx = Math.min(HEAT_RAMP.length - 1, Math.floor(t * HEAT_RAMP.length));
  return HEAT_RAMP[idx];
}

// The choropleth can be coloured two ways. "volume" is the raw shortage count
// (log-scaled, above) — useful but skewed by how granularly each regulator
// reports (one market lists every affected pack, another one product line).
// "severity" colours by the worst active-shortage severity in the country,
// which reads as clinical pressure independent of reporting style.
type ShortageMetric = "volume" | "severity";
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#9c1f30",
  high: "#d0552f",
  medium: "#e0a02a",
  low: "#7aa33f",
};
const SEVERITY_ORDER: { key: string; label: string }[] = [
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

type LayerKey = "shortages" | "manufacturing" | "manufacturers" | "regulators" | "hospitals";

// "hospitals" is served from static PMTiles, not /api/map-data — keep the
// two lists distinct so the API never sees a layer it would 400 on.
const API_LAYERS: ReadonlySet<LayerKey> = new Set(["shortages", "manufacturing", "manufacturers", "regulators"]);

// The hospitals PMTiles file is gitignored (26 MB) and only exists locally, so
// in prod it must be hosted and pointed at via NEXT_PUBLIC_HOSPITALS_TILES_URL.
// Without that env var the toggle would 404 silently, so hide it entirely
// unless the tiles are actually reachable (env var set, or local dev where the
// file is served from /public).
const HOSPITALS_AVAILABLE =
  Boolean(process.env.NEXT_PUBLIC_HOSPITALS_TILES_URL) ||
  process.env.NODE_ENV === "development";

const ACTIVE_LAYERS: { key: LayerKey; label: string }[] = [
  { key: "shortages", label: "Shortages" },
  { key: "manufacturing", label: "Manufacturing sites" },
  { key: "manufacturers", label: "Manufacturer HQs" },
  { key: "regulators", label: "Regulator HQs" },
  ...(HOSPITALS_AVAILABLE ? [{ key: "hospitals" as LayerKey, label: "Hospitals" }] : []),
];

// Escape untrusted strings before Popup.setHTML (which is innerHTML). Hospital
// names come from Overture/OSM tiles — publicly editable upstream, so an
// attacker can plant markup in a place name.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markerEl(opts: { size: number; color: string; shape?: "circle" | "square" }) {
  const el = document.createElement("div");
  el.style.width = `${opts.size}px`;
  el.style.height = `${opts.size}px`;
  el.style.background = opts.color;
  el.style.border = "1.5px solid #fff";
  el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
  el.style.borderRadius = opts.shape === "square" ? "3px" : "50%";
  el.style.cursor = "pointer";
  return el;
}

export default function MapViewClient() {
  const [horizon, setHorizon] = useState<Horizon>("today");
  const [shortageMetric, setShortageMetric] = useState<ShortageMetric>("volume");
  const [enabledLayers, setEnabledLayers] = useState<Set<LayerKey>>(
    new Set(["shortages", "manufacturing"]),
  );
  const [data, setData] = useState<MapDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [countriesReady, setCountriesReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mlRef = useRef<MaplibreModule | null>(null);
  const mapRef = useRef<maplibreglNs.Map | null>(null);
  const markersRef = useRef<maplibreglNs.Marker[]>([]);
  const hoverPopupRef = useRef<maplibreglNs.Popup | null>(null);
  // country_code -> {count, country} for the currently displayed horizon,
  // read by the choropleth hover handler.
  const shortageByCodeRef = useRef<Map<string, { count: number; country: string }>>(new Map());
  // Mirror of enabledLayers, read from inside the async addHospitalsLayer (which
  // would otherwise close over a stale set and re-show a just-toggled-off layer).
  const enabledLayersRef = useRef<Set<LayerKey>>(enabledLayers);
  useEffect(() => { enabledLayersRef.current = enabledLayers; }, [enabledLayers]);

  // Init the map once; add the country-polygon choropleth source when both
  // the style and the topology have loaded.
  useEffect(() => {
    let cancelled = false;
    let createdMap: maplibreglNs.Map | null = null;

    (async () => {
      // Dynamic import — see the hydration note at the top of this file.
      ensureMaplibreCss();
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      mlRef.current = maplibregl;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      map.addControl(
        makeResetControl(() =>
          map.easeTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, bearing: 0, pitch: 0, duration: 600 }),
        ) as maplibreglNs.IControl,
        "top-right",
      );
      createdMap = map;
      mapRef.current = map;

      // Gate init on the STYLE being ready, not map "load" — "load" (and even
      // isStyleLoaded()) also wait on every initial tile + sprite fetch, so a
      // single slow CDN request would block the choropleth and markers from
      // ever appearing. style._loaded is the exact flag addSource/addLayer
      // check internally; poll it rather than listen for "styledata" (the
      // event can fire before a listener attaches).
      function styleParsed(): boolean {
        return !!(map as unknown as { style?: { _loaded?: boolean } }).style?._loaded;
      }
      function whenStyleReady(cb: () => void) {
        if (cancelled) return;
        if (styleParsed()) cb();
        else setTimeout(() => whenStyleReady(cb), 200);
      }

      whenStyleReady(async () => {
      recolorBasemap(map);
      setMapReady(true);

      try {
        // Dynamic import — topojson-client is only needed for this one-off
        // topology conversion, so keep it out of the initial bundle.
        const [{ feature }, res] = await Promise.all([
          import("topojson-client"),
          fetch(WORLD_TOPOLOGY_URL),
        ]);
        const topology = (await res.json()) as Topology<{
          countries: GeometryCollection<{ name?: string; alpha2?: string | null }>;
        }>;
        const countries = feature(topology, topology.objects.countries);

        // Tag each polygon with its alpha-2 code so paint expressions and
        // hover handlers can join against shortage data.
        for (const f of countries.features) {
          const alpha2 = ISO_NUMERIC_TO_ALPHA2[String(f.id).padStart(3, "0")] ?? null;
          f.properties = { ...(f.properties ?? {}), alpha2 };
        }

        map.addSource(CHORO_SOURCE_ID, { type: "geojson", data: countries });

        // Insert beneath the first symbol (label) layer so place names stay
        // legible on top of the heat fill.
        const firstSymbolId = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: CHORO_FILL_LAYER_ID,
            type: "fill",
            source: CHORO_SOURCE_ID,
            paint: { "fill-color": "#000000", "fill-opacity": 0 },
          },
          firstSymbolId,
        );
        map.addLayer(
          {
            id: CHORO_LINE_LAYER_ID,
            type: "line",
            source: CHORO_SOURCE_ID,
            paint: { "line-color": "#b8bfb8", "line-width": 0.4 },
          },
          firstSymbolId,
        );

        map.on("mousemove", CHORO_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0];
          const alpha2 = f?.properties?.alpha2 as string | null | undefined;
          const entry = alpha2 ? shortageByCodeRef.current.get(alpha2) : undefined;
          if (!entry) {
            hoverPopupRef.current?.remove();
            map.getCanvas().style.cursor = "";
            return;
          }
          map.getCanvas().style.cursor = "pointer";
          if (!hoverPopupRef.current) {
            hoverPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
          }
          hoverPopupRef.current
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${escapeHtml(entry.country)}</strong><br/>${entry.count} shortage${entry.count === 1 ? "" : "s"}`)
            .addTo(map);
        });
        map.on("mouseleave", CHORO_FILL_LAYER_ID, () => {
          hoverPopupRef.current?.remove();
          map.getCanvas().style.cursor = "";
        });

        setCountriesReady(true);
      } catch {
        // Topology fetch failed (offline/CDN issue) — the map still works,
        // just without country fills. Markers and basemap are unaffected.
      }
      });
    })();

    return () => {
      cancelled = true;
      createdMap?.remove();
      mapRef.current = null;
    };
  }, []);

  function loadMapData(layers: string[], signal: AbortSignal) {
    setLoading(true);
    setError(null);
    fetch(`/api/map-data?horizon=${horizon}&layers=${layers.join(",")}`, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`map data request failed (${res.status})`);
        return res.json();
      })
      .then((json: MapDataResponse) => setData(json))
      .catch((err) => {
        if (err.name !== "AbortError") setError("Couldn't load map data. Try again.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Only API-backed layers go in the request — hospitals stream directly
    // from static tiles and never touch /api/map-data.
    const layers = Array.from(enabledLayers).filter((l) => API_LAYERS.has(l));
    // Nothing to fetch when every API layer is off — the render effect below
    // clears all markers/fills when a layer isn't in enabledLayers.
    if (layers.length === 0) return;

    const controller = new AbortController();
    loadMapData(layers, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, enabledLayers]);

  // Hospitals tile layer: added lazily on first enable (so the tiles are
  // never fetched for users who don't open the layer), then toggled via
  // layout visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const wantHospitals = enabledLayers.has("hospitals");

    if (!map.getSource(HOSPITALS_SOURCE_ID)) {
      if (!wantHospitals) return;
      addHospitalsLayer(map).catch(() => {
        setError("Couldn't load the hospitals layer. Try again.");
      });
      return;
    }

    map.setLayoutProperty(HOSPITALS_LAYER_ID, "visibility", wantHospitals ? "visible" : "none");
  }, [enabledLayers, mapReady]);

  async function addHospitalsLayer(map: maplibreglNs.Map) {
    const ml = mlRef.current;
    if (!ml) return;
    await ensurePmtilesProtocol(ml);
    if (map.getSource(HOSPITALS_SOURCE_ID)) return; // raced a second toggle
    {
      const tilesUrl = HOSPITALS_TILES_PATH.startsWith("http")
        ? HOSPITALS_TILES_PATH
        : `${window.location.origin}${HOSPITALS_TILES_PATH}`;
      // Tile/TileJSON fetch failures (e.g. the PMTiles file not hosted in prod)
      // arrive as async maplibre error events, NOT as a throw from addSource —
      // so the caller's .catch() never sees them. Surface them here instead of
      // failing silently.
      map.on("error", (e: { sourceId?: string; error?: { message?: string } }) => {
        if (e?.sourceId === HOSPITALS_SOURCE_ID) {
          setError("Couldn't load the hospitals layer.");
        }
      });
      map.addSource(HOSPITALS_SOURCE_ID, { type: "vector", url: `pmtiles://${tilesUrl}` });
      map.addLayer({
        id: HOSPITALS_LAYER_ID,
        type: "circle",
        source: HOSPITALS_SOURCE_ID,
        "source-layer": HOSPITALS_TILE_LAYER,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 8, 3.5, 12, 6],
          "circle-color": "#0d9488",
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 0, 8, 1],
        },
      });
      // Reflect the current toggle state: the user may have switched Hospitals
      // back off during the async import/protocol setup above, in which case
      // the layer should mount hidden rather than flashing on.
      map.setLayoutProperty(
        HOSPITALS_LAYER_ID,
        "visibility",
        enabledLayersRef.current.has("hospitals") ? "visible" : "none",
      );
      map.on("click", HOSPITALS_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new ml.Popup({ offset: 8, closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${escapeHtml(String(f.properties?.name ?? "Hospital"))}</strong>` +
              `<br/><span style="font-size:11px;color:#6a7280">Source: Overture Maps / OSM — completeness varies by country</span>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", HOSPITALS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", HOSPITALS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }

  // Update the choropleth fill whenever shortage data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !countriesReady || !map.getLayer(CHORO_FILL_LAYER_ID)) return;

    const rows = enabledLayers.has("shortages") ? (data?.shortages ?? []) : [];
    shortageByCodeRef.current = new Map(
      rows.map((s) => [s.country_code, { count: s.count, country: s.country }]),
    );

    if (rows.length === 0) {
      map.setPaintProperty(CHORO_FILL_LAYER_ID, "fill-opacity", 0);
      return;
    }

    const max = Math.max(...rows.map((s) => s.count));
    const matchExpr: unknown[] = ["match", ["get", "alpha2"]];
    for (const s of rows) {
      const color =
        shortageMetric === "severity"
          ? SEVERITY_COLORS[s.severity ?? ""] ?? "#c9cec8"
          : heatColor(s.count, max);
      matchExpr.push(s.country_code, color);
    }
    matchExpr.push("rgba(0,0,0,0)"); // countries with no data stay unfilled

    map.setPaintProperty(CHORO_FILL_LAYER_ID, "fill-color", matchExpr as never);
    map.setPaintProperty(CHORO_FILL_LAYER_ID, "fill-opacity", 0.65);
  }, [data, enabledLayers, countriesReady, shortageMetric]);

  // Redraw point markers (manufacturing/HQ/regulator layers) on data change.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !mapReady) return;
    const activeMap = map;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    function addMarker(lng: number, lat: number, el: HTMLDivElement, popupHtml: string) {
      // Every caller passes a plain-text label built from DB strings (manufacturer
      // /facility/regulator names + cities), so escape the whole thing — these
      // scraped values must not be able to inject markup via innerHTML.
      const popup = new ml!.Popup({ offset: 10, closeButton: false, closeOnClick: false }).setHTML(escapeHtml(popupHtml));
      const marker = new ml!.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(activeMap);
      el.addEventListener("mouseenter", () => marker.togglePopup());
      el.addEventListener("mouseleave", () => marker.togglePopup());
      markersRef.current.push(marker);
    }

    if (enabledLayers.has("manufacturers")) {
      (data?.manufacturers ?? []).forEach((m) => {
        if (!m.centroid) return;
        addMarker(
          m.centroid.lng,
          m.centroid.lat,
          markerEl({ size: 12, color: "#534ab7", shape: "square" }),
          m.granularity === "city"
            ? `${m.name ?? "Manufacturer"} — HQ in ${m.city ?? m.country}, ${m.country}`
            : `${m.country} — ${m.count} manufacturer${m.count === 1 ? "" : "s"} headquartered (country-level)`,
        );
      });
    }

    if (enabledLayers.has("regulators")) {
      (data?.regulators ?? []).forEach((r) => {
        if (!r.centroid) return;
        addMarker(
          r.centroid.lng,
          r.centroid.lat,
          markerEl({ size: 10, color: "#0c447c" }),
          r.granularity === "city"
            ? `${r.name} (${r.abbreviation ?? r.country_code}) — HQ in ${r.city}, ${r.country}`
            : `${r.name} (${r.abbreviation ?? r.country_code}) — ${r.country} (country-level)`,
        );
      });
    }

    if (enabledLayers.has("manufacturing")) {
      const rows = data?.manufacturing ?? [];
      const max = Math.max(1, ...rows.map((c) => c.count));
      rows.forEach((c) => {
        const size = 10 + (c.count / max) * 22;
        addMarker(
          c.lng,
          c.lat,
          markerEl({ size, color: c.any_import_alert ? "#e24b4a" : "#378add" }),
          `${c.city ?? c.country}, ${c.country} — ${c.count} facilit${c.count === 1 ? "y" : "ies"}` +
            (c.any_import_alert ? " (import alert active)" : ""),
        );
      });
    }
  }, [data, enabledLayers, mapReady]);

  function toggleLayer(key: LayerKey) {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mv-root">
      <div className="mv-hero">
        <MapIcon size={20} strokeWidth={1.9} />
        <h1>Map view</h1>
      </div>

      <div className="mv-controls">
        <div className="mv-horizons" role="group" aria-label="Shortage horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              className={`mv-chip ${horizon === h.value ? "mv-chip--active" : ""}`}
              onClick={() => setHorizon(h.value)}
              type="button"
            >
              {h.label}
            </button>
          ))}
        </div>

        {enabledLayers.has("shortages") && (
          <div className="mv-metric" role="group" aria-label="Colour shortages by">
            <span className="mv-metric-label">Colour by</span>
            {(["volume", "severity"] as ShortageMetric[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`mv-chip ${shortageMetric === m ? "mv-chip--active" : ""}`}
                onClick={() => setShortageMetric(m)}
              >
                {m === "volume" ? "Volume" : "Severity"}
              </button>
            ))}
          </div>
        )}

        <div className="mv-layers">
          {ACTIVE_LAYERS.map((l) => (
            <label key={l.key} className="mv-layer-toggle">
              <input
                type="checkbox"
                checked={enabledLayers.has(l.key)}
                onChange={() => toggleLayer(l.key)}
              />
              {l.label}
            </label>
          ))}
          <label className="mv-layer-toggle mv-layer-toggle--disabled">
            <input type="checkbox" disabled />
            Pharmacies <span className="mv-soon">later</span>
          </label>
        </div>
      </div>

      {error && <div className="mv-error">{error}</div>}

      <div className="mv-map-wrap">
        <div ref={containerRef} className="mv-maplibre" />

        {loading && <div className="mv-loading">Loading…</div>}

        <div className="mv-legend">
          <span className="mv-legend-label">Shortages</span>
          {shortageMetric === "volume" ? (
            <>
              <span className="mv-ramp" aria-hidden="true">
                {HEAT_RAMP.map((c) => (
                  <i key={c} className="mv-ramp-step" style={{ background: c }} />
                ))}
              </span>
              <span className="mv-legend-hint">fewer → more</span>
            </>
          ) : (
            SEVERITY_ORDER.map((s) => (
              <span key={s.key}>
                <i className="mv-dot" style={{ background: SEVERITY_COLORS[s.key] }} /> {s.label}
              </span>
            ))
          )}
          <span><i className="mv-dot" style={{ background: "#378add" }} /> Manufacturing site</span>
          <span><i className="mv-dot" style={{ background: "#534ab7", borderRadius: 2 }} /> Manufacturer HQ</span>
          <span><i className="mv-dot" style={{ background: "#0c447c" }} /> Regulator HQ</span>
          {enabledLayers.has("hospitals") && (
            <span><i className="mv-dot" style={{ background: "#0d9488" }} /> Hospital (Overture/OSM)</span>
          )}
        </div>
      </div>
    </div>
  );
}
