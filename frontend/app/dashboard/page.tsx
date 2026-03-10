import { api, ShortageRow, SummaryResponse, RecallSummaryResponse, RecallRow } from "@/lib/api";
import Link from "next/link";
import { AuthBanner } from "@/app/components/auth-banner";
import WorldMapWrapper from "@/app/components/world-map-wrapper";
import { fetchNews } from "@/lib/rss";
import { VideoCard } from "@/app/components/video-embed";
import { NewsFeed } from "@/app/components/news-feed";

const COUNTRY_FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  EU: "🇪🇺", NZ: "🇳🇿", SG: "🇸🇬",
};

function SevStyle(sev: string | null) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)", dot: "crit" };
  if (s === "high") return { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)", dot: "high" };
  if (s === "medium") return { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)", dot: "med" };
  return { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)", dot: "low" };
}

// Compute Gantt bar position (%) relative to a fixed timeline window
const GANTT_START = new Date("2026-02-01").getTime();
const GANTT_END   = new Date("2027-02-01").getTime();
const GANTT_SPAN  = GANTT_END - GANTT_START;

function ganttBar(startDate: string | null, endDate: string | null) {
  const start = startDate ? Math.max(new Date(startDate).getTime(), GANTT_START) : GANTT_START;
  const end   = endDate   ? Math.min(new Date(endDate).getTime(), GANTT_END)     : GANTT_END * 0.97;
  const left  = Math.max(0, Math.min(92, ((start - GANTT_START) / GANTT_SPAN) * 100));
  const right = Math.max(left + 5, Math.min(97, ((end   - GANTT_START) / GANTT_SPAN) * 100));
  return { left: Math.round(left), width: Math.round(right - left) };
}

// Curated YouTube videos — swap IDs as needed
const VIDEOS = [
  { id: "1ZDfDd1XFOI", title: "Drug Shortages: A Growing Crisis", channel: "PBS NewsHour", duration: "7:24", tag: "News", tagColor: "#dc2626" },
  { id: "3MJnYBOZGMo", title: "Inside the Global Medicine Supply Chain", channel: "DW Documentary", duration: "42:11", tag: "Documentary", tagColor: "#7c3aed" },
  { id: "CQvNBxRJTpE", title: "Why Are There So Many Drug Shortages?", channel: "Vox", duration: "9:58", tag: "Explainer", tagColor: "#0891b2" },
  { id: "yTAdMEIBKA4", title: "Pharmaceutical Supply Resilience Post-COVID", channel: "WHO", duration: "18:44", tag: "WHO", tagColor: "#0d9488" },
];

export default async function DashboardPage() {
  let shortages: ShortageRow[] = [];
  let total = 0;
  let summary: SummaryResponse | null = null;
  let newsItems: Awaited<ReturnType<typeof fetchNews>> = [];
  let recallSummary: RecallSummaryResponse | null = null;
  let recentRecalls: RecallRow[] = [];

  try {
    const [summaryRes, shortagesRes, news, recallSummaryRes, recentRecallsRes] = await Promise.all([
      api.getSummary(),
      api.getShortages({ page: 1, page_size: 50, status: "active" }),
      fetchNews(14),
      api.getRecallsSummary().catch(() => null),
      api.getRecalls({ recall_class: "I", status: "active", page: 1, page_size: 5 }).catch(() => null),
    ]);
    newsItems = news;
    summary = summaryRes;
    shortages = shortagesRes.results;
    total = shortagesRes.total;
    recallSummary = recallSummaryRes;
    recentRecalls = recentRecallsRes?.results ?? [];
  } catch {
    // fallback: try shortages + news separately
    try {
      const [res, news] = await Promise.all([
        api.getShortages({ page: 1, page_size: 50, status: "active" }),
        fetchNews(14),
      ]);
      shortages = res.results;
      total = res.total;
      newsItems = news;
    } catch {
      // leave empty
    }
  }

  // KPI values — prefer summary, fall back to counting the 50-record page
  const criticalCount = summary?.by_severity.critical ?? shortages.filter((s) => s.severity?.toLowerCase() === "critical").length;
  const highCount     = summary?.by_severity.high     ?? shortages.filter((s) => s.severity?.toLowerCase() === "high").length;
  const newThisMonth     = summary?.new_this_month     ?? 0;
  const resolvedThisMonth = summary?.resolved_this_month ?? 0;

  // Heatmap — prefer summary, fall back to computing from page
  const heatmapCells: Array<{ category: string; count: number; max_severity: string }> =
    summary?.by_category.slice(0, 9) ??
    (() => {
      const byCategory: Record<string, { count: number; maxSev: string }> = {};
      shortages.forEach((s) => {
        const cat = s.reason_category ?? "Other";
        if (!byCategory[cat]) byCategory[cat] = { count: 0, maxSev: "low" };
        byCategory[cat].count++;
        const order = ["critical", "high", "medium", "low"];
        const si = order.indexOf((s.severity ?? "").toLowerCase());
        const wi = order.indexOf(byCategory[cat].maxSev.toLowerCase());
        if (si >= 0 && si < wi) byCategory[cat].maxSev = s.severity ?? "low";
      });
      return Object.entries(byCategory)
        .sort((a, b) => {
          const order = ["critical", "high", "medium", "low"];
          return order.indexOf(a[1].maxSev) - order.indexOf(b[1].maxSev);
        })
        .slice(0, 9)
        .map(([category, data]) => ({ category, count: data.count, max_severity: data.maxSev }));
    })();

  // Country breakdown (from current page)
  const byCountry: Record<string, number> = {};
  shortages.forEach((s) => {
    byCountry[s.country_code] = (byCountry[s.country_code] ?? 0) + 1;
  });
  const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Gantt — top 8 critical/high active shortages ordered by severity then start date
  const sevOrder = ["critical", "high", "medium", "low"];
  const ganttShortages = [...shortages]
    .filter((s) => ["critical", "high"].includes(s.severity?.toLowerCase() ?? ""))
    .sort((a, b) => {
      const sd = sevOrder.indexOf((a.severity ?? "").toLowerCase()) - sevOrder.indexOf((b.severity ?? "").toLowerCase());
      if (sd !== 0) return sd;
      return (a.start_date ?? "").localeCompare(b.start_date ?? "");
    })
    .slice(0, 8);

  const now = new Date();

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)", fontSize: 14 }}>
      <style>{`
        @media (max-width: 768px) {
          .db-nav { padding: 0 16px !important; }
          .db-nav-subtitle { display: none !important; }
          .db-nav-actions { gap: 6px !important; }
          .db-nav-export { display: none !important; }
          .db-period-bar { padding: 0 16px !important; overflow-x: auto !important; }
          .db-period-chips { display: none !important; }
          .db-content { padding: 16px 16px 48px !important; }
          .db-kpi-grid { grid-template-columns: repeat(2,1fr) !important; }
          .db-main-grid { grid-template-columns: 1fr !important; }
          .db-heatmap-grid { grid-template-columns: repeat(2,1fr) !important; }
          .db-gantt-header { grid-template-columns: 140px 1fr 60px !important; }
          .db-gantt-row { grid-template-columns: 140px 1fr 60px !important; }
          .db-shortage-cols { grid-template-columns: 1fr !important; }
          .db-table-wrap { overflow-x: auto !important; }
          .db-section { padding: 20px 16px !important; }
          .db-footer { flex-direction: column !important; gap: 8px !important; padding: 20px 16px !important; text-align: center !important; }
        }
      `}</style>

      {/* NAV */}
      <nav className="db-nav" style={{
        position: "sticky", top: 0, zIndex: 100,
        height: 56, background: "var(--navy)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff", textDecoration: "none" }}>
            Mederti
          </Link>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />
          <span className="db-nav-subtitle" style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            <strong style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>Global Supply Intelligence</strong>
            {" — Regulator Dashboard"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-dm-mono), monospace" }}>
            {now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · {now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button className="db-nav-export" style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--teal)", border: "none", color: "#fff",
            padding: "7px 14px", borderRadius: 6,
            fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-inter), sans-serif",
          }}>
            ↓ Export PDF
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "var(--teal)", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, color: "#fff",
            }}>
              A
            </div>
            Analyst
          </div>
        </div>
      </nav>

      {/* AUTH BANNER — client component, shown only to unauthenticated users */}
      <AuthBanner />

      {/* PERIOD BAR */}
      <div className="db-period-bar" style={{
        background: "#fff", borderBottom: "1px solid var(--app-border)",
        padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex" }}>
          {["Today", "This month", "Next 90 days", "12-month view"].map((tab, i) => (
            <div key={tab} style={{
              padding: "14px 20px", fontSize: 13, fontWeight: 500,
              color: i === 1 ? "var(--teal)" : "var(--app-text-3)",
              cursor: "pointer",
              borderBottom: i === 1 ? "2px solid var(--teal)" : "2px solid transparent",
            }}>
              {tab}
            </div>
          ))}
        </div>
        <div className="db-period-chips" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {["All categories", "Antibiotics", "Oncology", "Cardiovascular", "Paediatric"].map((chip, i) => (
            <span key={chip} style={{
              fontSize: 12, padding: "5px 12px", borderRadius: 6,
              background: i === 0 ? "var(--teal-bg)" : "var(--app-bg-2)",
              border: i === 0 ? "1px solid var(--teal-b)" : "1px solid var(--app-border)",
              color: i === 0 ? "var(--teal)" : "var(--app-text-3)",
              cursor: "pointer",
            }}>
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="db-content" style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 64px" }}>

        {/* KPI ROW */}
        <div className="db-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14, marginBottom: 20 }}>
          {[
            { label: "Critical Shortages", value: criticalCount, cls: "crit", color: "var(--crit)", delta: `Active globally`, sub: "Active globally", deltaColor: "var(--crit)" },
            { label: "High Severity", value: highCount, cls: "high", color: "var(--high)", delta: "Active globally", sub: "Active globally", deltaColor: "var(--high)" },
            { label: "New This Month", value: newThisMonth, cls: "med", color: "var(--app-text)", delta: "Last 30 days", sub: "Declared shortages", deltaColor: "var(--app-text-3)" },
            { label: "Resolved This Month", value: resolvedThisMonth, cls: "low", color: "var(--low)", delta: "Last 30 days", sub: "Shortage closures", deltaColor: "var(--low)" },
            { label: "Class I Recalls", value: recallSummary?.class_i_count ?? 0, cls: "recall", color: "#b91c1c", delta: "Active globally", sub: "Most serious class", deltaColor: "#b91c1c" },
            { label: "AI Early Warnings", value: 8, cls: "teal", color: "var(--teal)", delta: "Next 30–60 days", sub: "At-risk drugs flagged", deltaColor: "var(--app-text-4)" },
          ].map((kpi) => {
            const topColor = kpi.cls === "crit" ? "var(--crit)" : kpi.cls === "high" ? "var(--high)" : kpi.cls === "med" ? "var(--med)" : kpi.cls === "low" ? "var(--low)" : kpi.cls === "recall" ? "#b91c1c" : "var(--teal)";
            return (
              <div key={kpi.label} style={{
                background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: topColor }} />
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)", marginBottom: 10 }}>
                  {kpi.label}
                </div>
                <div style={{ fontSize: 36, fontWeight: 500, lineHeight: 1, color: kpi.color, marginBottom: 6 }}>
                  {kpi.value}
                </div>
                <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: kpi.deltaColor }}>
                  {kpi.delta}
                </div>
                <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>{kpi.sub}</div>
              </div>
            );
          })}
        </div>

        {/* MAIN GRID: heatmap + early warning */}
        <div className="db-main-grid" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 18, marginBottom: 18 }}>

          {/* HEATMAP */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                Therapeutic Category Heatmap
              </span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                Active shortages by category · live
              </span>
            </div>
            <div style={{ padding: "18px 20px" }}>
              {heatmapCells.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>
                  Loading category data…
                </div>
              ) : (
                <div className="db-heatmap-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                  {heatmapCells.map((cell) => {
                    const st = SevStyle(cell.max_severity);
                    return (
                      <div key={cell.category} style={{
                        borderRadius: 8, padding: "14px 16px",
                        background: st.bg, border: `1px solid ${st.border}`,
                        cursor: "pointer",
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", marginBottom: 6 }}>
                          {cell.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </div>
                        <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 24, fontWeight: 500, lineHeight: 1, marginBottom: 4, color: st.color }}>
                          {cell.count}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>{cell.max_severity} severity</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* EARLY WARNING — illustrative */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>⚠ Early Warning</span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>Illustrative analytics</span>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { icon: "🏭", drug: "Ciprofloxacin 500mg", reason: "Aurobindo facility in Hyderabad flagged by FDA inspection (OAI). 3 AU suppliers source from this site.", badge: "High risk", badgeCls: "high", days: "~45 days" },
                  { icon: "✦", drug: "Metformin 500mg", reason: "AI pattern match: same API supplier as current metformin 850mg shortage. Historically cascades within 60 days.", badge: "AI signal", badgeCls: "ai", days: "~60 days" },
                  { icon: "📦", drug: "Salbutamol inhaler 100mcg", reason: "UK and Canada reporting low stock. 2 of 3 distributors showing below-threshold inventory signals.", badge: "Med risk", badgeCls: "med", days: "~30 days" },
                  { icon: "🏭", drug: "Flucloxacillin 500mg", reason: "NMPA China issued manufacturing suspension at Hainan facility — primary API source for 4 generic manufacturers.", badge: "High risk", badgeCls: "high", days: "~90 days" },
                ].map((w) => {
                  const iconBg = w.badgeCls === "high" ? "var(--high-bg)" : w.badgeCls === "ai" ? "var(--ind-bg)" : "var(--med-bg)";
                  const badgeStyle = w.badgeCls === "high"
                    ? { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" }
                    : w.badgeCls === "ai"
                    ? { bg: "var(--ind-bg)", color: "var(--indigo)", border: "var(--ind-b)" }
                    : { bg: "var(--med-bg)", color: "var(--med)", border: "var(--med-b)" };
                  return (
                    <div key={w.drug} style={{
                      display: "flex", alignItems: "flex-start", gap: 12,
                      padding: "12px 14px", borderRadius: 8, border: "1px solid var(--app-border)",
                      background: "var(--app-bg-2)", cursor: "pointer",
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, background: iconBg,
                      }}>
                        {w.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>{w.drug}</div>
                        <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.5 }}>{w.reason}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                          textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
                          background: badgeStyle.bg, color: badgeStyle.color, border: `1px solid ${badgeStyle.border}`,
                        }}>
                          {w.badge}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>{w.days}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* PIPELINE / GANTT — live data from top critical/high active shortages */}
        <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
              Shortage Pipeline — Resolution Forecast
            </span>
            <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
              Feb 2026 → Feb 2027 · top critical/high active
            </span>
          </div>
          <div style={{ padding: "18px 20px" }}>
            {/* Month headers */}
            <div className="db-gantt-header" style={{ display: "grid", gridTemplateColumns: "200px 1fr 80px", gap: 12, paddingBottom: 8, borderBottom: "1px solid var(--app-border)", marginBottom: 4 }}>
              <div />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb"].map((m) => (
                  <span key={m} style={{ fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>{m}</span>
                ))}
              </div>
              <div />
            </div>
            {/* Gantt rows — live data */}
            {(ganttShortages.length > 0 ? ganttShortages : [
              { shortage_id: "1", drug_id: "", generic_name: "Amoxicillin 500mg", brand_names: [], country: "AU", country_code: "AU", status: "active", severity: "critical", reason_category: "antibiotic", start_date: "2025-02-14", estimated_resolution_date: "2026-08-01", source_name: null, source_url: null },
              { shortage_id: "2", drug_id: "", generic_name: "Paracetamol IV 10mg/ml", brand_names: [], country: "AU", country_code: "AU", status: "active", severity: "critical", reason_category: "analgesic", start_date: "2025-12-23", estimated_resolution_date: "2026-04-01", source_name: null, source_url: null },
            ] as ShortageRow[]).map((row) => {
              const bar = ganttBar(row.start_date, row.estimated_resolution_date);
              const barColor = row.severity?.toLowerCase() === "critical" ? "var(--crit)" : "var(--high)";
              const eta = row.estimated_resolution_date
                ? new Date(row.estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })
                : "TBC";
              return (
                <div key={row.shortage_id} className="db-gantt-row" style={{
                  display: "grid", gridTemplateColumns: "200px 1fr 80px", gap: 12, alignItems: "center",
                  padding: "10px 0", borderBottom: "1px solid var(--app-bg-2)",
                }}>
                  <div>
                    <Link href={`/drugs/${row.drug_id}`} style={{ textDecoration: "none" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>{row.generic_name}</div>
                      <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                        {row.reason_category ?? row.country_code}
                      </div>
                    </Link>
                  </div>
                  <div style={{ position: "relative", height: 20, background: "var(--app-bg-2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `${bar.left}%`, width: `${bar.width}%`,
                      borderRadius: 4, background: barColor,
                      display: "flex", alignItems: "center", padding: "0 8px",
                      fontSize: 10, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden",
                    }}>
                      {row.severity?.charAt(0).toUpperCase()}{row.severity?.slice(1)}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 11, color: "var(--app-text-3)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {eta}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RECENT CLASS I RECALLS */}
        {recentRecalls.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #fecaca", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fef2f2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#b91c1c" }}>
                ⚠ Recent Class I Recalls
              </span>
              <span style={{ fontSize: 11, color: "#b91c1c", fontFamily: "var(--font-dm-mono), monospace" }}>
                {recallSummary?.class_i_count ?? recentRecalls.length} active globally · most serious classification
              </span>
            </div>
            <div style={{ padding: "14px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recentRecalls.map((r) => (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 14px", borderRadius: 8,
                    background: "#fef2f2", border: "1px solid #fecaca",
                  }}>
                    <div style={{
                      flexShrink: 0, padding: "3px 8px", borderRadius: 4,
                      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                      background: "#b91c1c", color: "#fff",
                    }}>
                      Class I
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>
                        {r.generic_name}
                        {r.brand_name && <span style={{ fontSize: 11, color: "var(--app-text-4)", marginLeft: 6, fontFamily: "var(--font-dm-mono), monospace" }}>{r.brand_name}</span>}
                      </div>
                      {r.reason && (
                        <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 2, lineHeight: 1.4 }}>
                          {r.reason.slice(0, 120)}{r.reason.length > 120 ? "…" : ""}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--app-bg-2)", border: "1px solid var(--app-border)", color: "var(--app-text-3)" }}>
                        {COUNTRY_FLAGS[r.country_code] ?? "🌐"} {r.country_code}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                        {new Date(r.announced_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                      </span>
                      {r.press_release_url && (
                        <a href={r.press_release_url} target="_blank" rel="noopener noreferrer"
                           style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>
                          Notice ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* WORLD MAP HEATMAP */}
        {summary?.by_country && summary.by_country.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                Global Shortage Map
              </span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                Active shortages by country · live
              </span>
            </div>
            <div style={{ padding: "4px 0 0" }}>
              <WorldMapWrapper byCountry={summary.by_country} />
            </div>
            {/* Country breakdown bar */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--app-border)", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {summary.by_country.slice(0, 10).map((c) => {
                const sevColor = c.max_severity === "critical" ? "var(--crit)" : c.max_severity === "high" ? "var(--high)" : "var(--med)";
                return (
                  <div key={c.country_code} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 6,
                    background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                    fontSize: 12,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ color: "var(--app-text-2)", fontWeight: 500 }}>{c.country_code}</span>
                    <span style={{ fontFamily: "var(--font-dm-mono), monospace", color: "var(--app-text-3)" }}>
                      {c.count.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* NEWS + VIDEO ROW */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 18, marginBottom: 18 }}>

          {/* NEWS FEED */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                Latest Regulatory News
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {["FDA", "MedWatch", "WHO", "EMA"].map((s, i) => {
                  const colors: Record<string, string> = { FDA: "#1d4ed8", MedWatch: "#dc2626", WHO: "#0891b2", EMA: "#7c3aed" };
                  return (
                    <span key={s} style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                      background: colors[s] + "18", color: colors[s],
                      border: `1px solid ${colors[s]}33`,
                      textTransform: "uppercase", letterSpacing: "0.04em",
                    }}>{s}</span>
                  );
                })}
              </div>
            </div>
            <NewsFeed items={newsItems} />
          </div>

          {/* VIDEO PANEL */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                ▶ Featured Videos
              </span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>Curated</span>
            </div>
            <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {VIDEOS.map((v) => (
                <VideoCard key={v.id} {...v} />
              ))}
            </div>
          </div>

        </div>

        {/* BOTTOM GRID: supply origin, global compare, net flow */}
        <div className="db-shortage-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>

          {/* SUPPLY ORIGIN — illustrative */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Shortage Origin — Supply Side</span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>Illustrative analytics</span>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { flag: "🇮🇳", label: "India", pct: 78, color: "var(--crit)", count: "18 shortages" },
                  { flag: "🇨🇳", label: "China", pct: 52, color: "var(--high)", count: "12 shortages" },
                  { flag: "🇩🇪", label: "Germany", pct: 18, color: "var(--med)", count: "4 shortages" },
                  { flag: "🇺🇸", label: "United States", pct: 12, color: "var(--med)", count: "3 shortages" },
                  { flag: "🌐", label: "Other / Unknown", pct: 8, color: "var(--app-text-4)", count: "2 shortages" },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{row.flag}</span>
                    <span style={{ fontSize: 13, color: "var(--app-text-2)", flex: 1 }}>{row.label}</span>
                    <div style={{ width: 120, height: 6, background: "var(--app-bg-2)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${row.pct}%`, borderRadius: 3, background: row.color }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 12, color: "var(--app-text)", minWidth: 32, textAlign: "right", fontWeight: 500 }}>
                      {row.pct}%
                    </span>
                    <span style={{ fontSize: 11, color: "var(--app-text-4)", minWidth: 70, textAlign: "right" }}>{row.count}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--app-border)" }}>
                <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--crit)" }}>Systemic risk flag:</strong> 13 of {criticalCount} critical shortages trace to 2 API facilities in Gujarat, India. A single regulatory action at either site would affect 40%+ of antibiotic supply.
                </div>
              </div>
            </div>
          </div>

          {/* GLOBAL COMPARISON */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Global Comparison</span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>Shortages vs peer countries</span>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 12, color: "var(--app-text-3)", marginBottom: 12 }}>
                Of {criticalCount} critical shortages — how many are shared globally vs country-specific?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(topCountries.length > 0 ? topCountries : [
                  ["GB", 17], ["CA", 15], ["DE", 14], ["US", 11], ["NZ", 9],
                ] as [string, number][]).slice(0, 5).map(([cc, count], i) => {
                  const countryNames: Record<string, string> = { GB: "United Kingdom", CA: "Canada", DE: "Germany", US: "United States", NZ: "New Zealand", AU: "Australia", FR: "France", IT: "Italy", ES: "Spain" };
                  const badge = i < 2 ? { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)", label: "Global" } : { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)", label: "Partial" };
                  return (
                    <div key={cc} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", borderRadius: 8,
                      background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                    }}>
                      <span style={{ fontSize: 16 }}>{COUNTRY_FLAGS[cc] ?? "🌐"}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", flex: 1 }}>
                        {countryNames[cc] ?? cc}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--app-text-3)", fontFamily: "var(--font-dm-mono), monospace" }}>{count} shared</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "3px 7px", borderRadius: 4,
                        textTransform: "uppercase", letterSpacing: "0.04em",
                        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                      }}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--app-border)" }}>
                <div style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                  <strong style={{ color: "var(--app-text)" }}>4 shortages</strong> are country-specific — likely procurement or regulatory timing issues rather than global supply failures.
                </div>
              </div>
            </div>
          </div>

          {/* NET FLOW — illustrative */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Weekly Net Flow</span>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>Illustrative analytics</span>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--crit)" }} />
                  <span style={{ color: "var(--app-text-3)" }}>New shortages</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--low)" }} />
                  <span style={{ color: "var(--app-text-3)" }}>Resolved</span>
                </div>
              </div>
              {[
                { week: "12 Jan", newW: 60, res: 40, net: "+3", pos: true },
                { week: "19 Jan", newW: 40, res: 50, net: "−2", pos: false },
                { week: "26 Jan", newW: 70, res: 30, net: "+4", pos: true },
                { week: "2 Feb", newW: 50, res: 45, net: "+1", pos: true },
                { week: "9 Feb", newW: 80, res: 35, net: "+5", pos: true },
                { week: "16 Feb", newW: 55, res: 55, net: "0", pos: null },
              ].map((row) => (
                <div key={row.week} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--app-bg-2)" }}>
                  <span style={{ fontSize: 12, color: "var(--app-text-3)", fontFamily: "var(--font-dm-mono), monospace" }}>{row.week}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, margin: "0 14px" }}>
                    <div style={{ height: 8, borderRadius: 2, background: "var(--crit)", width: row.newW }} />
                    <div style={{ height: 8, borderRadius: 2, background: "var(--low)", width: row.res }} />
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 500, fontFamily: "var(--font-dm-mono), monospace",
                    color: row.pos === null ? "var(--app-text-4)" : row.pos ? "var(--crit)" : "var(--low)",
                  }}>
                    {row.net}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--app-border)", fontSize: 12, color: "var(--app-text-3)" }}>
                Market is <strong style={{ color: "var(--high)" }}>deteriorating</strong> — net +11 shortages over 6 weeks. Antibiotic category driving 60% of new declarations.
              </div>
            </div>
          </div>
        </div>

        {/* ACTIVE SHORTAGES TABLE */}
        <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10, overflow: "hidden", marginTop: 18 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
              All Active Shortages
            </span>
            <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
              {total || shortages.length} total · sorted by severity
            </span>
          </div>
          <div className="db-table-wrap" style={{ padding: "18px 20px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Drug", "Severity", "Category", "Country", "Start date", "Est. resolution"].map((h) => (
                    <th key={h} style={{
                      fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em",
                      color: "var(--app-text-4)", padding: "0 0 10px", textAlign: "left", borderBottom: "1px solid var(--app-border)",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shortages.slice(0, 20).map((row) => {
                  const st = SevStyle(row.severity);
                  const startDays = row.start_date ? Math.floor((Date.now() - new Date(row.start_date).getTime()) / 86400000) : null;
                  return (
                    <tr key={row.shortage_id}>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle" }}>
                        <Link href={`/drugs/${row.drug_id}`} style={{ textDecoration: "none" }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>{row.generic_name}</div>
                          {row.brand_names?.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>{row.brand_names[0]}</div>
                          )}
                        </Link>
                      </td>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: st.color, display: "inline-block", marginRight: 6 }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: st.color }}>
                          {row.severity ? row.severity.charAt(0).toUpperCase() + row.severity.slice(1) : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle", fontSize: 13, color: "var(--app-text-2)" }}>
                        {row.reason_category ?? "—"}
                      </td>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle" }}>
                        <span style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 4,
                          background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)",
                        }}>
                          {COUNTRY_FLAGS[row.country_code] ?? "🌐"} {row.country_code}
                        </span>
                      </td>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle" }}>
                        <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 12, color: "var(--app-text-3)" }}>
                          {startDays !== null ? `${startDays}d` : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 0", borderBottom: "1px solid var(--app-bg-2)", verticalAlign: "middle", fontSize: 13, color: "var(--app-text-2)" }}>
                        {row.estimated_resolution_date
                          ? new Date(row.estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
                          : "TBC"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 14, textAlign: "center" }}>
              <span style={{ fontSize: 13, color: "var(--teal)", cursor: "pointer", fontWeight: 500 }}>
                View all {total || shortages.length} active shortages →
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <footer className="db-footer" style={{
        borderTop: "1px solid var(--app-border)",
        padding: "20px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#fff", marginTop: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
          Mederti<span style={{ color: "var(--teal)" }}>.</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
          Data sourced from public regulatory databases. Not for clinical decision-making without verification.
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <a href="/privacy" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Terms</a>
          <a href="mailto:hello@mederti.com" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Contact</a>
        </div>
      </footer>

      {/* CHAT FAB */}
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
        <div style={{
          background: "#fff", border: "1px solid var(--app-border)",
          borderRadius: 12, padding: "12px 16px",
          fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.5,
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          maxWidth: 260, textAlign: "right",
        }}>
          <strong style={{ color: "var(--app-text)" }}>Ask the data anything</strong><br />
          "Which shortages resolve before winter?"
        </div>
        <button style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--navy)", color: "#fff",
          padding: "14px 20px", borderRadius: 50,
          fontSize: 14, fontWeight: 600, fontFamily: "var(--font-inter), sans-serif",
          cursor: "pointer", border: "none",
          boxShadow: "0 4px 20px rgba(15,23,42,0.3)",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)", animation: "blink 1.6s ease-in-out infinite", display: "inline-block" }} />
          Ask Mederti AI
        </button>
      </div>
    </div>
  );
}
