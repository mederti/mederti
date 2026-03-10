"use client";

import { useState, useCallback } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup, type Geography as GeoType } from "react-simple-maps";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO numeric → alpha-2 for countries we track
const NUMERIC_TO_A2: Record<number, string> = {
  36: "AU", 40: "AT", 56: "BE", 76: "BR", 124: "CA", 152: "CL",
  156: "CN", 170: "CO", 191: "HR", 203: "CZ", 208: "DK", 246: "FI",
  250: "FR", 276: "DE", 300: "GR", 348: "HU", 356: "IN", 372: "IE",
  376: "IL", 380: "IT", 392: "JP", 410: "KR", 484: "MX", 528: "NL",
  554: "NZ", 566: "NG", 578: "NO", 616: "PL", 620: "PT", 630: "PR",
  702: "SG", 710: "ZA", 724: "ES", 752: "SE", 756: "CH", 792: "TR",
  804: "UA", 826: "GB", 840: "US", 858: "UY", 862: "VE",
};

const COUNTRY_FLAGS: Record<string, string> = {
  AU: "🇦🇺", AT: "🇦🇹", BR: "🇧🇷", CA: "🇨🇦", CZ: "🇨🇿", DK: "🇩🇰",
  FI: "🇫🇮", FR: "🇫🇷", DE: "🇩🇪", HU: "🇭🇺", IE: "🇮🇪", IT: "🇮🇹",
  JP: "🇯🇵", KR: "🇰🇷", MX: "🇲🇽", NL: "🇳🇱", NZ: "🇳🇿", NG: "🇳🇬",
  NO: "🇳🇴", SG: "🇸🇬", ZA: "🇿🇦", ES: "🇪🇸", SE: "🇸🇪", CH: "🇨🇭",
  GB: "🇬🇧", US: "🇺🇸",
};

function getColor(count: number, maxSev: string): string {
  if (count === 0) return "#e2e8f0";
  if (maxSev === "critical") {
    if (count >= 1000) return "#7f1d1d";
    if (count >= 500)  return "#dc2626";
    if (count >= 100)  return "#ef4444";
    return "#fca5a5";
  }
  if (maxSev === "high") {
    if (count >= 500) return "#c2410c";
    if (count >= 100) return "#f97316";
    return "#fdba74";
  }
  if (count >= 100) return "#fbbf24";
  if (count >= 10)  return "#fde68a";
  return "#fef9c3";
}

interface CountryBucket {
  country_code: string;
  country: string;
  count: number;
  max_severity: string;
}

interface TooltipState {
  x: number;
  y: number;
  cc: string;
  country: string;
  count: number;
  max_severity: string;
}

interface Props {
  byCountry: CountryBucket[];
}

export default function WorldMap({ byCountry }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const dataMap = new Map<string, CountryBucket>();
  for (const b of byCountry) dataMap.set(b.country_code, b);

  const handleMouseEnter = useCallback(
    (geo: GeoType, evt: React.MouseEvent<SVGPathElement>) => {
      const numericId = parseInt(geo.id, 10);
      const cc = NUMERIC_TO_A2[numericId];
      if (!cc) return;
      const bucket = dataMap.get(cc);
      if (!bucket) return;
      setTooltip({
        x: evt.clientX,
        y: evt.clientY,
        cc,
        country: bucket.country,
        count: bucket.count,
        max_severity: bucket.max_severity,
      });
    },
    [dataMap]
  );

  const handleMouseMove = useCallback((evt: React.MouseEvent) => {
    if (tooltip) setTooltip((t) => t ? { ...t, x: evt.clientX, y: evt.clientY } : null);
  }, [tooltip]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const sevColor: Record<string, string> = {
    critical: "#dc2626", high: "#f97316", medium: "#f59e0b", low: "#22c55e",
  };

  return (
    <div style={{ position: "relative", width: "100%", background: "#f8fafc", borderRadius: 8 }}
      onMouseMove={handleMouseMove}
    >
      <ComposableMap
        projectionConfig={{ scale: 147, center: [10, 10] }}
        style={{ width: "100%", height: "auto" }}
      >
        <ZoomableGroup zoom={1}>
          <Geographies geography={GEO_URL}>
            {({ geographies }: { geographies: GeoType[] }) =>
              geographies.map((geo) => {
                const numericId = parseInt(geo.id, 10);
                const cc = NUMERIC_TO_A2[numericId];
                const bucket = cc ? dataMap.get(cc) : undefined;
                const fill = bucket ? getColor(bucket.count, bucket.max_severity) : "#e2e8f0";
                const hasData = !!bucket;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover:   { outline: "none", fill: hasData ? fill : "#cbd5e1", opacity: hasData ? 0.85 : 1, cursor: hasData ? "pointer" : "default" },
                      pressed: { outline: "none" },
                    }}
                    onMouseEnter={(evt) => handleMouseEnter(geo, evt)}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 12, left: 16,
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(255,255,255,0.92)", borderRadius: 6,
        padding: "6px 10px", border: "1px solid #e2e8f0",
        fontSize: 11, color: "#64748b",
      }}>
        <span>Fewer</span>
        {["#fef9c3","#fde68a","#fbbf24","#f97316","#ef4444","#dc2626","#7f1d1d"].map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c }} />
        ))}
        <span>More</span>
        <div style={{ width: 1, height: 14, background: "#e2e8f0", margin: "0 4px" }} />
        <div style={{ width: 14, height: 14, borderRadius: 3, background: "#e2e8f0" }} />
        <span>No data</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "fixed",
          left: tooltip.x + 14,
          top: tooltip.y - 48,
          pointerEvents: "none",
          zIndex: 9999,
          background: "#0f172a",
          color: "#f8fafc",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 13,
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {COUNTRY_FLAGS[tooltip.cc] ?? "🌐"} {tooltip.country}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700 }}>
              {tooltip.count.toLocaleString()}
            </span>
            <span style={{ color: "#94a3b8" }}>active shortages</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
              textTransform: "uppercase", letterSpacing: "0.05em",
              background: sevColor[tooltip.max_severity] ?? "#64748b",
              color: "#fff",
            }}>
              {tooltip.max_severity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
