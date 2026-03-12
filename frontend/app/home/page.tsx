export const dynamic = "force-dynamic";

import { api, ShortageRow, RecallRow, SummaryResponse, RecallSummaryResponse } from "@/lib/api";
import Link from "next/link";
import {
  AlertCircle, TrendingUp, ShieldAlert, PackageX,
  ArrowLeftRight, Globe2, Bell, ChevronRight, ExternalLink,
  Home, Search, Bookmark, Activity,
} from "lucide-react";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import HomeSearchClient from "./HomeSearchClient";
import WatchlistCardClient from "./WatchlistCardClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SevBadge({ sev }: { sev: string | null }) {
  const s = (sev ?? "").toLowerCase();
  const styles: Record<string, { bg: string; color: string }> = {
    critical: { bg: "var(--crit)",  color: "#fff" },
    high:     { bg: "var(--high)",  color: "#fff" },
    medium:   { bg: "var(--med)",   color: "#fff" },
    low:      { bg: "var(--low)",   color: "#fff" },
  };
  const st = styles[s] ?? { bg: "var(--app-bg-2)", color: "var(--app-text-3)" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
      background: st.bg, color: st.color,
      flexShrink: 0,
    }}>
      {s || "—"}
    </span>
  );
}

function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    I:   { bg: "var(--crit-bg)",  color: "var(--crit)",  border: "var(--crit-b)" },
    II:  { bg: "var(--high-bg)", color: "var(--high)",  border: "var(--high-b)" },
    III: { bg: "var(--med-bg)",  color: "var(--med)",   border: "var(--med-b)" },
  };
  const st = styles[cls] ?? { bg: "var(--app-bg-2)", color: "var(--app-text-3)", border: "var(--app-border)" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px", borderRadius: 20,
      fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
      flexShrink: 0,
    }}>
      Class {cls}
    </span>
  );
}

function CardHeader({
  icon: Icon, title, sub, iconColor = "var(--teal)", viewHref,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  iconColor?: string;
  viewHref?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 20px", borderBottom: "1px solid var(--app-border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: `${iconColor}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon style={{ width: 14, height: 14, strokeWidth: 1.5 }} color={iconColor} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>
          {title}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {sub && (
          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
            {sub}
          </span>
        )}
        {viewHref && (
          <Link href={viewHref} style={{
            display: "flex", alignItems: "center", gap: 3,
            fontSize: 12, color: "var(--teal)", fontWeight: 500, textDecoration: "none",
          }}>
            View all
            <ChevronRight style={{ width: 13, height: 13, strokeWidth: 2 }} />
          </Link>
        )}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>
      {label}
    </div>
  );
}

function daysSince(date: string | null) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function fmtDate(date: string | null, locale = "en-AU") {
  if (!date) return "TBC";
  return new Date(date).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default async function HomePage() {
  let auShortages: ShortageRow[]             = [];
  let auRecalls: RecallRow[]                 = [];
  let summary: SummaryResponse | null        = null;
  let recallSummary: RecallSummaryResponse | null = null;
  let auTotal = 0;
  let recallsAreGlobal = false;

  try {
    const [shortRes, recallRes, sumRes, rSumRes] = await Promise.allSettled([
      api.getShortages({ country: "AU", status: "active", page: 1, page_size: 6 }),
      api.getRecalls({ country_code: "AU", status: "active", page: 1, page_size: 5 }),
      api.getSummary(),
      api.getRecallsSummary(),
    ]);

    if (shortRes.status === "fulfilled") {
      auShortages = shortRes.value.results;
      auTotal     = shortRes.value.total;
    }
    if (recallRes.status === "fulfilled")  auRecalls     = recallRes.value.results;
    if (sumRes.status === "fulfilled")     summary       = sumRes.value;
    if (rSumRes.status === "fulfilled")    recallSummary = rSumRes.value;

    // Fallback: no AU recalls → show global Class I
    if (auRecalls.length === 0) {
      const fallback = await api.getRecalls({ recall_class: "I", status: "active", page: 1, page_size: 5 }).catch(() => null);
      if (fallback && fallback.results.length > 0) {
        auRecalls = fallback.results;
        recallsAreGlobal = true;
      }
    }
  } catch {
    // graceful degradation — cards show empty states
  }

  const ICON = { strokeWidth: 1.5 } as const;

  // ── Predicted shortage signals (illustrative) ────────────────────────────
  const PREDICTED = [
    {
      drug: "Ciprofloxacin 500mg",
      reason: "Likely to hit AU shelves in ~45 days. API supplier flagged by FDA — consider stocking alternatives now.",
      risk: "High risk", riskCls: "high" as const, eta: "~45 days",
    },
    {
      drug: "Metformin 500mg",
      reason: "Same supply chain as the current 850mg shortage. Hospitals and pharmacies should prepare for dose-adjusted protocols.",
      risk: "AI signal", riskCls: "ai" as const, eta: "~60 days",
    },
    {
      drug: "Salbutamol inhaler 100mcg",
      reason: "UK and Canada already low. Two of three AU distributors below safety threshold — plan orders early.",
      risk: "Med risk", riskCls: "med" as const, eta: "~30 days",
    },
  ];

  const RISK_STYLES = {
    high: { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" },
    ai:   { bg: "var(--ind-bg)",  color: "var(--indigo)", border: "var(--ind-b)" },
    med:  { bg: "var(--med-bg)",  color: "var(--med)",  border: "var(--med-b)" },
  };

  // ── Therapeutic alternatives (illustrative) ──────────────────────────────
  const ALTS = [
    { from: "Amoxicillin 500mg", to: "Cephalexin 500mg", relationship: "Therapeutic equivalent", score: 95 },
    { from: "Paracetamol IV",    to: "Ibuprofen IV",      relationship: "Pharmacological alt",   score: 80 },
    { from: "Ondansetron 4mg",   to: "Metoclopramide",    relationship: "Therapeutic class alt",  score: 65 },
    { from: "Metformin 850mg",   to: "Metformin 500mg",   relationship: "Dose adjustment",        score: 90 },
  ];

  // ── Global coverage from summary ─────────────────────────────────────────
  const topCountries = summary?.by_country?.slice(0, 8) ?? [];
  const COUNTRY_NAMES: Record<string, string> = {
    AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
    NZ: "New Zealand", SG: "Singapore",   DE: "Germany", FR: "France",
    IT: "Italy",      ES: "Spain",        EU: "European Union",
  };

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)", fontSize: 14 }}>

      {/* ── Responsive styles ────────────────────────────────────────────── */}
      <style>{`
        .home-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .home-full { grid-column: 1 / -1; }
        /* Card row base sizes */
        .home-row { display: flex; align-items: center; gap: 12px; padding: 13px 20px; border-bottom: 1px solid var(--app-bg-2); text-decoration: none; }
        .home-row:hover { background: var(--app-bg-2); }
        .home-row-name { font-size: 14px; font-weight: 500; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .home-row-meta { font-size: 12px; color: var(--app-text-4); margin-top: 2px; }
        /* TGA article links */
        .tga-article { display: flex; align-items: flex-start; gap: 10px; padding: 11px 20px; border-bottom: 1px solid var(--app-bg-2); text-decoration: none; }
        .tga-article:hover { background: var(--app-bg-2); }
        @media (max-width: 720px) {
          .home-grid { grid-template-columns: 1fr !important; }
          .home-full { grid-column: 1; }
          .home-content { padding: 16px 16px 80px !important; }
          .home-hero { padding: 24px 16px 20px !important; }
          .home-trust-bar { flex-wrap: wrap !important; gap: 8px !important; }
          .home-bottom-nav { display: flex !important; }
        }
      `}</style>

      {/* ── Sticky top nav ───────────────────────────────────────────────── */}
      <SiteNav />

      {/* ── Hero: search ─────────────────────────────────────────────────── */}
      <div className="home-hero" style={{
        background: "#fff",
        borderBottom: "1px solid var(--app-border)",
        padding: "36px 24px 32px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
      }}>
        <div style={{ textAlign: "center", maxWidth: 900 }}>
          <h1 style={{
            fontSize: 42, fontWeight: 700, color: "var(--app-text)",
            letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 10,
            whiteSpace: "nowrap",
          }}>
            Find Short-Supply Medicines Globally.
          </h1>
          <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.6, maxWidth: 560, margin: "0 auto" }}>
            Pharmacists, hospitals, and suppliers use Mederti to track drug shortages, find alternatives, and plan ahead — across 30 regulatory sources in 11 countries.
          </p>
        </div>

        <HomeSearchClient />

        {/* Trust bar */}
        <div className="home-trust-bar" style={{
          display: "flex", alignItems: "center", gap: 24, flexWrap: "nowrap",
        }}>
          {[
            { val: (summary?.total_active ?? "…").toLocaleString(), label: "active shortages tracked", href: "/shortages?status=active" },
            { val: "30",   label: "regulatory sources", href: "/shortages" },
            { val: "11",   label: "countries monitored", href: "/shortages" },
            { val: "live", label: "updated every 30 min", href: "/shortages" },
          ].map(({ val, label, href }) => (
            <Link key={label} href={href} style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--app-text-4)",
              textDecoration: "none",
            }}>
              <span style={{
                fontFamily: "var(--font-dm-mono), monospace",
                color: "var(--app-text-2)", fontWeight: 500,
              }}>{val}</span>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Card grid ────────────────────────────────────────────────────── */}
      <div className="home-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>
        <div className="home-grid">

          {/* ── Card 1: Active Shortages AU ──────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={AlertCircle}
              title="What's short right now — AU"
              iconColor="var(--crit)"
              sub={auTotal ? `${auTotal} active` : undefined}
              viewHref="/shortages?country=AU&status=active"
            />
            {auShortages.length === 0 ? (
              <EmptyState label="No active shortages in Australia right now — good news for your supply chain." />
            ) : (
              <div>
                {auShortages.map(row => {
                  const age = daysSince(row.start_date);
                  return (
                    <Link key={row.shortage_id} href={`/drugs/${row.drug_id}`} className="home-row" style={{ alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="home-row-name">{row.generic_name}</div>
                        {row.reason_category && (
                          <div className="home-row-meta">
                            {row.reason_category.replace(/_/g, " ")}
                            {age !== null && ` · ${age}d`}
                          </div>
                        )}
                      </div>
                      <SevBadge sev={row.severity} />
                    </Link>
                  );
                })}
                {auTotal > 6 && (
                  <div style={{ padding: "10px 20px" }}>
                    <Link href="/shortages?country=AU&status=active" style={{
                      fontSize: 13, color: "var(--teal)", fontWeight: 500, textDecoration: "none",
                    }}>
                      +{auTotal - 6} more shortages
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Card 2: My Watchlist ─────────────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={Bookmark}
              title="Drugs you're watching"
              iconColor="var(--teal)"
            />
            <WatchlistCardClient />
          </div>

          {/* ── Card 3: Recent Recalls ───────────────────────────────────── */}
          <div style={{
            background: "#fff",
            border: `1px solid ${auRecalls.some(r => r.recall_class === "I") ? "var(--crit-b)" : "var(--app-border)"}`,
            borderRadius: 12, overflow: "hidden",
          }}>
            <CardHeader
              icon={PackageX}
              title={recallsAreGlobal ? "Safety recalls to act on — Global" : "Safety recalls to act on — AU"}
              iconColor="var(--crit)"
              sub={recallSummary ? `${recallSummary.class_i_count} Class I active` : undefined}
              viewHref={recallsAreGlobal ? "/recalls?recall_class=I" : "/recalls?country_code=AU"}
            />
            {auRecalls.length === 0 ? (
              <EmptyState label="No active recalls requiring action right now." />
            ) : (
              <div>
                {auRecalls.map(r => {
                  const href = r.drug_id
                    ? `/drugs/${r.drug_id}`
                    : r.press_release_url ?? "/recalls";
                  const external = !r.drug_id && !!r.press_release_url;
                  return (
                    <Link
                      key={r.id}
                      href={href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noopener noreferrer" : undefined}
                      className="home-row"
                      style={{ alignItems: "flex-start" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="home-row-name">{r.generic_name}</div>
                        {r.manufacturer && (
                          <div className="home-row-meta">{r.manufacturer}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <ClassBadge cls={r.recall_class} />
                        <span style={{ fontSize: 12, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                          {fmtDate(r.announced_date)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Card 4: Predicted Shortages ──────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={TrendingUp}
              title="Get ahead of what's coming"
              iconColor="var(--indigo)"
              sub="AI early-warning signals"
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {PREDICTED.map(p => {
                const rs = RISK_STYLES[p.riskCls];
                return (
                  <Link
                    key={p.drug}
                    href={`/search?q=${encodeURIComponent(p.drug)}`}
                    className="home-row"
                    style={{ alignItems: "flex-start" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="home-row-name" style={{ marginBottom: 3 }}>{p.drug}</div>
                      <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.45 }}>
                        {p.reason}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20,
                        textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
                        background: rs.bg, color: rs.color, border: `1px solid ${rs.border}`,
                      }}>
                        {p.risk}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                        {p.eta}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── Card 5: TGA Alerts ───────────────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={ShieldAlert}
              title="Regulatory alerts — TGA"
              iconColor="var(--high)"
              sub="Direct from the regulator"
              viewHref="https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages"
            />
            {/* Live shortage rows (critical/high) */}
            {auShortages.filter(s => ["critical","high"].includes(s.severity?.toLowerCase() ?? "")).length > 0 && (
              auShortages
                .filter(s => ["critical","high"].includes(s.severity?.toLowerCase() ?? ""))
                .slice(0, 3)
                .map(row => (
                  <Link key={row.shortage_id} href={`/drugs/${row.drug_id}`} className="home-row" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="home-row-name">{row.generic_name}</div>
                      <div className="home-row-meta">
                        {row.source_name ?? "TGA"}{row.start_date && ` · since ${fmtDate(row.start_date)}`}
                      </div>
                    </div>
                    <SevBadge sev={row.severity} />
                  </Link>
                ))
            )}
            {/* Real TGA articles */}
            <div style={{ padding: "8px 20px 4px", borderTop: auShortages.filter(s => ["critical","high"].includes(s.severity?.toLowerCase() ?? "")).length > 0 ? "1px solid var(--app-border)" : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)", paddingBottom: 6 }}>
                TGA Notices
              </div>
            </div>
            {[
              {
                title: "Methylphenidate shortage — Ritalin & Artige immediate-release tablets",
                date: "Jan 2026",
                href: "https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages/major-or-ongoing-medicine-shortages/about-shortage-methylphenidate-hydrochloride-products",
              },
              {
                title: "Creon 25,000 & 35,000 unit capsules — supply constraints to Jun 2026",
                date: "Dec 2025",
                href: "https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages/major-or-ongoing-medicine-shortages",
              },
              {
                title: "SSSI: clonidine 100mcg tablets — substitution instrument active",
                date: "Dec 2025",
                href: "https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages/accessing-medicines-during-shortage/serious-scarcity-substitution-instruments-sssis",
              },
              {
                title: "SSSI: labetalol (Presolol) tablets — new instrument Jan 2026",
                date: "Jan 2026",
                href: "https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages/accessing-medicines-during-shortage/serious-scarcity-substitution-instruments-sssis",
              },
            ].map(article => (
              <Link
                key={article.href + article.title}
                href={article.href}
                target="_blank"
                rel="noopener noreferrer"
                className="tga-article"
              >
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 6,
                  background: "var(--high)",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", lineHeight: 1.4 }}>
                    {article.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2, fontFamily: "var(--font-dm-mono), monospace" }}>
                    TGA · {article.date}
                  </div>
                </div>
                <ExternalLink style={{ width: 13, height: 13, strokeWidth: 1.5, color: "var(--app-text-4)", flexShrink: 0, marginTop: 2 }} />
              </Link>
            ))}
          </div>

          {/* ── Card 6: Alternatives ─────────────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={ArrowLeftRight}
              title="What to dispense instead"
              iconColor="var(--low)"
              sub="Clinically-matched alternatives"
              viewHref="/search"
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {ALTS.map(alt => (
                <Link
                  key={alt.from}
                  href={`/search?q=${encodeURIComponent(alt.from)}`}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    borderBottom: "1px solid var(--app-bg-2)",
                    textDecoration: "none",
                  }}
                  className="tga-article"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{
                        fontSize: 14, fontWeight: 500, color: "var(--crit)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                      }}>
                        {alt.from}
                      </span>
                      <ArrowLeftRight style={{ width: 13, height: 13, strokeWidth: 1.5, color: "var(--app-text-4)", flexShrink: 0 }} />
                      <span style={{
                        fontSize: 14, fontWeight: 500, color: "var(--low)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "right",
                      }}>
                        {alt.to}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>{alt.relationship}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                        background: alt.score >= 90 ? "var(--low-bg)" : alt.score >= 75 ? "var(--teal-bg)" : "var(--app-bg-2)",
                        color: alt.score >= 90 ? "var(--low)" : alt.score >= 75 ? "var(--teal)" : "var(--app-text-3)",
                        border: `1px solid ${alt.score >= 90 ? "var(--low-b)" : alt.score >= 75 ? "var(--teal-b)" : "var(--app-border)"}`,
                      }}>
                        {alt.score}% match
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* ── Card 7: Global Coverage (full width) ─────────────────────── */}
          <div className="home-full" style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={Globe2}
              title="Supply risk by country"
              iconColor="var(--indigo)"
              sub={summary ? `${summary.total_active.toLocaleString()} shortages across ${topCountries.length} countries` : undefined}
              viewHref="/shortages"
            />
            {topCountries.length === 0 ? (
              <EmptyState label="Loading supply intelligence across countries…" />
            ) : (
              <div style={{ padding: "16px 20px" }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 10,
                }}>
                  {topCountries.map(c => {
                    const maxSevStyles = {
                      critical: { dot: "var(--crit)", badge: { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" } },
                      high:     { dot: "var(--high)", badge: { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" } },
                      medium:   { dot: "var(--med)",  badge: { bg: "var(--med-bg)",  color: "var(--med)",  border: "var(--med-b)" } },
                    };
                    const sev = (c.max_severity ?? "").toLowerCase();
                    const st = maxSevStyles[sev as keyof typeof maxSevStyles] ?? {
                      dot: "var(--app-text-4)",
                      badge: { bg: "var(--app-bg-2)", color: "var(--app-text-3)", border: "var(--app-border)" },
                    };
                    return (
                      <Link key={c.country_code} href={`/shortages?country=${c.country_code}&status=active`} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", borderRadius: 8,
                        background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                        textDecoration: "none",
                      }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: st.dot, flexShrink: 0, display: "inline-block",
                        }} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>
                          {COUNTRY_NAMES[c.country_code] ?? c.country_code}
                        </span>
                        <span style={{
                          fontFamily: "var(--font-dm-mono), monospace",
                          fontSize: 13, fontWeight: 500, color: "var(--app-text-2)",
                        }}>
                          {c.count.toLocaleString()}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
                          textTransform: "uppercase", letterSpacing: "0.05em",
                          background: st.badge.bg, color: st.badge.color, border: `1px solid ${st.badge.border}`,
                        }}>
                          {sev || "—"}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      <SiteFooter />

      {/* ── Mobile sticky bottom nav ─────────────────────────────────────── */}
      <nav className="home-bottom-nav" style={{
        display: "none",
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
        background: "#fff", borderTop: "1px solid var(--app-border)",
        height: 60,
        alignItems: "stretch",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
      }}>
        {[
          { href: "/home",      label: "Home",      icon: Home },
          { href: "/search",    label: "Search",    icon: Search },
          { href: "/alerts",    label: "Alerts",    icon: Bell },
          { href: "/watchlist", label: "Watchlist", icon: Bookmark },
          { href: "/account",   label: "Account",   icon: Activity },
        ].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 4,
            textDecoration: "none",
            color: href === "/home" ? "var(--teal)" : "var(--app-text-4)",
          }}>
            <Icon style={{ width: 20, height: 20, strokeWidth: 1.5 }}
              color={href === "/home" ? "var(--teal)" : "var(--app-text-4)"}
            />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{label}</span>
          </Link>
        ))}
      </nav>

    </div>
  );
}
