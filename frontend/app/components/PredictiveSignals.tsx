"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, AlertTriangle, ArrowRight, Star } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪",
  EU: "🇪🇺", AT: "🇦🇹", SE: "🇸🇪", DK: "🇩🇰",
};

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "the United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NZ: "New Zealand",
  IE: "Ireland", NL: "the Netherlands", BE: "Belgium",
};

const SEV_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", label: "Critical" },
  high:     { color: "var(--high)", bg: "var(--high-bg)", label: "High" },
  medium:   { color: "var(--med)",  bg: "var(--med-bg)",  label: "Medium" },
  low:      { color: "var(--low)",  bg: "var(--low-bg)",  label: "Low" },
};

interface Result {
  drug_id: string;
  drug_name: string;
  peer_count: number;
  peers: string[];
  worst_severity: string;
  oldest_start: string | null;
  days_lead: number | null;
  who_essential: boolean;
}

interface Response {
  country: string;
  peer_set: string[];
  min_peers: number;
  total_candidates: number;
  results: Result[];
}

interface PredictiveSignalsProps {
  country?: string;
  limit?: number;
  compact?: boolean;
}

export default function PredictiveSignals({ country = "GB", limit = 8, compact = false }: PredictiveSignalsProps) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/predictive-signals?country=${country}&limit=${limit}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [country, limit]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: "var(--app-text-4)", fontStyle: "italic" }}>
        Reading peer-market shortage signals…
      </div>
    );
  }
  if (!data || data.results.length === 0) return null;

  const countryName = COUNTRY_NAMES[country] ?? country;

  return (
    <section style={{
      background: "white",
      border: "1px solid var(--app-border)",
      borderRadius: 12,
      padding: compact ? 16 : 20,
      marginBottom: 24,
      fontFamily: "var(--font-inter), sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Compass size={14} color="var(--teal)" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--teal)" }}>
            Predictive signals · {country}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
          {data.total_candidates} drugs flagged
        </span>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--app-text)", margin: "4px 0 4px", lineHeight: 1.35 }}>
        Drugs short in peer markets but not yet in {countryName}.
      </h3>
      <p style={{ fontSize: 12.5, color: "var(--app-text-3)", lineHeight: 1.55, margin: "0 0 14px", maxWidth: 640 }}>
        When a drug is short in three or more peer markets at once, the cause is usually upstream — an API or finished-dose failure that crosses borders. The shortage tends to reach the remaining markets within 60-90 days.
      </p>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.results.slice(0, limit).map((r) => {
          const sev = SEV_STYLE[r.worst_severity] ?? SEV_STYLE.low;
          return (
            <Link
              key={r.drug_id}
              href={`/drugs/${r.drug_id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 90px auto",
                gap: 14,
                alignItems: "center",
                padding: "10px 12px",
                background: "var(--app-bg)",
                border: "1px solid var(--app-border)",
                borderRadius: 6,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--app-text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.drug_name}
                </span>
                {r.who_essential && (
                  <span title="WHO Essential Medicine" style={{ display: "inline-flex", alignItems: "center", color: "var(--teal)", flexShrink: 0 }}>
                    <Star size={11} fill="currentColor" />
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 8px",
                background: sev.bg, color: sev.color, borderRadius: 4,
                letterSpacing: "0.04em", textAlign: "center",
              }}>
                {sev.label}
              </span>
              <span style={{ fontSize: 13, fontFamily: "var(--font-dm-mono), monospace", color: "var(--app-text-3)" }}>
                {r.peers.slice(0, 5).map((c) => FLAGS[c] ?? c).join(" ")}
                {r.peers.length > 5 && <span style={{ fontSize: 11, color: "var(--app-text-4)", marginLeft: 4 }}>+{r.peers.length - 5}</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                {r.peer_count} mkts · {r.days_lead ?? "?"}d
              </span>
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      {data.total_candidates > limit && (
        <Link
          href="/intelligence/calendar"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            marginTop: 12, fontSize: 12, color: "var(--teal)",
            fontWeight: 600, textDecoration: "none",
          }}
        >
          + {data.total_candidates - limit} more flagged drugs <ArrowRight size={12} />
        </Link>
      )}
    </section>
  );
}
