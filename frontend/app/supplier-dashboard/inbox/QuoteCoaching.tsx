"use client";

import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, Clock, Award } from "lucide-react";

interface Coaching {
  suggested_price_range_low: number | null;
  suggested_price_range_high: number | null;
  currency: string | null;
  pricing_rationale: string;
  win_probability_pct: number;
  response_timing_advice: string;
  differentiators_to_highlight: string[];
  confidence: string;
}

export default function QuoteCoaching({ enquiryId }: { enquiryId: string }) {
  const [data, setData] = useState<Coaching | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/supplier/insight/quote-coaching/${enquiryId}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [enquiryId]);

  if (loading) {
    return (
      <div style={panelStyle}>
        <Header />
        <div style={{ color: "#94A3B8", fontSize: 12 }}>Analysing this opportunity…</div>
      </div>
    );
  }

  if (!data) return null;

  const winColor =
    data.win_probability_pct >= 60 ? "#5EEAD4" :
    data.win_probability_pct >= 35 ? "#FBBF24" : "#F87171";

  return (
    <div style={panelStyle}>
      <Header />

      {/* Win probability arc */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: `conic-gradient(${winColor} ${data.win_probability_pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%", background: "#0F172A",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: winColor, fontWeight: 700, fontSize: 14, fontFamily: "var(--font-dm-mono), monospace",
          }}>
            {data.win_probability_pct}%
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#5EEAD4", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
            Estimated win probability
          </div>
          <div style={{ fontSize: 12, color: "#CADCFC", lineHeight: 1.45 }}>
            Based on shortage severity, urgency, and competitive landscape.
          </div>
        </div>
      </div>

      {/* Suggested price */}
      {data.suggested_price_range_low !== null && data.suggested_price_range_high !== null ? (
        <div style={{ marginBottom: 14 }}>
          <SectionLabel><TrendingUp size={11} /> Suggested unit price</SectionLabel>
          <div style={{ fontSize: 22, fontWeight: 700, color: "white", fontFamily: "var(--font-dm-mono), monospace", marginTop: 2, marginBottom: 6 }}>
            {data.currency} {data.suggested_price_range_low?.toFixed(2)} – {data.suggested_price_range_high?.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: "#CADCFC", lineHeight: 1.5 }}>
            {data.pricing_rationale}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <SectionLabel><TrendingUp size={11} /> Pricing</SectionLabel>
          <div style={{ fontSize: 12, color: "#CADCFC", lineHeight: 1.5, marginTop: 4 }}>
            {data.pricing_rationale}
          </div>
        </div>
      )}

      {/* Response timing */}
      <div style={{ marginBottom: 14 }}>
        <SectionLabel><Clock size={11} /> Response timing</SectionLabel>
        <div style={{ fontSize: 12, color: "#CADCFC", lineHeight: 1.5, marginTop: 4 }}>
          {data.response_timing_advice}
        </div>
      </div>

      {/* Differentiators */}
      {data.differentiators_to_highlight.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <SectionLabel><Award size={11} /> Highlight in your quote</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {data.differentiators_to_highlight.map((d, i) => (
              <span key={i} style={{
                fontSize: 11, padding: "4px 8px",
                background: "rgba(94,234,212,0.1)", color: "#5EEAD4",
                border: "1px solid rgba(94,234,212,0.25)", borderRadius: 4,
              }}>
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <Sparkles size={13} color="#5EEAD4" />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#5EEAD4", textTransform: "uppercase" }}>
        AI Quote Coach
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#94A3B8", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
      {children}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  padding: 18,
  background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
  borderRadius: 10,
  color: "white",
};
