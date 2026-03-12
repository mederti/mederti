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
import { X } from "lucide-react";

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

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", AT: "🇦🇹", BE: "🇧🇪", BR: "🇧🇷", CA: "🇨🇦", CH: "🇨🇭",
  CZ: "🇨🇿", DE: "🇩🇪", DK: "🇩🇰", ES: "🇪🇸", EU: "🇪🇺", FI: "🇫🇮",
  FR: "🇫🇷", GB: "🇬🇧", HU: "🇭🇺", IE: "🇮🇪", IT: "🇮🇹", JP: "🇯🇵",
  NL: "🇳🇱", NO: "🇳🇴", NZ: "🇳🇿", SE: "🇸🇪", SG: "🇸🇬", US: "🇺🇸",
};

export default function DashboardClient() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [countryName, setCountryName] = useState<string>("");

  const handleCountryClick = useCallback((cc: string, name: string) => {
    if (countryFilter === cc) {
      setCountryFilter(null);
      setCountryName("");
    } else {
      setCountryFilter(cc);
      setCountryName(name);
    }
  }, [countryFilter]);

  const clearFilter = useCallback(() => {
    setCountryFilter(null);
    setCountryName("");
  }, []);

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

      {/* Main content */}
      <div
        style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}
      >
        {/* 1. Global Situation Banner */}
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
          <SituationBanner />
        </section>

        {/* 2. Predicted Supply Risks */}
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
          <PredictedSupplyRisks />
        </section>

        {/* 3. Regional Supply Map */}
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
          />
        </section>

        {/* Country filter indicator */}
        {countryFilter && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              background: "#f0fdfa",
              border: "1px solid #ccfbf1",
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
              color: "#0f172a",
            }}
          >
            <span style={{ fontSize: 16 }}>{FLAGS[countryFilter] ?? "🌐"}</span>
            <span>
              Showing: <strong>{countryName || countryFilter}</strong>
            </span>
            <button
              onClick={clearFilter}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginLeft: "auto",
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #ccfbf1",
                background: "#fff",
                fontSize: 12,
                color: "#64748b",
                cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}
            >
              clear filter
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}

        {/* Two-column layout: Alerts + Search */}
        <div
          className="db-two-col"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 20,
          }}
        >
          {/* Shortage Alerts */}
          <section>
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
            <ShortageAlerts countryFilter={countryFilter} />
          </section>

          {/* Medicine Search */}
          <section>
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
              Search
            </div>
            <MedicineSearch />
          </section>
        </div>

        {/* Critical Medicines Watchlist */}
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
          <CriticalWatchlist />
        </section>
      </div>

      <SiteFooter />

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .db-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
