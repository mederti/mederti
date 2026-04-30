export const dynamic = "force-dynamic";

import { api, ShortageRow, SummaryResponse } from "@/lib/api";
import { truncateDrugName } from "@/lib/utils";
import Link from "next/link";
import {
  AlertCircle, Bell, ChevronRight,
  Home, Search, Bookmark, Activity,
} from "lucide-react";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import HomeSearchClient from "./HomeSearchClient";
import WatchlistCardClient from "./WatchlistCardClient";
import PredictiveSignals from "@/app/components/PredictiveSignals";
import { cookies } from "next/headers";

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
      padding: "1px 6px", borderRadius: 20,
      fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
      background: st.bg, color: st.color,
      flexShrink: 0,
    }}>
      {s || "—"}
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
      padding: "10px 16px", borderBottom: "1px solid var(--app-border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: `${iconColor}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon style={{ width: 12, height: 12, strokeWidth: 1.5 }} color={iconColor} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--app-text)" }}>
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
  let summary: SummaryResponse | null        = null;
  let auTotal = 0;

  try {
    const [shortRes, sumRes] = await Promise.allSettled([
      api.getShortages({ country: "AU", status: "active", page: 1, page_size: 5, sort: "severity" }),
      api.getSummary(),
    ]);

    if (shortRes.status === "fulfilled") {
      auShortages = shortRes.value.results;
      auTotal     = shortRes.value.total;
    }
    if (sumRes.status === "fulfilled") summary = sumRes.value;
  } catch {
    // graceful degradation — cards show empty states
  }


  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)", fontSize: 14 }}>

      {/* ── Responsive styles ────────────────────────────────────────────── */}
      <style>{`
        .home-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .home-full { grid-column: 1 / -1; }
        /* Card row base sizes */
        .home-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--app-bg-2); text-decoration: none; }
        .home-row:hover { background: var(--app-bg-2); }
        .home-row-name { font-size: 12px; font-weight: 500; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .home-row-meta { font-size: 10px; color: var(--app-text-4); margin-top: 0; }
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
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}>
        <div style={{ textAlign: "center", maxWidth: 900 }}>
          <h1 style={{
            fontSize: 42, fontWeight: 700, color: "var(--app-text)",
            letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 10,
          }}>
            Find Short-Supply Medicines Globally.
          </h1>
          <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.6, maxWidth: 560, margin: "0 auto" }}>
            Pharmacists, hospitals, and suppliers use Mederti to track drug shortages, find alternatives, and plan ahead — across 42 regulatory sources in 20+ countries.
          </p>
        </div>

        <HomeSearchClient />

        {/* Trust bar */}
        <div className="home-trust-bar" style={{
          display: "flex", alignItems: "center", gap: 24, flexWrap: "nowrap",
        }}>
          {[
            { val: (summary?.total_active ?? "…").toLocaleString(), label: "active shortages tracked", href: "/shortages?status=active" },
            { val: "42",   label: "regulatory sources", href: "/shortages" },
            { val: "20+",  label: "countries monitored", href: "/shortages" },
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

      {/* ── Predictive signals (cross-country lead indicator) ─────────────── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 0" }}>
        <PredictiveSignals country={(await cookies()).get("mederti-country")?.value?.toUpperCase() || "AU"} limit={6} />
      </div>

      {/* ── Card grid ────────────────────────────────────────────────────── */}
      <div className="home-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>
        <div className="home-grid">

          {/* ── Card 1: What's short right now — AU ──────────────────────── */}
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
                {auShortages.slice(0, 5).map(row => {
                  const age = daysSince(row.start_date);
                  return (
                    <Link key={row.shortage_id} href={`/drugs/${row.drug_id}`} className="home-row" style={{ alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="home-row-name">{truncateDrugName(row.generic_name)}</div>
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
                {auTotal > 5 && (
                  <div style={{ padding: "5px 14px" }}>
                    <Link href="/shortages?country=AU&status=active" style={{
                      fontSize: 11, color: "var(--teal)", fontWeight: 500, textDecoration: "none",
                    }}>
                      +{auTotal - 5} more shortages →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Card 2: My Watchlist & Orders ──────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            <CardHeader
              icon={Bookmark}
              title="My Watchlist & Orders"
              iconColor="var(--teal)"
              viewHref="/watchlist"
            />
            <WatchlistCardClient />
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
