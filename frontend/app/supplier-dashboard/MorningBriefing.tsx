"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, ChevronRight, Eye, AlertTriangle, TrendingUp, Compass, Clock } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface BriefingItem {
  headline: string;
  body: string;
  signal_strength: "high" | "medium" | "low";
  recommended_action: string;
  related_drug_ids?: string[];
  related_country_codes?: string[];
}

interface Briefing {
  generated_for_date: string;
  market_pulse: string;
  insights: BriefingItem[];
  watch_list: string[];
  generated_at?: string;
  cached?: boolean;
  profile_required?: boolean;
}

const SIGNAL_STYLE: Record<string, { color: string; bg: string; border: string; label: string; icon: React.ReactNode }> = {
  high:   { color: "var(--crit)",      bg: "var(--crit-bg)",      border: "var(--crit-b)",      label: "HIGH SIGNAL",   icon: <AlertTriangle size={12} /> },
  medium: { color: "var(--high)",      bg: "var(--high-bg)",      border: "var(--high-b)",      label: "MEDIUM",        icon: <TrendingUp size={12} /> },
  low:    { color: "var(--app-text-3)", bg: "var(--app-bg)",       border: "var(--app-border)",  label: "FYI",           icon: <Eye size={12} /> },
};

export default function MorningBriefing() {
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load(refresh: boolean = false) {
    if (refresh) setRefreshing(true);
    fetch(`/api/supplier/briefing${refresh ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(String(e)))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => { load(false); }, []);

  if (loading) {
    return (
      <div style={skeletonStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={16} color="var(--teal)" />
          <span style={{ fontSize: 13, color: "var(--app-text-4)" }}>Generating today's briefing…</span>
        </div>
      </div>
    );
  }

  if (data?.profile_required || error) {
    return null; // silent fail — don't break dashboard for non-suppliers
  }

  if (!data) return null;

  return (
    <section style={{
      marginTop: 24, marginBottom: 32,
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      color: "white",
      borderRadius: 14,
      padding: 28,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Subtle pattern accent */}
      <div style={{
        position: "absolute", top: 0, right: 0, width: 200, height: 200,
        background: "radial-gradient(circle at top right, rgba(94,234,212,0.15), transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, position: "relative" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Sparkles size={16} color="#5EEAD4" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#5EEAD4", textTransform: "uppercase" }}>
              Strategic Briefing
            </span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>·</span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>
              {new Date(data.generated_for_date || Date.now()).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4, margin: 0, color: "white", maxWidth: 820, fontFamily: "var(--font-inter), sans-serif" }}>
            {data.market_pulse}
          </h2>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Regenerate briefing"
          style={{
            padding: "6px 10px", fontSize: 11, fontWeight: 600,
            background: "rgba(255,255,255,0.1)", color: "#CADCFC",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
            cursor: refreshing ? "wait" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <RefreshCw size={11} className={refreshing ? "spin" : ""} />
          {refreshing ? "Updating…" : "Refresh"}
        </button>
      </div>

      {/* Insights */}
      <div style={{ display: "grid", gridTemplateColumns: data.insights.length >= 3 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 14, marginBottom: 20, position: "relative" }}>
        {data.insights.slice(0, 3).map((item, i) => {
          const sig = SIGNAL_STYLE[item.signal_strength] ?? SIGNAL_STYLE.low;
          return (
            <div key={i} style={{
              padding: 18,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                padding: "3px 8px", borderRadius: 4,
                background: sig.bg, color: sig.color, border: `1px solid ${sig.border}`,
                display: "inline-flex", alignItems: "center", gap: 4,
                width: "fit-content",
              }}>
                {sig.icon}
                {sig.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "white", lineHeight: 1.35 }}>
                {item.headline}
              </div>
              <div style={{ fontSize: 12, color: "#CADCFC", lineHeight: 1.55, flex: 1 }}>
                {item.body}
              </div>
              {item.related_country_codes && item.related_country_codes.length > 0 && (
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  {item.related_country_codes.slice(0, 6).map(c => FLAGS[c] ?? c).join(" ")}
                </div>
              )}
              <div style={{
                marginTop: 6, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,0.15)",
                fontSize: 11, color: "#94A3B8", display: "flex", alignItems: "flex-start", gap: 6,
              }}>
                <Compass size={12} color="#5EEAD4" style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{item.recommended_action}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Watch list */}
      {data.watch_list && data.watch_list.length > 0 && (
        <div style={{ paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.1)", position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94A3B8", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={11} />
            Watch list — next 30 days
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.watch_list.slice(0, 8).map((w, i) => (
              <span key={i} style={{
                fontSize: 11, padding: "4px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4, color: "#CADCFC",
              }}>
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 16, fontSize: 10, color: "#64748B", textAlign: "right", position: "relative" }}>
        Generated by Mederti AI · {data.cached ? "cached" : "fresh"} · {new Date(data.generated_at || Date.now()).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}

const skeletonStyle: React.CSSProperties = {
  marginTop: 24, marginBottom: 24,
  padding: 20, background: "var(--app-bg)",
  border: "1px dashed var(--app-border)", borderRadius: 10,
};
