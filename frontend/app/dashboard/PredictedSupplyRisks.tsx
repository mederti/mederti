"use client";

import { useEffect, useState, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Activity, TrendingUp } from "lucide-react";
import { truncateDrugName } from "@/lib/utils";
import { SEV_RANK, calculateRiskScore, riskStyle } from "@/lib/risk-score";

/* ── Flags ── */
const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}", US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}",
  CA: "\u{1F1E8}\u{1F1E6}", DE: "\u{1F1E9}\u{1F1EA}", FR: "\u{1F1EB}\u{1F1F7}",
  IT: "\u{1F1EE}\u{1F1F9}", ES: "\u{1F1EA}\u{1F1F8}", NZ: "\u{1F1F3}\u{1F1FF}",
  SG: "\u{1F1F8}\u{1F1EC}", EU: "\u{1F1EA}\u{1F1FA}", FI: "\u{1F1EB}\u{1F1EE}",
  IE: "\u{1F1EE}\u{1F1EA}", NO: "\u{1F1F3}\u{1F1F4}", CH: "\u{1F1E8}\u{1F1ED}",
  SE: "\u{1F1F8}\u{1F1EA}", AT: "\u{1F1E6}\u{1F1F9}", BE: "\u{1F1E7}\u{1F1EA}",
  NL: "\u{1F1F3}\u{1F1F1}", JP: "\u{1F1EF}\u{1F1F5}",
};

/* ── Types ── */
interface RiskItem {
  drugId: string;
  drugName: string;
  riskScore: number;
  riskLevel: "HIGH RISK" | "ELEVATED" | "WATCH";
  primarySignal: string;
  countries: string[];
  trending: boolean;
}

/* ── Component ── */
interface PredictedSupplyRisksProps {
  countryFilter?: string | null;
}

export default function PredictedSupplyRisks({ countryFilter }: PredictedSupplyRisksProps) {
  const [items, setItems] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        const now = Date.now();
        const d30 = new Date(now - 30 * 86400000).toISOString();
        const d60 = new Date(now - 60 * 86400000).toISOString();

        /* ── 3 parallel queries ── */
        let activeQ = supabase
          .from("shortage_events")
          .select("drug_id, country_code, severity, drugs(generic_name)")
          .eq("status", "active");
        let velocityQ = supabase
          .from("shortage_events")
          .select("drug_id, updated_at")
          .gte("updated_at", d60);

        if (countryFilter) {
          activeQ = activeQ.eq("country_code", countryFilter);
          velocityQ = velocityQ.eq("country_code", countryFilter);
        }

        const [activeRes, velocityRes, logRes] = await Promise.allSettled([
          activeQ.limit(5000),
          velocityQ.limit(5000),
          supabase
            .from("shortage_status_log")
            .select("drug_id, old_severity, new_severity")
            .gte("changed_at", d30)
            .limit(5000),
        ]);

        const activeData =
          activeRes.status === "fulfilled" ? (activeRes.value.data ?? []) : [];
        const velocityData =
          velocityRes.status === "fulfilled" ? (velocityRes.value.data ?? []) : [];
        const logData =
          logRes.status === "fulfilled" ? (logRes.value.data ?? []) : [];

        console.log("[PSR] active:", activeData.length, "velocity:", velocityData.length, "log:", logData.length);

        if (activeData.length === 0) {
          setError("No active shortage data available");
          return;
        }

        /* ── Aggregate by drug_id ── */
        const drugMap = new Map<
          string,
          {
            name: string;
            countries: Set<string>;
            maxSev: number;
            activeCount: number;
            last30: number;
            prior30: number;
            escalations: number;
            logEntries: number;
          }
        >();

        const d30ms = new Date(d30).getTime();

        // Seed map from active events
        for (const e of activeData) {
          const did = e.drug_id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const name = (e as any).drugs?.generic_name ?? "Unknown";
          if (!drugMap.has(did)) {
            drugMap.set(did, {
              name,
              countries: new Set(),
              maxSev: 0,
              activeCount: 0,
              last30: 0,
              prior30: 0,
              escalations: 0,
              logEntries: 0,
            });
          }
          const d = drugMap.get(did)!;
          d.activeCount++;
          if (e.country_code) d.countries.add(e.country_code);
          d.maxSev = Math.max(d.maxSev, SEV_RANK[e.severity] ?? 0);
        }

        // Velocity from recently updated events
        for (const e of velocityData) {
          const d = drugMap.get(e.drug_id);
          if (!d) continue;
          const t = new Date(e.updated_at).getTime();
          if (t >= d30ms) d.last30++;
          else d.prior30++;
        }

        // Escalation trajectory from status log
        for (const e of logData) {
          const d = drugMap.get(e.drug_id);
          if (!d) continue;
          d.logEntries++;
          const oldS = SEV_RANK[e.old_severity] ?? 0;
          const newS = SEV_RANK[e.new_severity] ?? 0;
          if (newS > oldS) d.escalations++;
        }

        /* ── Score each drug using shared utility ── */
        const scored: RiskItem[] = [];

        for (const [drugId, d] of drugMap) {
          const result = calculateRiskScore({
            last30: d.last30,
            prior30: d.prior30,
            countryCount: d.countries.size,
            logEntries: d.logEntries,
            escalations: d.escalations,
            maxSev: d.maxSev,
          });

          // Exclude drugs with insufficient signal
          if (result.riskScore < 15) continue;

          scored.push({
            drugId,
            drugName: d.name,
            riskScore: result.riskScore,
            riskLevel: result.riskLevel,
            primarySignal: result.primarySignal,
            countries: Array.from(d.countries).slice(0, 6),
            trending: result.trending,
          });
        }

        scored.sort((a, b) => b.riskScore - a.riskScore);
        console.log("[PSR] scored:", scored.length, "top:", scored[0]?.riskScore);
        setItems(scored.slice(0, 10));
      } catch (err) {
        console.error("[PredictedSupplyRisks] load error:", err);
        setError("Failed to analyse shortage patterns");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [countryFilter]);

  /* ── Render ── */
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(15,23,42,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            <Activity
              style={{ width: 16, height: 16, strokeWidth: 1.5 }}
              color="#0F172A"
            />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
              Predicted Supply Risks
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              AI-identified medicines at risk of shortage in the next 30–90 days
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
            flexShrink: 0,
          }}
        >
          {items.length} identified
        </span>
      </div>

      {/* Column headers */}
      <div
        className="psr-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr 170px 90px 180px 80px",
          gap: 8,
          padding: "8px 20px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
          alignItems: "center",
        }}
      >
        {["#", "Medicine", "Risk Score", "Level", "Signal", "Spread"].map(
          (h) => (
            <span
              key={h}
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#94a3b8",
              }}
            >
              {h}
            </span>
          )
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div
          style={{
            padding: "48px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Analysing shortage patterns…
        </div>
      ) : error ? (
        <div
          style={{
            padding: "48px 20px",
            textAlign: "center",
            color: "#ea580c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "48px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          No elevated supply risks identified at this time.
        </div>
      ) : (
        <div>
          {items.map((item, i) => {
            const rs = riskStyle(item.riskLevel);
            return (
              <div
                key={item.drugId}
                className="psr-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr 170px 90px 180px 80px",
                  gap: 8,
                  padding: "11px 20px",
                  alignItems: "center",
                  borderBottom:
                    i < items.length - 1 ? "1px solid #f1f5f9" : "none",
                }}
              >
                {/* Rank */}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#94a3b8",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}
                >
                  {i + 1}
                </span>

                {/* Drug name + trending */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {truncateDrugName(item.drugName)}
                  </span>
                  {item.trending && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#dc2626",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: 4,
                        padding: "1px 5px",
                        flexShrink: 0,
                      }}
                    >
                      <TrendingUp style={{ width: 10, height: 10 }} />
                    </span>
                  )}
                </div>

                {/* Risk bar + score */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "#e2e8f0",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${item.riskScore}%`,
                        height: "100%",
                        borderRadius: 3,
                        background: `linear-gradient(90deg, #ca8a04 0%, ${rs.color} 100%)`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: rs.color,
                      fontFamily: "var(--font-dm-mono), monospace",
                      minWidth: 22,
                      textAlign: "right",
                    }}
                  >
                    {item.riskScore}
                  </span>
                </div>

                {/* Level badge */}
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "3px 6px",
                    borderRadius: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    background: rs.bg,
                    color: rs.color,
                    border: `1px solid ${rs.border}`,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                  }}
                >
                  {item.riskLevel}
                </span>

                {/* Primary signal */}
                <span
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.primarySignal}
                </span>

                {/* Country flags */}
                <div
                  style={{
                    display: "flex",
                    gap: 2,
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  {item.countries.map((c) => (
                    <span key={c}>{FLAGS[c] ?? "\u{1F310}"}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footnote */}
      <div
        style={{
          padding: "10px 20px",
          borderTop: "1px solid #e2e8f0",
          background: "#f8fafc",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontStyle: "italic",
          }}
        >
          Predictions based on regulatory reporting patterns. Not a substitute
          for clinical judgement.
        </span>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .psr-grid {
            grid-template-columns: 28px 1fr 120px 80px !important;
          }
          .psr-grid > :nth-child(5),
          .psr-grid > :nth-child(6) {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
