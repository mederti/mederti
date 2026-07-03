import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * Recolors the OpenFreeMap "liberty" basemap to Mederti's neutral gray +
 * soft teal palette instead of the default OSM green/blue, so the colored
 * shortage/facility/HQ markers read as the primary signal on the map.
 *
 * Walks every layer in the loaded style and overrides paint colors by
 * layer type + id substring rather than hardcoding liberty's exact layer
 * names, so it keeps working if OpenFreeMap tweaks the style internals.
 */
export function recolorBasemap(map: MaplibreMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  const water = "#d7ede6"; // soft teal, close to --teal-bg
  const land = "#f7f6f2"; // near --surf-2, warm off-white — the dominant neutral
  const parkTint = "#e9f0ea"; // barely-there green, only for actual urban parks
  const building = "#ece9e2";
  const roadMinor = "#e3e6e1";
  const roadMajor = "#c9cec8";
  const boundary = "#aeb4ac";
  const label = "#6a7280"; // --tx-3
  const labelHalo = "#ffffff";

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", land);
      } else if (layer.type === "fill") {
        if (id.includes("water")) {
          map.setPaintProperty(layer.id, "fill-color", water);
        } else if (id.includes("building")) {
          map.setPaintProperty(layer.id, "fill-color", building);
        } else if (id === "park") {
          // Only true "park" polygons get a hint of green — landcover_wood/
          // landcover_grass etc. cover huge rural areas at world zoom and
          // would dominate the map with a green cast if tinted the same way.
          map.setPaintProperty(layer.id, "fill-color", parkTint);
        } else {
          map.setPaintProperty(layer.id, "fill-color", land);
        }
      } else if (layer.type === "line") {
        if (id.includes("water")) {
          map.setPaintProperty(layer.id, "line-color", water);
        } else if (id.includes("boundary")) {
          map.setPaintProperty(layer.id, "line-color", boundary);
        } else if (id.includes("building")) {
          map.setPaintProperty(layer.id, "line-color", building);
        } else if (id.includes("road") || id.includes("bridge") || id.includes("tunnel") || id.includes("street")) {
          const major = id.includes("motorway") || id.includes("trunk") || id.includes("primary");
          map.setPaintProperty(layer.id, "line-color", major ? roadMajor : roadMinor);
        }
      } else if (layer.type === "symbol") {
        if (map.getPaintProperty(layer.id, "text-color") !== undefined) {
          map.setPaintProperty(layer.id, "text-color", label);
          map.setPaintProperty(layer.id, "text-halo-color", labelHalo);
        }
      } else if (layer.type === "raster" && id.includes("natural_earth")) {
        // Low-zoom shaded-relief raster overview — baked-in terrain greens/tans
        // that paint-property overrides can't touch. Hide it so the recolored
        // vector background/land fills show through at world zoom instead.
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      // Some layers don't support the paint property we're trying to set
      // (e.g. fill-pattern-only layers) — skip rather than fail the whole pass.
    }
  }
}
