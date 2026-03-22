"use client";

import type { PlatformStatsData } from "./landing-page-client";

function fmt(n: number): string {
  return n.toLocaleString("en-AU");
}

function fmtBig(n: number): string {
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
      badge: "US \u00b7 CA \u00b7 AU \u00b7 GB \u00b7 EU \u00b7 JP",
    },
    {
      label: "Shortage events",
      value: fmt(stats.totalShortages),
      sub: "Historical records from 2003",
      badge: "Updated daily",
    },
    {
      label: "Countries monitored",
      value: String(stats.countries),
      sub: "Regulatory authorities",
      badge: "TGA \u00b7 FDA \u00b7 MHRA \u00b7 EMA + 18",
    },
    {
      label: "Recalls tracked",
      value: fmt(stats.totalRecalls),
      sub: "Across 7 markets",
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
    <div className="lp-stats-cards" style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 12,
    }}>
      {cards.map((card, i) => (
        <div key={i} style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "28px 24px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)",
            marginBottom: 12,
          }}>
            {card.label}
          </div>
          <div style={{
            fontSize: 32, fontWeight: 600, color: "#ffffff",
            letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 6,
          }}>
            {card.value}
          </div>
          <div style={{
            fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 8,
          }}>
            {card.sub}
          </div>
          {card.live && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 9, fontWeight: 500, marginTop: 12,
              padding: "3px 8px", borderRadius: 4,
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
              fontSize: 9, fontWeight: 500, marginTop: 12,
              padding: "3px 8px", borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.35)",
            }}>
              {card.badge}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
