"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
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
  CL: "🇨🇱", CN: "🇨🇳", CO: "🇨🇴", CZ: "🇨🇿", DE: "🇩🇪", DK: "🇩🇰",
  ES: "🇪🇸", EU: "🇪🇺", FI: "🇫🇮", FR: "🇫🇷", GB: "🇬🇧", GR: "🇬🇷",
  HR: "🇭🇷", HU: "🇭🇺", IE: "🇮🇪", IL: "🇮🇱", IN: "🇮🇳", IT: "🇮🇹",
  JP: "🇯🇵", KR: "🇰🇷", MX: "🇲🇽", NL: "🇳🇱", NG: "🇳🇬", NO: "🇳🇴",
  NZ: "🇳🇿", PL: "🇵🇱", PT: "🇵🇹", PR: "🇵🇷", SE: "🇸🇪", SG: "🇸🇬",
  TR: "🇹🇷", UA: "🇺🇦", US: "🇺🇸", UY: "🇺🇾", VE: "🇻🇪", ZA: "🇿🇦",
};

/* ── Country centre coordinates [longitude, latitude] ── */
const COUNTRY_CENTERS: Record<string, [number, number]> = {
  AU: [134, -25], AT: [14.5, 47.5], BE: [4.5, 50.8], BR: [-51, -10],
  CA: [-106, 56], CL: [-71, -35], CN: [104, 35], CO: [-74, 4],
  HR: [16, 45.2], CZ: [15.5, 49.8], DK: [10, 56], FI: [26, 64],
  FR: [2.5, 46.5], DE: [10.5, 51.2], GR: [22, 39], HU: [19.5, 47.2],
  IN: [79, 21], IE: [-8, 53.5], IL: [35, 31.5], IT: [12.5, 42.5],
  JP: [138, 36], KR: [128, 36], MX: [-102, 23.5], NL: [5.3, 52.2],
  NZ: [174, -41], NG: [8, 10], NO: [10, 62], PL: [20, 52],
  PT: [-8.2, 39.5], PR: [-66.5, 18.2], SG: [104, 1.4], ZA: [25, -29],
  ES: [-3.7, 40.4], SE: [16, 62], CH: [8.2, 46.8], TR: [35.2, 39],
  UA: [31.2, 48.4], GB: [-2, 54], US: [-98, 39], UY: [-56, -33],
  VE: [-67, 8],
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
  timePeriod?: "24h" | "7d" | "30d" | "90d" | null;
}

/* ── Teal colour scale: #ccfbf1 (light) → #0d9488 (deep) ── */
function getTealColor(count: number, maxCount: number): string {
  if (count === 0) return "#ccfbf1";
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  const t = Math.pow(ratio, 0.5);
  const r = Math.round(204 + (13 - 204) * t);
  const g = Math.round(251 + (148 - 251) * t);
  const b = Math.round(241 + (136 - 241) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function getTealStroke(count: number, maxCount: number): string {
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  const t = Math.pow(ratio, 0.5);
  const r = Math.round(153 + (10 - 153) * t);
  const g = Math.round(220 + (120 - 220) * t);
  const b = Math.round(210 + (110 - 210) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

const MIN_R = 4;
const MAX_R = 26;

function getBubbleRadius(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return MIN_R;
  return Math.sqrt(count / maxCount) * (MAX_R - MIN_R) + MIN_R;
}

/* ── Pulse animation CSS (injected once) ── */
const PULSE_CSS = `
@keyframes mederti-pulse {
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50% { opacity: 0.2; transform: scale(1.6); }
}
`;

export default function RegionalSupplyMap({ onCountryClick, activeFilter, timePeriod }: Props) {
  const [data, setData] = useState<Map<string, CountryData>>(new Map());
  const [maxCount, setMaxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        let query = supabase
          .from("shortage_events")
          .select("country_code, country, severity")
          .in("status", ["active", "anticipated"]);

        if (timePeriod) {
          const MS: Record<string, number> = {
            "24h": 86400000, "7d": 604800000,
            "30d": 2592000000, "90d": 7776000000,
          };
          query = query.gte(
            "updated_at",
            new Date(Date.now() - (MS[timePeriod] ?? 0)).toISOString()
          );
        }

        const { data: rows } = await query.limit(10000);

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
  }, [timePeriod]);

  /* ── Sorted bubbles: largest first (behind), smallest on top ── */
  const sortedBubbles = useMemo(() => {
    const entries: Array<{ cc: string; d: CountryData }> = [];
    data.forEach((d, cc) => {
      if (COUNTRY_CENTERS[cc]) entries.push({ cc, d });
    });
    entries.sort((a, b) => b.d.count - a.d.count);
    return entries;
  }, [data]);

  /* ── Top 3 countries for pulse animation ── */
  const top3Set = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < Math.min(3, sortedBubbles.length); i++) {
      set.add(sortedBubbles[i].cc);
    }
    return set;
  }, [sortedBubbles]);

  const handleMouseMove = useCallback(
    (evt: React.MouseEvent) => {
      if (tooltip) setTooltip((t) => (t ? { ...t, x: evt.clientX, y: evt.clientY } : null));
    },
    [tooltip]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const handleBubbleEnter = useCallback(
    (cc: string, d: CountryData, evt: React.MouseEvent) => {
      setTooltip({
        x: evt.clientX,
        y: evt.clientY,
        cc,
        country: d.country,
        count: d.count,
        maxSeverity: d.maxSeverity,
      });
    },
    []
  );

  const handleBubbleClick = useCallback(
    (cc: string, d: CountryData) => {
      onCountryClick(cc, d.country);
    },
    [onCountryClick]
  );

  const sevBadge: Record<string, { color: string; bg: string }> = {
    critical: { color: "#fff", bg: "#dc2626" },
    high: { color: "#fff", bg: "#ea580c" },
    medium: { color: "#fff", bg: "#ca8a04" },
    low: { color: "#fff", bg: "#16a34a" },
  };

  /* ── Legend example counts ── */
  const legendCounts = useMemo(() => {
    if (maxCount === 0) return [1, 5, 10];
    const mid = Math.round(maxCount / 2);
    const low = Math.max(1, Math.round(maxCount / 6));
    return [low, mid, maxCount];
  }, [maxCount]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Inject pulse animation */}
      <style>{PULSE_CSS}</style>

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
            {/* Base map — neutral gray, no interactivity */}
            <Geographies geography={GEO_URL}>
              {({ geographies }: { geographies: GeoType[] }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#f1f5f9"
                    stroke="#e2e8f0"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: "#f1f5f9", cursor: "default" },
                      pressed: { outline: "none" },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Bubble markers — largest first (behind), smallest on top */}
            {sortedBubbles.map(({ cc, d }, idx) => {
              const coords = COUNTRY_CENTERS[cc];
              if (!coords) return null;
              const r = getBubbleRadius(d.count, maxCount);
              const fill = getTealColor(d.count, maxCount);
              const stroke = getTealStroke(d.count, maxCount);
              const isSelected = activeFilter === cc;
              const isPulse = top3Set.has(cc);
              const pulseDelay = isPulse
                ? `${sortedBubbles.findIndex((b) => b.cc === cc) * 0.4}s`
                : undefined;

              return (
                <Marker key={cc} coordinates={coords}>
                  {/* Pulse ring for top 3 */}
                  {isPulse && (
                    <circle
                      r={r}
                      fill={fill}
                      opacity={0.4}
                      style={{
                        transformOrigin: "center",
                        animation: `mederti-pulse 2.5s ease-in-out infinite`,
                        animationDelay: pulseDelay,
                      }}
                    />
                  )}
                  {/* Main bubble */}
                  <circle
                    r={r}
                    fill={fill}
                    fillOpacity={0.8}
                    stroke={isSelected ? "#065f46" : stroke}
                    strokeWidth={isSelected ? 2 : 1}
                    style={{ cursor: "pointer", transition: "stroke-width 0.15s" }}
                    onMouseEnter={(evt) => handleBubbleEnter(cc, d, evt)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleBubbleClick(cc, d)}
                  />
                  {/* Count label for large bubbles */}
                  {r >= 14 && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        fontSize: r >= 20 ? 10 : 8,
                        fontWeight: 700,
                        fill: "#fff",
                        pointerEvents: "none",
                        fontFamily: "var(--font-dm-mono), monospace",
                      }}
                    >
                      {d.count}
                    </text>
                  )}
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: "10px 0 14px",
              fontSize: 11,
              color: "#64748b",
            }}
          >
            {/* Bubble size examples */}
            {legendCounts.map((count, i) => {
              const r = getBubbleRadius(count, maxCount);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width={r * 2 + 4} height={r * 2 + 4}>
                    <circle
                      cx={r + 2}
                      cy={r + 2}
                      r={r}
                      fill={getTealColor(count, maxCount)}
                      fillOpacity={0.8}
                      stroke={getTealStroke(count, maxCount)}
                      strokeWidth={1}
                    />
                  </svg>
                  <span>{count}</span>
                </div>
              );
            })}
            <div style={{ width: 1, height: 12, background: "#e2e8f0", margin: "0 2px" }} />
            <span style={{ color: "#94a3b8" }}>shortages</span>
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
