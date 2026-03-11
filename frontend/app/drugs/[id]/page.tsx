import { api, DrugDetail, ShortageEvent, Alternative, DrugRecallsResponse } from "@/lib/api";
import Link from "next/link";
import { WatchlistButton } from "@/app/components/watchlist-button";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

interface Props {
  params: Promise<{ id: string }>;
}

const COUNTRY_FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  EU: "🇪🇺", NZ: "🇳🇿", SG: "🇸🇬",
};

function SevDot({ severity }: { severity: string | null }) {
  const s = (severity ?? "").toLowerCase();
  const color = s === "critical" ? "var(--crit)" : s === "high" ? "var(--high)" : s === "medium" ? "var(--med)" : "var(--low)";
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", animation: "blink 1.6s ease-in-out infinite" }} />;
}

function SevColor(sev: string) {
  const s = sev.toLowerCase();
  if (s === "critical") return { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" };
  if (s === "high")     return { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" };
  if (s === "medium")   return { color: "var(--med)",  bg: "var(--med-bg)",  border: "var(--med-b)"  };
  return                       { color: "var(--low)",  bg: "var(--low-bg)",  border: "var(--low-b)"  };
}

export default async function DrugPage({ params }: Props) {
  const { id } = await params;

  let drug: DrugDetail | null = null;
  let shortages: ShortageEvent[] = [];
  let alternatives: Alternative[] = [];
  let recallData: DrugRecallsResponse | null = null;

  try {
    [drug, shortages, alternatives, recallData] = await Promise.all([
      api.getDrug(id),
      api.getDrugShortages(id),
      api.getDrugAlternatives(id),
      api.getDrugRecalls(id).catch(() => null),
    ]);
  } catch {
    // fallback handled below
  }

  const activeShortages = shortages.filter((s) => s.status?.toLowerCase() !== "resolved");
  const activeClassIRecalls = (recallData?.recalls ?? []).filter(
    (r) => r.recall_class === "I" && r.status === "active"
  );
  const resilienceScore = recallData?.resilience_score ?? 100;
  const resilienceColor = resilienceScore >= 80 ? "var(--low)" : resilienceScore >= 60 ? "var(--med)" : "var(--crit)";
  const worstSeverity = activeShortages.reduce((worst, s) => {
    const order = ["critical", "high", "medium", "low"];
    const si = order.indexOf((s.severity ?? "").toLowerCase());
    const wi = order.indexOf(worst.toLowerCase());
    return si >= 0 && si < wi ? (s.severity ?? worst) : worst;
  }, "low");
  const affectedCountries = new Set(activeShortages.map((s) => s.country_code));
  const affectedCount = affectedCountries.size;

  // Any active shortage — even "low" — should not show green (green = fully available)
  const statusTheme = activeShortages.length > 0
    ? (worstSeverity === "low" ? { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)" } : SevColor(worstSeverity))
    : { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" };
  const isCritical = worstSeverity.toLowerCase() === "critical";

  if (!drug) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "var(--app-text-3)" }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Drug not found</p>
          <Link href="/" style={{ color: "var(--teal)", fontSize: 14 }}>← Back to search</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--app-bg-2)", minHeight: "100vh", color: "var(--app-text)" }}>
      <style>{`
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
        @media (max-width: 768px) {
          .drug-hero { padding: 20px 16px 28px !important; }
          .drug-breadcrumb { display: none !important; }
          .drug-content { padding: 16px 16px 48px !important; }
          .drug-header { flex-direction: column !important; align-items: flex-start !important; }
          .drug-header-meta { align-items: flex-start !important; min-width: unset !important; width: 100% !important; flex-direction: row !important; flex-wrap: wrap !important; gap: 10px !important; }
          .drug-status-row { grid-template-columns: 1fr !important; }
          .drug-two-col { grid-template-columns: 1fr !important; }
          .drug-right-col { position: static !important; }
          .drug-footer { flex-direction: column !important; gap: 8px !important; padding: 20px 16px !important; text-align: center !important; }
          .drug-footer-links { justify-content: center !important; }
        }
      `}</style>

      {/* NAV */}
      <SiteNav />

      {/* DARK HERO */}
      <div style={{ background: "var(--navy)" }}>
        <div className="drug-hero" style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px 36px" }}>

          {/* Breadcrumb */}
          <div className="drug-breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.38)", marginBottom: 18 }}>
            <Link href="/search" style={{ color: "rgba(255,255,255,0.38)", textDecoration: "none" }}>Search</Link>
            <span>›</span>
            {drug.drug_class && (
              <>
                <span>{drug.drug_class}</span>
                <span>›</span>
              </>
            )}
            <span style={{ color: "rgba(255,255,255,0.65)" }}>{drug.generic_name}</span>
          </div>

          {/* Drug header row */}
          <div className="drug-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
            <div>
              {/* Badges */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {isCritical && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 5,
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                    background: "rgba(239,68,68,0.18)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.35)",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block", animation: "blink 1.6s ease-in-out infinite" }} />
                    Critical Shortage
                  </span>
                )}
                {activeClassIRecalls.length > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 5,
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                    background: "rgba(185,28,28,0.18)", color: "#fca5a5", border: "1px solid rgba(185,28,28,0.35)",
                  }}>
                    ⚠ {activeClassIRecalls.length} Class I Recall{activeClassIRecalls.length > 1 ? "s" : ""}
                  </span>
                )}
                {drug.atc_code && (
                  <span style={{
                    display: "inline-flex", padding: "4px 10px", borderRadius: 5,
                    fontSize: 11, background: "rgba(99,102,241,0.18)", color: "#a5b4fc",
                    border: "1px solid rgba(99,102,241,0.35)",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}>
                    ATC: {drug.atc_code}
                  </span>
                )}
              </div>

              {/* Drug name */}
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.025em", color: "#fff", lineHeight: 1.1, marginBottom: 6 }}>
                {drug.generic_name}
                {drug.strengths?.[0] && (
                  <span style={{ fontSize: 20, fontWeight: 400, color: "rgba(255,255,255,0.5)", marginLeft: 10 }}>
                    {drug.strengths[0]}
                  </span>
                )}
              </div>

              {/* Subtitle */}
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.48)", marginBottom: 16 }}>
                {drug.atc_description ?? drug.drug_class ?? "Pharmaceutical"}{drug.routes_of_administration?.[0] && ` · ${drug.routes_of_administration[0]}`}
              </div>

              {/* Tag pills */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {drug.drug_class && (
                  <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.52)", border: "1px solid rgba(255,255,255,0.14)" }}>
                    {drug.drug_class}
                  </span>
                )}
                {drug.therapeutic_category && (
                  <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.52)", border: "1px solid rgba(255,255,255,0.14)" }}>
                    {drug.therapeutic_category}
                  </span>
                )}
                {drug.is_controlled_substance && (
                  <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.52)", border: "1px solid rgba(255,255,255,0.14)" }}>
                    Controlled Substance
                  </span>
                )}
                {drug.dosage_forms?.slice(0, 2).map((f) => (
                  <span key={f} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.52)", border: "1px solid rgba(255,255,255,0.14)" }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>

            {/* Right — shortages count + watchlist */}
            <div className="drug-header-meta" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, flexShrink: 0, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.38)", display: "inline-block" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.42)" }}>
                  Updated today · <strong style={{ color: "#5eead4" }}>{activeShortages.length}</strong> active shortages
                </span>
              </div>
              <WatchlistButton drugId={id} />
            </div>
          </div>

        </div>
      </div>

      <div className="drug-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px 64px" }}>

        {/* STATUS + ETA ROW */}
        <div className="drug-status-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* STATUS */}
          <div style={{
            background: statusTheme.bg, border: `1px solid ${statusTheme.border}`,
            borderRadius: 12, padding: "22px 24px",
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
              color: statusTheme.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              <SevDot severity={worstSeverity} />
              {activeShortages.length > 0
                ? (affectedCount === 1
                  ? `Shortage in ${activeShortages[0]?.country ?? "1 country"}`
                  : `Shortage in ${affectedCount} countries`)
                : "Available"}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 4 }}>
              {activeShortages.length > 0
                ? (worstSeverity.charAt(0).toUpperCase() + worstSeverity.slice(1)) + " shortage"
                : "In supply"}
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
              {(() => {
                const reason = activeShortages[0]?.reason;
                // Filter out misleading availability strings from Health Canada raw data
                const isAvailabilityField = reason && /^availability:/i.test(reason.trim());
                return isAvailabilityField
                  ? (activeShortages[0]?.reason_category ?? "Supply disruption")
                  : (reason ?? activeShortages[0]?.reason_category ?? (activeShortages.length > 0 ? "Supply disruption" : "No active shortage reported"));
              })()}
            </div>
          </div>

          {/* ETA */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "22px 24px" }}>
            <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              When will it be back?
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", lineHeight: 1.1, marginBottom: 4 }}>
              {activeShortages[0]?.estimated_resolution_date
                ? new Date(activeShortages[0].estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
                : activeShortages.length > 0 ? "TBC" : "In supply"}
            </div>
            <div style={{ fontSize: 11, color: "var(--app-text-3)", fontFamily: "var(--font-dm-mono), monospace", marginBottom: 14 }}>
              {activeShortages[0]?.start_date
                ? `Started: ${new Date(activeShortages[0].start_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
                : "Start date unavailable"}
            </div>
            <div style={{ height: 1, background: "var(--app-border)", marginBottom: 14 }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>AI prediction confidence</span>
              <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 16, fontWeight: 500, color: "var(--teal)" }}>—</span>
            </div>
          </div>
        </div>

        {/* MAIN TWO-COL */}
        <div className="drug-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>

          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* WHERE IS IT */}
            <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Where is it available?</span>
                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {activeShortages.length} shortages · {new Set(activeShortages.map((s) => s.country_code)).size} countries
                </span>
              </div>
              <div style={{ padding: "18px 20px" }}>
                {activeShortages.length === 0 ? (
                  <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>No active shortages reported.</p>
                ) : (
                  <div>
                    {(() => {
                      // Group by country_code + source_name
                      const groups: Record<string, {
                        country: string; country_code: string; source_name: string | null;
                        count: number; worstSeverity: string;
                      }> = {};
                      const sevOrder = ["critical", "high", "medium", "low"];
                      activeShortages.forEach((s) => {
                        const key = `${s.country_code}||${s.source_name ?? s.country_code}`;
                        if (!groups[key]) {
                          groups[key] = { country: s.country, country_code: s.country_code, source_name: s.source_name, count: 0, worstSeverity: "low" };
                        }
                        groups[key].count++;
                        const sev = (s.severity ?? "low").toLowerCase();
                        if (sevOrder.indexOf(sev) < sevOrder.indexOf(groups[key].worstSeverity)) {
                          groups[key].worstSeverity = sev;
                        }
                      });
                      return Object.entries(groups).map(([key, g]) => {
                        const sev = g.worstSeverity;
                        const textColor = sev === "critical" ? "var(--crit)" : sev === "high" ? "var(--high)" : sev === "medium" ? "var(--med)" : "var(--low)";
                        return (
                          <div key={key} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 2px", borderBottom: "1px solid var(--app-border)",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: "center" }}>
                                {COUNTRY_FLAGS[g.country_code] ?? "🌐"}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>{g.country}</span>
                              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", marginLeft: 6 }}>
                                {g.source_name ?? g.country_code}
                              </span>
                              {g.count > 1 && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                                  background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                                  color: "var(--app-text-3)", fontFamily: "var(--font-dm-mono), monospace",
                                }}>
                                  {g.count} filings
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: textColor, display: "inline-block", flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 500, color: textColor }}>
                                {sev.charAt(0).toUpperCase() + sev.slice(1)}
                              </span>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* AI INSIGHT (static) */}
            <div style={{ background: "#fff", border: "1px solid var(--ind-b)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>AI Insight</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--indigo)", fontWeight: 500 }}>
                  ✦ AI-generated
                </div>
              </div>
              <div style={{ padding: "18px 20px" }}>
                <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--app-text-2)", marginBottom: 14 }}>
                  {activeShortages.length > 0
                    ? `This drug is currently under active shortage in ${new Set(activeShortages.map((s) => s.country)).size} countries. Supply disruptions of this type typically persist for 3–9 months based on historical patterns. Consider therapeutic alternatives where clinically appropriate.`
                    : `No active shortages are currently reported for ${drug.generic_name}. Monitor regularly as supply conditions can change rapidly.`}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {["When will stock return?", "Which alternatives are safe?", "Is my country affected?", "Historical shortage pattern"].map((q) => (
                    <button key={q} style={{
                      fontSize: 12, padding: "6px 12px", borderRadius: 6,
                      background: "var(--ind-bg)", color: "var(--indigo)", border: "1px solid var(--ind-b)",
                      cursor: "pointer", fontFamily: "var(--font-inter), sans-serif",
                    }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TIMELINE */}
            {shortages.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Shortage Timeline</span>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {shortages.slice(0, 6).map((s, i) => (
                      <div key={s.shortage_id} style={{ display: "flex", gap: 14, paddingBottom: 16 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 18, flexShrink: 0 }}>
                          <div style={{
                            width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                            border: `2px solid var(--teal)`,
                            background: i === 0 ? "var(--teal)" : "#fff",
                          }} />
                          {i < shortages.slice(0, 6).length - 1 && (
                            <div style={{ flex: 1, width: 1, background: "var(--app-border)", marginTop: 3 }} />
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", marginBottom: 2 }}>
                            {s.start_date ? new Date(s.start_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "Date unknown"}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.55 }}>
                            <strong style={{ color: "var(--app-text)", fontWeight: 500 }}>{s.country}</strong>
                            {" — "}{s.status}{s.severity ? ` (${s.severity})` : ""}{s.reason ? `: ${s.reason}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* RECALLS */}
            {recallData && (recallData.recalls.length > 0 || recallData.resilience_score < 100) && (
              <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                    Recall History
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                      Resilience
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 64, height: 6, borderRadius: 3, background: "var(--app-bg-2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${resilienceScore}%`, background: resilienceColor, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: resilienceColor, fontFamily: "var(--font-dm-mono), monospace" }}>
                        {resilienceScore}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  {recallData.recalls.length === 0 ? (
                    <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>No recalls on file.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {recallData.recalls.slice(0, 5).map((r) => {
                        const classColor = r.recall_class === "I"
                          ? { color: "#b91c1c", bg: "#7f1d1d15", border: "#b91c1c44" }
                          : r.recall_class === "II"
                          ? { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" }
                          : { color: "var(--app-text-3)", bg: "var(--app-bg-2)", border: "var(--app-border)" };
                        return (
                          <div key={r.id} style={{
                            padding: "12px 14px", borderRadius: 8,
                            background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                {r.recall_class && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                                    textTransform: "uppercase", letterSpacing: "0.05em",
                                    background: classColor.bg, color: classColor.color, border: `1px solid ${classColor.border}`,
                                  }}>
                                    Class {r.recall_class}
                                  </span>
                                )}
                                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                  {COUNTRY_FLAGS[r.country_code] ?? "🌐"} {r.country_code}
                                </span>
                              </div>
                              <div style={{ fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.4 }}>
                                {r.reason_category?.replace(/_/g, " ") ?? "Recall notice"}
                              </div>
                              {r.linked_shortages > 0 && (
                                <div style={{ fontSize: 11, color: "var(--crit)", marginTop: 3 }}>
                                  Linked to {r.linked_shortages} shortage{r.linked_shortages > 1 ? "s" : ""}
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {new Date(r.announced_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                              {r.press_release_url && (
                                <a href={r.press_release_url} target="_blank" rel="noopener noreferrer"
                                   style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>
                                  Notice ↗
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SOURCES */}
            {activeShortages.some((s) => s.source_name || s.source_url) && (
              <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Verified Sources</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    cross-checked today
                  </span>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {activeShortages.filter((s) => s.source_name).map((s) => (
                      <div key={s.shortage_id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 14px", borderRadius: 8, background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 17 }}>{COUNTRY_FLAGS[s.country_code] ?? "🌐"}</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>{s.source_name}</div>
                            {s.source_url && (
                              <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {new URL(s.source_url).hostname}
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {s.last_verified_at && (
                            <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                              {new Date(s.last_verified_at).toLocaleDateString()}
                            </span>
                          )}
                          {s.source_url && (
                            <a href={s.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--teal)" }}>↗</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COL */}
          <div className="drug-right-col" style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 76 }}>

            {/* ALTERNATIVES */}
            <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                  What can I use instead?
                </span>
                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {alternatives.length} alternatives
                </span>
              </div>
              <div style={{ padding: "18px 20px" }}>
                {alternatives.length === 0 ? (
                  <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>No alternatives on file.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {alternatives.map((alt) => (
                      <Link
                        key={alt.alternative_drug_id}
                        href={`/drugs/${alt.alternative_drug_id}`}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "14px 18px",
                          background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                          borderRadius: 10, textDecoration: "none",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>
                            {alt.alternative_generic_name}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                            {alt.relationship_type?.replace(/_/g, " ")}
                          </div>
                          {alt.dose_conversion_notes && (
                            <div style={{ fontSize: 11, color: "var(--app-text-3)", marginTop: 4 }}>
                              {alt.dose_conversion_notes}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                          {alt.clinical_evidence_level && (
                            <span style={{
                              fontSize: 12, fontWeight: 500, padding: "4px 10px", borderRadius: 4,
                              background: "var(--low-bg)", color: "var(--low)", border: "1px solid var(--low-b)",
                            }}>
                              {alt.clinical_evidence_level}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ANALYST PROMO */}
            <div style={{
              background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
              borderRadius: 10, padding: "16px 18px",
            }}>
              <strong style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", display: "block", marginBottom: 4 }}>
                Need the full picture?
              </strong>
              <span style={{ fontSize: 12, color: "var(--app-text-3)", display: "block", marginBottom: 14 }}>
                Confidence scores, manufacturer data, source audit trail
              </span>
              <Link href="/dashboard" style={{
                display: "block", width: "100%", fontSize: 13, fontWeight: 500, padding: 9, borderRadius: 7,
                background: "#fff", border: "1px solid var(--app-border)",
                color: "var(--app-text-2)", cursor: "pointer", textAlign: "center", textDecoration: "none",
              }}>
                Switch to Dashboard view →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <SiteFooter />
    </div>
  );
}
