"use client";

import type { PlatformStatsData } from "./landing-page-client";

function fmt(n: number): string {
  return n.toLocaleString("en-AU");
}

function fmtBig(n: number): string {
  if (n >= 100000) return `${Math.floor(n / 1000).toLocaleString("en-AU")},000+`;
  return n.toLocaleString("en-AU");
}

export function PlatformStats({ stats }: { stats: PlatformStatsData }) {
  const cards = [
    {
      label: "Active shortages",
      value: fmt(stats.activeShortages),
      sub: `Across ${stats.countries} countries`,
      live: true,
    },
    {
      label: "Drug listings",
      value: fmtBig(stats.totalCatalogue),
      sub: "Approved drugs tracked globally",
      badge: "US · CA · AU · GB · EU · JP",
    },
    {
      label: "Shortage events",
      value: fmt(stats.totalShortages),
      sub: "Historical records from 2015",
      badge: "Updated daily",
    },
    {
      label: "Countries monitored",
      value: String(stats.countries),
      sub: "Regulatory authorities",
      badge: "TGA · FDA · MHRA · EMA + 9",
    },
    {
      label: "Recalls tracked",
      value: fmt(stats.totalRecalls),
      sub: "Across 6 markets",
      live: true,
    },
    {
      label: "Regulatory sources",
      value: String(stats.sources),
      sub: "Live data sources aggregated",
      badge: `${Math.min(stats.sources, 26)} active`,
    },
    {
      label: "Anticipated shortages",
      value: fmt(stats.anticipatedShortages),
      sub: "Early warnings before they hit",
      live: true,
    },
    {
      label: "Scrapers running",
      value: String(stats.scrapers),
      sub: "Automated monitors, 24/7",
      badge: "Every 4 hours",
    },
  ];

  return (
    <div style={{
      background: "#0d1117",
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.07)",
      boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
      maxWidth: 900,
      margin: "0 auto",
    }}>
      {/* Fake browser titlebar */}
      <div style={{
        background: "#161b24",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        {["#3a3a3c", "#3a3a3c", "#3a3a3c"].map((c, i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
        ))}
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginLeft: 8, fontFamily: "monospace" }}>
          mederti.vercel.app
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ padding: 20 }}>
        <div className="lp-stats-cards" style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}>
          {cards.map((card, i) => (
            <div key={i} style={{
              background: "#161b24",
              borderRadius: 8,
              padding: "18px 16px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{
                fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)",
                marginBottom: 10,
              }}>
                {card.label}
              </div>
              <div style={{
                fontSize: 28, fontWeight: 600, color: "#ffffff",
                letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 4,
              }}>
                {card.value}
              </div>
              <div style={{
                fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.4, marginTop: 6,
              }}>
                {card.sub}
              </div>
              {card.live && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 9, fontWeight: 500, marginTop: 8,
                  padding: "2px 7px", borderRadius: 4,
                  border: "1px solid rgba(220,38,38,0.2)",
                  background: "rgba(220,38,38,0.05)",
                  color: "#dc2626",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#dc2626", display: "inline-block" }} />
                  Live
                </div>
              )}
              {card.badge && (
                <div style={{
                  display: "inline-flex", alignItems: "center",
                  fontSize: 9, fontWeight: 500, marginTop: 8,
                  padding: "2px 7px", borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.35)",
                }}>
                  {card.badge}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
