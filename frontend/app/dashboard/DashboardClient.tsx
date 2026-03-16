"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import SituationBanner from "./SituationBanner";
import PredictedSupplyRisks from "./PredictedSupplyRisks";
import ShortageAlerts from "./ShortageAlerts";
import MedicineSearch from "./MedicineSearch";
import CriticalWatchlist from "./CriticalWatchlist";
import { ChevronDown } from "lucide-react";

/* Dynamic import for the map — no SSR (uses browser DOM for SVG) */
const RegionalSupplyMap = dynamic(() => import("./RegionalSupplyMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 400,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#94a3b8",
        fontSize: 13,
      }}
    >
      Loading map…
    </div>
  ),
});

export type TimePeriod = "24h" | "7d" | "30d" | "90d" | null;

const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "HR", name: "Croatia", flag: "🇭🇷" },
  { code: "CZ", name: "Czechia", flag: "🇨🇿" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "EU", name: "European Union", flag: "🇪🇺" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "GR", name: "Greece", flag: "🇬🇷" },
  { code: "HU", name: "Hungary", flag: "🇭🇺" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "IL", name: "Israel", flag: "🇮🇱" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "PR", name: "Puerto Rico", flag: "🇵🇷" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "TR", name: "Türkiye", flag: "🇹🇷" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾" },
  { code: "VE", name: "Venezuela", flag: "🇻🇪" },
];

const TIME_PERIODS: { value: TimePeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: null, label: "All" },
];

export default function DashboardClient() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [countryName, setCountryName] = useState<string>("");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(null);

  const handleCountryClick = useCallback(
    (cc: string, name: string) => {
      if (countryFilter === cc) {
        setCountryFilter(null);
        setCountryName("");
      } else {
        setCountryFilter(cc);
        setCountryName(name);
      }
    },
    [countryFilter]
  );

  const handleCountryDropdown = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === "") {
        setCountryFilter(null);
        setCountryName("");
      } else {
        const c = COUNTRIES.find((x) => x.code === val);
        setCountryFilter(val);
        setCountryName(c?.name ?? val);
      }
    },
    []
  );

  return (
    <div
      style={{
        background: "#f8fafc",
        minHeight: "100vh",
        color: "#0f172a",
        fontFamily: "var(--font-inter), sans-serif",
      }}
    >
      <SiteNav />

      {/* Header */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#0f172a",
                  margin: "0 0 4px",
                  letterSpacing: "-0.01em",
                }}
              >
                Operational Dashboard
              </h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
                Real-time pharmaceutical shortage intelligence across global
                regulatory sources.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#94a3b8",
                fontFamily: "var(--font-dm-mono), monospace",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#16a34a",
                  display: "inline-block",
                }}
              />
              Live
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar: Search + Country + Period on one line */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          position: "sticky",
          top: 64,
          zIndex: 40,
        }}
      >
        <div
          className="db-filter-bar"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Medicine Search — takes remaining space */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <MedicineSearch />
          </div>

          {/* Country dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                whiteSpace: "nowrap",
              }}
            >
              Filter by
            </span>
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <select
                value={countryFilter ?? ""}
                onChange={handleCountryDropdown}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  padding: "7px 32px 7px 12px",
                  borderRadius: 8,
                  border: countryFilter
                    ? "1.5px solid #99f6e4"
                    : "1.5px solid #e2e8f0",
                  background: countryFilter ? "#f0fdfa" : "#f8fafc",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#0f172a",
                  cursor: "pointer",
                  outline: "none",
                  fontFamily: "var(--font-inter), sans-serif",
                  minWidth: 180,
                }}
              >
                <option value="">🌐  World (All Countries)</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag}  {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 14,
                  height: 14,
                  pointerEvents: "none",
                  color: "#94a3b8",
                }}
              />
            </div>
          </div>

          {/* Time period pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Period
            </span>
            <div
              style={{
                display: "flex",
                gap: 2,
                background: "#f1f5f9",
                borderRadius: 8,
                padding: 3,
              }}
            >
              {TIME_PERIODS.map((tp) => {
                const active = timePeriod === tp.value;
                return (
                  <button
                    key={tp.label}
                    onClick={() => setTimePeriod(tp.value)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 6,
                      border: "none",
                      background: active ? "#fff" : "transparent",
                      color: active ? "#0f172a" : "#64748b",
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      fontFamily: "var(--font-dm-mono), monospace",
                      boxShadow: active
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {tp.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div
        style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}
      >

        {/* 2. Global Situation Banner */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Global Situation
          </div>
          <SituationBanner
            countryFilter={countryFilter}
            timePeriod={timePeriod}
          />
        </section>

        {/* 3. Predicted Supply Risks */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Predictive Intelligence
          </div>
          <PredictedSupplyRisks countryFilter={countryFilter} />
        </section>

        {/* 4. Regional Supply Map */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Regional Overview
          </div>
          <RegionalSupplyMap
            onCountryClick={handleCountryClick}
            activeFilter={countryFilter}
            timePeriod={timePeriod}
          />
        </section>

        {/* 5. Shortage Alerts (full-width) */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Alerts
          </div>
          <ShortageAlerts
            countryFilter={countryFilter}
            timePeriod={timePeriod}
          />
        </section>

        {/* 6. Critical Medicines Watchlist */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            Watchlist
          </div>
          <CriticalWatchlist countryFilter={countryFilter} />
        </section>
      </div>

      <SiteFooter />

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 900px) {
          .db-filter-bar {
            flex-wrap: wrap !important;
          }
          .db-filter-bar > div:first-child {
            flex-basis: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}
