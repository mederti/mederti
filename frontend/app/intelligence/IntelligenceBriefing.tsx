"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, ChevronRight } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface BriefingItem {
  lead_phrase: string;
  body: string;
  signal_strength: "high" | "medium" | "low";
  related_country_codes?: string[];
}

interface Briefing {
  market_pulse: string;
  insights: BriefingItem[];
  watch_list: string[];
  generated_at?: string;
  cached?: boolean;
  /* legacy field — backwards compat */
  headline?: string;
}

const SIGNAL_DOT: Record<string, string> = {
  high:   "var(--crit)",
  medium: "var(--high)",
  low:    "var(--app-text-4)",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: false });
}

export default function IntelligenceBriefing() {
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function load(refresh: boolean = false) {
    if (refresh) setRefreshing(true);
    fetch(`/api/intelligence/briefing${refresh ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => { load(false); }, []);

  if (loading) {
    return (
      <section style={{ marginBottom: 56, padding: "32px 0", borderTop: "3px solid #0F172A", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ fontSize: 13, color: "var(--app-text-4)", fontStyle: "italic" }}>Composing today's brief…</div>
      </section>
    );
  }
  if (!data) return null;

  const generatedAt = data.generated_at || new Date().toISOString();

  return (
    <section style={{
      marginBottom: 56,
      borderTop: "3px solid #0F172A",
      borderBottom: "1px solid var(--app-border)",
      padding: "28px 0 32px",
      position: "relative",
    }}>
      {/* Header bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        marginBottom: 18, flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Sparkles size={13} color="#0D9488" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", color: "#0F172A", textTransform: "uppercase" }}>
              The Pharma Brief
            </span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>·</span>
            <span style={{ fontSize: 11, color: "#64748B" }}>by Mederti</span>
          </div>
          <div style={{ fontSize: 13, color: "#475569", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            {formatDate(generatedAt)} · catch up on the global pharmaceutical supply stories that matter
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Regenerate brief"
          style={{
            padding: "6px 12px", fontSize: 11, fontWeight: 600,
            background: "white", color: "#475569",
            border: "1px solid var(--app-border)", borderRadius: 4,
            cursor: refreshing ? "wait" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <RefreshCw size={11} className={refreshing ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Market pulse — kicker */}
      {data.market_pulse && (
        <div style={{
          padding: "16px 20px",
          background: "var(--teal-bg, #f0fdfa)",
          borderLeft: "3px solid var(--teal)",
          marginBottom: 28,
          fontFamily: "Georgia, serif",
          fontSize: 17,
          lineHeight: 1.5,
          color: "var(--app-text)",
          fontStyle: "italic",
        }}>
          {data.market_pulse}
        </div>
      )}

      {/* Brief items — single column, editorial */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {data.insights.slice(0, 4).map((item, i) => (
          <article key={i} style={{
            padding: "20px 0",
            borderTop: i === 0 ? "none" : "1px solid var(--app-border)",
            position: "relative",
            paddingLeft: 22,
          }}>
            {/* Signal dot */}
            <span
              title={`${item.signal_strength} signal`}
              style={{
                position: "absolute", left: 0, top: 28,
                width: 8, height: 8, borderRadius: "50%",
                background: SIGNAL_DOT[item.signal_strength] ?? SIGNAL_DOT.low,
              }}
            />

            <p style={{
              margin: 0,
              fontFamily: "Georgia, serif",
              fontSize: 16.5,
              lineHeight: 1.65,
              color: "#1E293B",
            }}>
              <strong style={{ fontWeight: 700, color: "#0F172A" }}>
                {item.lead_phrase}
              </strong>
              {item.lead_phrase && !item.lead_phrase.endsWith(".") ? " " : " "}
              <span>{item.body}</span>
              {item.related_country_codes && item.related_country_codes.length > 0 && (
                <span style={{ marginLeft: 10, fontSize: 14, opacity: 0.85 }}>
                  {item.related_country_codes.slice(0, 5).map(c => FLAGS[c] ?? c).join(" ")}
                </span>
              )}
            </p>
          </article>
        ))}
      </div>

      {/* Watch list — bottom */}
      {data.watch_list && data.watch_list.length > 0 && (
        <div style={{
          marginTop: 28, paddingTop: 20,
          borderTop: "1px solid var(--app-border)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", color: "#0F172A", textTransform: "uppercase", marginBottom: 12 }}>
            Watch list — next 30 days
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontFamily: "Georgia, serif", fontSize: 14, color: "#475569" }}>
            {data.watch_list.slice(0, 8).map((w, i, arr) => (
              <span key={i}>
                {w}{i < arr.length - 1 ? "  ·" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 24, paddingTop: 14,
        borderTop: "1px solid var(--app-border)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ fontSize: 11, color: "#94A3B8", fontStyle: "italic" }}>
          Composed by Mederti's analyst AI · refreshed every 6 hours · {formatTime(generatedAt)}
        </div>
        <a href="#shortage-reports" style={{
          fontSize: 12, fontWeight: 600, color: "#0D9488",
          textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          Read the deeper analysis <ChevronRight size={12} />
        </a>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}
