"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import type { Geography as GeoType } from "react-simple-maps";
import { MapPin } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/* ── ISO numeric → alpha-2 ── */
const NUM_TO_A2: Record<number, string> = {
  36: "AU", 40: "AT", 56: "BE", 76: "BR", 124: "CA", 152: "CL",
  156: "CN", 170: "CO", 191: "HR", 203: "CZ", 208: "DK", 246: "FI",
  250: "FR", 276: "DE", 300: "GR", 348: "HU", 356: "IN", 372: "IE",
  376: "IL", 380: "IT", 392: "JP", 410: "KR", 484: "MX", 528: "NL",
  554: "NZ", 566: "NG", 578: "NO", 616: "PL", 620: "PT", 630: "PR",
  702: "SG", 710: "ZA", 724: "ES", 752: "SE", 756: "CH", 792: "TR",
  804: "UA", 826: "GB", 840: "US", 858: "UY", 862: "VE",
};

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", AT: "🇦🇹", BE: "🇧🇪", BR: "🇧🇷", CA: "🇨🇦", CH: "🇨🇭",
  CZ: "🇨🇿", DE: "🇩🇪", DK: "🇩🇰", ES: "🇪🇸", EU: "🇪🇺", FI: "🇫🇮",
  FR: "🇫🇷", GB: "🇬🇧", HU: "🇭🇺", IE: "🇮🇪", IT: "🇮🇹", JP: "🇯🇵",
  KR: "🇰🇷", MX: "🇲🇽", NL: "🇳🇱", NO: "🇳🇴", NZ: "🇳🇿", SE: "🇸🇪",
  SG: "🇸🇬", US: "🇺🇸", ZA: "🇿🇦",
};

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface CountryData {
  count: number;
  country: string;
  maxSeverity: string;
}

interface TooltipState {
  x: number;
  y: number;
  cc: string;
  country: string;
  count: number;
  maxSeverity: string;
}

interface Props {
  onCountryClick: (countryCode: string, countryName: string) => void;
  activeFilter: string | null;
}

/* ── Teal colour scale: #ccfbf1 (light) → #0d9488 (deep) ── */
function getTealColor(count: number, maxCount: number): string {
  if (count === 0) return "#f1f5f9";
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  // Power curve for more visual differentiation at lower counts
  const t = Math.pow(ratio, 0.5);
  const r = Math.round(204 + (13 - 204) * t);
  const g = Math.round(251 + (148 - 251) * t);
  const b = Math.round(241 + (136 - 241) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function RegionalSupplyMap({ onCountryClick, activeFilter }: Props) {
  const [data, setData] = useState<Map<string, CountryData>>(new Map());
  const [maxCount, setMaxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        const { data: rows } = await supabase
          .from("shortage_events")
          .select("country_code, country, severity")
          .in("status", ["active", "anticipated"])
          .limit(10000);

        if (!rows) return;

        const map = new Map<string, CountryData>();
        for (const r of rows) {
          const cc = r.country_code ?? "";
          if (!cc) continue;
          const existing = map.get(cc);
          if (!existing) {
            map.set(cc, { count: 1, country: r.country ?? cc, maxSeverity: (r.severity ?? "low").toLowerCase() });
          } else {
            existing.count++;
            const es = SEV_ORDER[existing.maxSeverity] ?? 9;
            const ns = SEV_ORDER[(r.severity ?? "low").toLowerCase()] ?? 9;
            if (ns < es) existing.maxSeverity = (r.severity ?? "low").toLowerCase();
          }
        }

        let mx = 0;
        for (const d of map.values()) if (d.count > mx) mx = d.count;

        setData(map);
        setMaxCount(mx);
      } catch (err) {
        console.error("[RegionalSupplyMap] load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const handleMouseEnter = useCallback(
    (geo: GeoType, evt: React.MouseEvent<SVGPathElement>) => {
      const numericId = parseInt(geo.id, 10);
      const cc = NUM_TO_A2[numericId];
      if (!cc) return;
      const d = data.get(cc);
      if (!d) return;
      setTooltip({
        x: evt.clientX,
        y: evt.clientY,
        cc,
        country: d.country,
        count: d.count,
        maxSeverity: d.maxSeverity,
      });
    },
    [data]
  );

  const handleMouseMove = useCallback(
    (evt: React.MouseEvent) => {
      if (tooltip) setTooltip((t) => (t ? { ...t, x: evt.clientX, y: evt.clientY } : null));
    },
    [tooltip]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const handleClick = useCallback(
    (geo: GeoType) => {
      const numericId = parseInt(geo.id, 10);
      const cc = NUM_TO_A2[numericId];
      if (!cc) return;
      const d = data.get(cc);
      if (!d) return;
      onCountryClick(cc, d.country);
    },
    [data, onCountryClick]
  );

  const sevBadge: Record<string, { color: string; bg: string }> = {
    critical: { color: "#fff", bg: "#dc2626" },
    high: { color: "#fff", bg: "#ea580c" },
    medium: { color: "#fff", bg: "#ca8a04" },
    low: { color: "#fff", bg: "#16a34a" },
  };

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: "rgba(13,148,136,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <MapPin style={{ width: 14, height: 14, strokeWidth: 1.5 }} color="#0d9488" />
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
              Regional Supply Map
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8", display: "block", marginTop: 1 }}>
              Active shortages by country · click to filter
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: 11, color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
          }}
        >
          {data.size} countries
        </span>
      </div>

      {/* Map */}
      {loading ? (
        <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
          Loading map…
        </div>
      ) : (
        <div
          style={{ position: "relative", padding: "12px 20px 0" }}
          onMouseMove={handleMouseMove}
        >
          <ComposableMap
            projectionConfig={{ scale: 147, center: [10, 10] }}
            style={{ width: "100%", height: "auto", maxHeight: 400 }}
          >
            <ZoomableGroup zoom={1}>
              <Geographies geography={GEO_URL}>
                {({ geographies }: { geographies: GeoType[] }) =>
                  geographies.map((geo) => {
                    const numericId = parseInt(geo.id, 10);
                    const cc = NUM_TO_A2[numericId];
                    const d = cc ? data.get(cc) : undefined;
                    const fill = d ? getTealColor(d.count, maxCount) : "#f1f5f9";
                    const isSelected = activeFilter === cc;
                    const hasData = !!d;

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={isSelected ? "#0d9488" : fill}
                        stroke={isSelected ? "#065f46" : "#fff"}
                        strokeWidth={isSelected ? 1.5 : 0.5}
                        style={{
                          default: { outline: "none" },
                          hover: {
                            outline: "none",
                            fill: hasData ? "#0d9488" : "#e2e8f0",
                            cursor: hasData ? "pointer" : "default",
                          },
                          pressed: { outline: "none" },
                        }}
                        onMouseEnter={(evt) => handleMouseEnter(geo, evt)}
                        onMouseLeave={handleMouseLeave}
                        onClick={() => handleClick(geo)}
                      />
                    );
                  })
                }
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 0 14px",
              fontSize: 11,
              color: "#64748b",
            }}
          >
            <span>Fewer</span>
            {[0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((t, i) => {
              const r = Math.round(204 + (13 - 204) * Math.pow(t, 0.5));
              const g = Math.round(251 + (148 - 251) * Math.pow(t, 0.5));
              const b = Math.round(241 + (136 - 241) * Math.pow(t, 0.5));
              return (
                <div
                  key={i}
                  style={{
                    width: 24, height: 10, borderRadius: 2,
                    background: t === 0 ? "#f1f5f9" : `rgb(${r},${g},${b})`,
                    border: "1px solid #e2e8f0",
                  }}
                />
              );
            })}
            <span>More</span>
            <div style={{ width: 1, height: 12, background: "#e2e8f0", margin: "0 4px" }} />
            <div style={{ width: 14, height: 10, borderRadius: 2, background: "#f1f5f9", border: "1px solid #e2e8f0" }} />
            <span>No data</span>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div
              style={{
                position: "fixed",
                left: tooltip.x + 14,
                top: tooltip.y - 60,
                pointerEvents: "none",
                zIndex: 9999,
                background: "#0f172a",
                color: "#f8fafc",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {FLAGS[tooltip.cc] ?? "🌐"} {tooltip.country}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 16, fontWeight: 700 }}>
                  {tooltip.count.toLocaleString()}
                </span>
                <span style={{ color: "#94a3b8" }}>active shortage{tooltip.count !== 1 ? "s" : ""}</span>
                <span
                  style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    background: sevBadge[tooltip.maxSeverity]?.bg ?? "#64748b",
                    color: "#fff",
                  }}
                >
                  {tooltip.maxSeverity}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                Click to filter alerts
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
