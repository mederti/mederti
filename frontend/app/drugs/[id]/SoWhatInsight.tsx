"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

interface Payload {
  headline: string;
  body: string;
  signal: "elevated" | "stable" | "improving" | "worsening";
  confidence: "high" | "medium" | "low";
  cached?: boolean;
  generated_at?: string;
}

const SIGNAL_STYLE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  worsening: { color: "var(--crit)", icon: <TrendingDown size={11} />, label: "Worsening" },
  elevated:  { color: "var(--high)", icon: <AlertTriangle size={11} />, label: "Elevated" },
  improving: { color: "var(--low)",  icon: <TrendingUp size={11} />,   label: "Improving" },
  stable:    { color: "var(--app-text-3)", icon: <Minus size={11} />,  label: "Stable" },
};

export default function SoWhatInsight({ drugId }: { drugId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function load(refresh: boolean = false) {
    if (refresh) setRefreshing(true);
    fetch(`/api/drugs/${drugId}/so-what${refresh ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => { load(false); }, [drugId]);

  if (loading) {
    return (
      <div style={skeletonStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={12} color="var(--teal)" />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--teal)", textTransform: "uppercase" }}>
            So what
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--app-text-4)", fontStyle: "italic" }}>
          Reading today's signals…
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sig = SIGNAL_STYLE[data.signal] ?? SIGNAL_STYLE.stable;

  return (
    <div style={{
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      color: "white",
      borderRadius: 10,
      padding: 16,
      marginBottom: 14,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={11} color="#5EEAD4" />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#5EEAD4", textTransform: "uppercase" }}>
            So what
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px",
            background: "rgba(255,255,255,0.08)", color: sig.color,
            borderRadius: 3, letterSpacing: "0.04em",
            display: "inline-flex", alignItems: "center", gap: 3,
            marginLeft: 6,
          }}>
            {sig.icon} {sig.label}
          </span>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Regenerate"
          style={{
            background: "none", border: "none", cursor: refreshing ? "wait" : "pointer",
            color: "#94A3B8", padding: 2, display: "flex",
          }}
        >
          <RefreshCw size={11} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {/* Headline */}
      <div style={{
        fontSize: 13, fontWeight: 700, color: "white",
        marginBottom: 8, lineHeight: 1.35,
        fontFamily: "Georgia, serif",
      }}>
        {data.headline}
      </div>

      {/* Body */}
      <div style={{ fontSize: 12.5, color: "#CADCFC", lineHeight: 1.6, fontFamily: "Georgia, serif" }}>
        {data.body}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)",
        fontSize: 10, color: "#64748B", display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontStyle: "italic" }}>Composed by Mederti from live signals</span>
        <span>Confidence: <span style={{ color: data.confidence === "high" ? "var(--low)" : data.confidence === "medium" ? "var(--high)" : "var(--app-text-4)" }}>{data.confidence}</span></span>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const skeletonStyle: React.CSSProperties = {
  padding: 14,
  background: "var(--app-bg)",
  border: "1px dashed var(--app-border)",
  borderRadius: 10,
  marginBottom: 14,
};
