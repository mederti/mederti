"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import MarketSidebar from "@/app/intelligence/MarketSidebar";
import MorningBriefing from "./MorningBriefing";
import { useUserProfile } from "@/lib/hooks/use-user-profile";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";
import { riskStyle } from "@/lib/risk-score";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  TrendingUp, AlertTriangle, BarChart3, Activity, Shield, Globe,
  Search, X, Plus, Trash2, LogIn, ArrowUpRight,
} from "lucide-react";

/* ── Country flags + names ── */
const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷",
  IT: "🇮🇹", ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴",
  FI: "🇫🇮", CH: "🇨🇭", SE: "🇸🇪", AT: "🇦🇹", BE: "🇧🇪", NL: "🇳🇱",
  JP: "🇯🇵", DK: "🇩🇰", PT: "🇵🇹", PL: "🇵🇱", CZ: "🇨🇿", HU: "🇭🇺",
  EU: "🇪🇺",
};
const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan", DK: "Denmark",
  PT: "Portugal", PL: "Poland", CZ: "Czechia", HU: "Hungary",
};
const ICON_SIZE = { width: 15, height: 15, strokeWidth: 1.5 } as const;

/* ── Severity badge ── */
const SEV_STYLE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  critical: { label: "CRITICAL", bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" },
  high:     { label: "HIGH",     bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" },
  medium:   { label: "MEDIUM",   bg: "var(--med-bg)",  color: "var(--med)",  border: "var(--med-b)" },
  low:      { label: "LOW",      bg: "var(--low-bg)",  color: "var(--low)",  border: "var(--low-b)" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity?.toLowerCase()] ?? SEV_STYLE.low;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: "nowrap", letterSpacing: "0.04em",
    }}>
      {s.label}
    </span>
  );
}

/* ── Section header ── */
function SectionHeader({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
      textTransform: "uppercase", color: "var(--app-text-4)",
      paddingBottom: 16, marginBottom: 28,
      borderBottom: "2px solid var(--app-text)",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      {icon}
      {children}
    </div>
  );
}

/* ── Empty state ── */
function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div style={{
      padding: "40px 24px", textAlign: "center",
      background: "var(--app-bg)", borderRadius: 10,
      border: "1px solid var(--app-border)",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        background: "var(--app-bg-2, #f1f5f9)", border: "1px solid var(--app-border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 14px",
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--app-text-3, #94a3b8)", lineHeight: 1.5, maxWidth: 380, margin: "0 auto" }}>{description}</div>
    </div>
  );
}

/* ── Country flags row ── */
function CountryFlags({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 2, fontSize: 14 }}>
      {codes.slice(0, 6).map((c) => (
        <span key={c} title={COUNTRY_NAMES[c] ?? c}>{FLAGS[c] ?? c}</span>
      ))}
      {codes.length > 6 && (
        <span style={{ fontSize: 11, color: "var(--app-text-4)", marginLeft: 2 }}>+{codes.length - 6}</span>
      )}
    </span>
  );
}

/* ── Time ago helper ── */
function timeAgo(iso: string): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 1: Supply Opportunities
   ═══════════════════════════════════════════════════════════════════════ */
interface Opportunity {
  drug_id: string; drug_name: string; severity: string;
  country_count: number; countries: string[];
  active_shortage_count: number; oldest_reported: string;
}

function SupplyOpportunities() {
  const [data, setData] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/opportunities")
      .then((r) => r.json())
      .then((d) => setData(d.opportunities ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section style={{ paddingTop: 32 }}>
      <SectionHeader icon={<TrendingUp {...ICON_SIZE} />}>Supply Opportunities</SectionHeader>
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={<TrendingUp {...ICON_SIZE} color="var(--app-text-4)" />}
          title="No high-severity shortages detected"
          description="Check back as new shortage events are reported across monitored markets."
        />
      ) : (
        <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 90px 120px 80px",
            padding: "10px 16px", fontSize: 11, fontWeight: 600,
            color: "var(--app-text-4)", letterSpacing: "0.04em",
            textTransform: "uppercase", background: "var(--app-bg)",
            borderBottom: "1px solid var(--app-border)",
          }}>
            <span>Drug</span>
            <span>Severity</span>
            <span>Countries</span>
            <span style={{ textAlign: "right" }}>Events</span>
          </div>
          {data.map((opp, i) => (
            <Link
              key={opp.drug_id}
              href={`/drugs/${opp.drug_id}`}
              style={{
                display: "grid", gridTemplateColumns: "1fr 90px 120px 80px",
                padding: "12px 16px", alignItems: "center",
                textDecoration: "none", color: "inherit",
                borderBottom: i < data.length - 1 ? "1px solid var(--app-border)" : "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--app-bg)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {opp.drug_name}
              </span>
              <SeverityBadge severity={opp.severity} />
              <CountryFlags codes={opp.countries} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", textAlign: "right", fontFamily: "var(--font-dm-mono), monospace" }}>
                {opp.active_shortage_count}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 2: Market Gap Analysis
   ═══════════════════════════════════════════════════════════════════════ */
interface Gap {
  drug_id: string; drug_name: string;
  active_shortage_count: number; registered_product_count: number;
  gap_score: number; affected_countries: string[];
}

function MarketGapAnalysis() {
  const [data, setData] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/market-gaps")
      .then((r) => r.json())
      .then((d) => setData(d.gaps ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section style={{ paddingTop: 40 }}>
      <SectionHeader icon={<BarChart3 {...ICON_SIZE} />}>Market Gap Analysis</SectionHeader>
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={<BarChart3 {...ICON_SIZE} color="var(--app-text-4)" />}
          title="No market gaps identified"
          description="Market gap analysis compares shortage demand against registered product supply."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {data.map((gap) => {
            const maxScore = Math.max(...data.map((g) => g.gap_score), 1);
            const barWidth = Math.min((gap.gap_score / maxScore) * 100, 100);
            return (
              <Link
                key={gap.drug_id}
                href={`/drugs/${gap.drug_id}`}
                style={{
                  display: "block", padding: 16, borderRadius: 8,
                  border: "1px solid var(--app-border)", textDecoration: "none", color: "inherit",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = ""; }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {gap.drug_name}
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--app-text-4)", marginBottom: 10 }}>
                  <span><strong style={{ color: "var(--crit)" }}>{gap.active_shortage_count}</strong> shortages</span>
                  <span><strong style={{ color: "var(--app-text)" }}>{gap.registered_product_count}</strong> products</span>
                </div>
                {/* Gap score bar */}
                <div style={{ height: 6, background: "var(--app-bg)", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{
                    height: "100%", width: `${barWidth}%`,
                    background: barWidth > 60 ? "var(--crit)" : barWidth > 30 ? "var(--high)" : "var(--teal)",
                    borderRadius: 3, transition: "width 0.3s",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)" }}>Gap score: {gap.gap_score}</span>
                  <CountryFlags codes={gap.affected_countries} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 3: Demand Signals
   ═══════════════════════════════════════════════════════════════════════ */
interface DemandKPIs { new_last_7d: number; new_prior_7d: number; acceleration_pct: number; new_last_30d: number; }
interface TrendingDrug {
  drug_id: string; drug_name: string;
  new_events_7d: number; new_events_30d: number;
  max_severity: string; countries: string[];
}

function DemandSignals() {
  const [kpis, setKpis] = useState<DemandKPIs | null>(null);
  const [trending, setTrending] = useState<TrendingDrug[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/demand-signals")
      .then((r) => r.json())
      .then((d) => { setKpis(d.kpis); setTrending(d.trending ?? []); })
      .catch(() => { setKpis(null); setTrending([]); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section style={{ paddingTop: 40 }}>
      <SectionHeader icon={<Activity {...ICON_SIZE} />}>Demand Signals</SectionHeader>
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : !kpis ? (
        <EmptyState
          icon={<Activity {...ICON_SIZE} color="var(--app-text-4)" />}
          title="No trending signals"
          description="Demand signals track new shortage declarations and acceleration patterns."
        />
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            {[
              { label: "New (7d)", value: kpis.new_last_7d },
              { label: "Acceleration", value: `${kpis.acceleration_pct >= 0 ? "+" : ""}${kpis.acceleration_pct}%` },
              { label: "New (30d)", value: kpis.new_last_30d },
            ].map((kpi) => (
              <div key={kpi.label} style={{
                padding: "16px", borderRadius: 8,
                border: "1px solid var(--app-border)", textAlign: "center",
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--app-text)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {kpi.value}
                </div>
                <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>
                  {kpi.label}
                </div>
              </div>
            ))}
          </div>

          {/* Trending list */}
          {trending.length > 0 && (
            <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
              {trending.map((t, i) => (
                <Link
                  key={t.drug_id}
                  href={`/drugs/${t.drug_id}`}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", textDecoration: "none", color: "inherit",
                    borderBottom: i < trending.length - 1 ? "1px solid var(--app-border)" : "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--app-bg)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.drug_name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>
                      {t.new_events_7d} new this week · {t.new_events_30d} this month
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <CountryFlags codes={t.countries} />
                    <SeverityBadge severity={t.max_severity} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 4: Portfolio Risk Monitor
   ═══════════════════════════════════════════════════════════════════════ */
interface PortfolioDrug {
  id: string; drug_id: string; drug_name: string;
  notes: string | null; added_at: string;
  risk_score: number; risk_level: string; primary_signal: string;
  active_shortage_count: number; countries_affected: string[];
  max_severity: string;
}

function PortfolioRiskMonitor() {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<PortfolioDrug[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchPortfolio = useCallback(() => {
    fetch("/api/supplier/portfolio")
      .then((r) => r.json())
      .then((d) => setPortfolio(d.portfolio ?? []))
      .catch(() => setPortfolio([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);

  const autocomplete = useAutocomplete({
    onSelect: async (item) => {
      setAdding(true);
      try {
        await fetch("/api/supplier/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drug_id: item.id }),
        });
        autocomplete.clear();
        fetchPortfolio();
      } catch { /* ignore */ }
      setAdding(false);
    },
    onSubmit: (q) => {
      if (q.trim()) router.push(`/search?q=${encodeURIComponent(q)}`);
    },
    limit: 6,
  });

  const removeDrug = async (drugId: string) => {
    setRemoving(drugId);
    try {
      await fetch("/api/supplier/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drug_id: drugId }),
      });
      fetchPortfolio();
    } catch { /* ignore */ }
    setRemoving(null);
  };

  return (
    <section style={{ paddingTop: 40 }}>
      <SectionHeader icon={<Shield {...ICON_SIZE} />}>Portfolio Risk Monitor</SectionHeader>

      {/* Drug search */}
      <div ref={autocomplete.containerRef} style={{ position: "relative", marginBottom: 24 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 8,
          border: "1px solid var(--app-border)",
          background: "#fff",
        }}>
          {adding ? (
            <div style={{ width: 16, height: 16, border: "2px solid var(--teal)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
          ) : (
            <Search style={{ width: 16, height: 16, color: "var(--app-text-4)", flexShrink: 0 }} />
          )}
          <input
            {...autocomplete.inputProps}
            placeholder="Search drugs to add to your portfolio…"
            style={{
              flex: 1, border: "none", outline: "none", fontSize: 14,
              background: "transparent", color: "var(--app-text)",
            }}
          />
          {autocomplete.query && (
            <button
              onClick={() => autocomplete.clear()}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
            >
              <X style={{ width: 14, height: 14, color: "var(--app-text-4)" }} />
            </button>
          )}
          <Plus style={{ width: 16, height: 16, color: "var(--app-text-4)", flexShrink: 0 }} />
        </div>
        {autocomplete.isOpen && (
          <AutocompleteDropdown
            items={autocomplete.items}
            cursor={autocomplete.cursor}
            loading={autocomplete.loading}
            query={autocomplete.query}
            listId={autocomplete.inputProps["aria-controls"]}
            onSelect={async (item) => {
              setAdding(true);
              try {
                await fetch("/api/supplier/portfolio", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ drug_id: item.id }),
                });
                autocomplete.clear();
                fetchPortfolio();
              } catch { /* ignore */ }
              setAdding(false);
            }}
            onHover={() => {}}
          />
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* Portfolio table */}
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : portfolio.length === 0 ? (
        <EmptyState
          icon={<Shield {...ICON_SIZE} color="var(--app-text-4)" />}
          title="Your portfolio is empty"
          description="Search for drugs above to start monitoring supply risk across your portfolio."
        />
      ) : (
        <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
          {portfolio.map((drug, i) => {
            const rs = riskStyle(drug.risk_level);
            return (
              <div
                key={drug.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px",
                  borderBottom: i < portfolio.length - 1 ? "1px solid var(--app-border)" : "none",
                }}
              >
                {/* Risk score circle */}
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, fontFamily: "var(--font-dm-mono), monospace",
                  background: rs.bg, color: rs.color, border: `2px solid ${rs.border}`,
                  flexShrink: 0,
                }}>
                  {drug.risk_score}
                </div>

                {/* Drug info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/drugs/${drug.drug_id}`} style={{
                    fontSize: 14, fontWeight: 600, color: "var(--app-text)",
                    textDecoration: "none",
                  }}>
                    {drug.drug_name}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>
                    {drug.risk_level} · {drug.primary_signal}
                  </div>
                </div>

                {/* Shortage info */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {drug.active_shortage_count > 0 && (
                    <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                      {drug.active_shortage_count} shortage{drug.active_shortage_count !== 1 ? "s" : ""}
                    </span>
                  )}
                  <CountryFlags codes={drug.countries_affected} />
                  {drug.max_severity !== "low" && <SeverityBadge severity={drug.max_severity} />}
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeDrug(drug.drug_id)}
                  disabled={removing === drug.drug_id}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 6, borderRadius: 4, display: "flex",
                    opacity: removing === drug.drug_id ? 0.4 : 0.5,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.5"; }}
                  title="Remove from portfolio"
                >
                  <Trash2 style={{ width: 14, height: 14, color: "var(--crit)" }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 5: Regulatory Signals
   ═══════════════════════════════════════════════════════════════════════ */
interface FdaApproval { drugName: string; applicationType: string; status: string; date: string; url: string; }
interface SourceUpdate { source_name: string; country_code: string; last_scraped: string; source_url: string; shortage_count_active: number; }

function RegulatorySignals() {
  const [fda, setFda] = useState<FdaApproval[]>([]);
  const [sources, setSources] = useState<SourceUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/regulatory")
      .then((r) => r.json())
      .then((d) => { setFda(d.fda_approvals ?? []); setSources(d.active_source_updates ?? []); })
      .catch(() => { setFda([]); setSources([]); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section style={{ paddingTop: 40 }}>
      <SectionHeader icon={<AlertTriangle {...ICON_SIZE} />}>Regulatory Signals</SectionHeader>
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : fda.length === 0 && sources.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle {...ICON_SIZE} color="var(--app-text-4)" />}
          title="No recent regulatory signals"
          description="FDA approval and regulatory update tracking is refreshed throughout the day."
        />
      ) : (
        <>
          {/* FDA approvals */}
          {fda.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--app-text)", marginBottom: 12 }}>Recent FDA Approvals</div>
              <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
                {fda.map((f, i) => (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px", textDecoration: "none", color: "inherit",
                      borderBottom: i < fda.length - 1 ? "1px solid var(--app-border)" : "none",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--app-bg)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>{f.drugName}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 3,
                        background: "var(--app-bg)", color: "var(--app-text-4)",
                        marginLeft: 8, fontFamily: "var(--font-dm-mono), monospace",
                      }}>
                        {f.applicationType}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#16a34a", textTransform: "uppercase" }}>{f.status}</span>
                      <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>{f.date}</span>
                      <ArrowUpRight style={{ width: 12, height: 12, color: "var(--app-text-4)" }} />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Active regulatory source updates */}
          {sources.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--app-text)", marginBottom: 12 }}>Active Regulatory Sources</div>
              <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
                {sources.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px",
                      borderBottom: i < sources.length - 1 ? "1px solid var(--app-border)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 16 }}>{FLAGS[s.country_code] ?? "🌐"}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.source_name}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      {s.shortage_count_active > 0 && (
                        <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                          {s.shortage_count_active} active
                        </span>
                      )}
                      {s.last_scraped && (
                        <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                          {timeAgo(s.last_scraped)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 6: Access Pathways
   ═══════════════════════════════════════════════════════════════════════ */
interface Pathway {
  country_code: string; country_name: string;
  regulatory_body: string; source_url: string; source_type: string;
  active_shortage_count: number; critical_shortage_count: number;
}

function AccessPathways() {
  const [data, setData] = useState<Pathway[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/pathways")
      .then((r) => r.json())
      .then((d) => setData(d.pathways ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section style={{ paddingTop: 40, paddingBottom: 48 }}>
      <SectionHeader icon={<Globe {...ICON_SIZE} />}>Access Pathways</SectionHeader>
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={<Globe {...ICON_SIZE} color="var(--app-text-4)" />}
          title="No pathway data available"
          description="Registration pathway intelligence is being expanded across monitored markets."
        />
      ) : (
        <div style={{ borderRadius: 8, border: "1px solid var(--app-border)", overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px",
            padding: "10px 16px", fontSize: 11, fontWeight: 600,
            color: "var(--app-text-4)", letterSpacing: "0.04em",
            textTransform: "uppercase", background: "var(--app-bg)",
            borderBottom: "1px solid var(--app-border)",
          }}>
            <span>Country</span>
            <span>Regulatory Body</span>
            <span style={{ textAlign: "right" }}>Active</span>
            <span style={{ textAlign: "right" }}>Critical</span>
          </div>
          {data.map((p, i) => (
            <a
              key={`${p.country_code}-${i}`}
              href={p.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px",
                padding: "12px 16px", alignItems: "center",
                textDecoration: "none", color: "inherit",
                borderBottom: i < data.length - 1 ? "1px solid var(--app-border)" : "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--app-bg)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>{FLAGS[p.country_code] ?? "🌐"}</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{p.country_name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.regulatory_body}
                </span>
                <ArrowUpRight style={{ width: 11, height: 11, color: "var(--app-text-4)", flexShrink: 0 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", fontFamily: "var(--font-dm-mono), monospace" }}>
                {p.active_shortage_count}
              </span>
              <span style={{
                fontSize: 13, fontWeight: 600, textAlign: "right",
                fontFamily: "var(--font-dm-mono), monospace",
                color: p.critical_shortage_count > 0 ? "var(--crit)" : "var(--app-text-4)",
              }}>
                {p.critical_shortage_count}
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function SupplierDashboardClient() {
  const { profile, loading: profileLoading, isSupplier } = useUserProfile();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthed(!!session);
    });
  }, []);

  const isLoading = authed === null || profileLoading;

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <SiteNav />

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 0" }}>
          <h1 style={{
            fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700,
            letterSpacing: "-0.02em", color: "#0f172a", margin: 0,
          }}>
            Supplier Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "8px 0 20px", lineHeight: 1.5 }}>
            Supply opportunity intelligence, real-time buyer enquiries, and inventory broadcast.
          </p>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
            <span style={{
              fontSize: 13, fontWeight: 600, color: "#0f172a",
              paddingBottom: 12, borderBottom: "2px solid #0f172a",
              cursor: "default",
            }}>Intelligence</span>
            <Link href="/supplier-dashboard/inbox" style={{
              fontSize: 13, fontWeight: 500, color: "#64748b",
              paddingBottom: 12, borderBottom: "2px solid transparent",
              textDecoration: "none",
            }}>Enquiry Inbox</Link>
            <Link href="/supplier-dashboard/inventory" style={{
              fontSize: 13, fontWeight: 500, color: "#64748b",
              paddingBottom: 12, borderBottom: "2px solid transparent",
              textDecoration: "none",
            }}>Inventory Broadcast</Link>
            <Link href="/supplier-dashboard/profile" style={{
              fontSize: 13, fontWeight: 500, color: "#64748b",
              paddingBottom: 12, borderBottom: "2px solid transparent",
              textDecoration: "none",
            }}>Profile</Link>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
        <div className="supplier-two-col" style={{ display: "flex", gap: 48, paddingTop: 0 }}>

          {/* Main content (65%) */}
          <div className="supplier-main-col" style={{ flex: "1 1 0%", minWidth: 0 }}>
            {false ? (
              <div style={{ padding: "64px 0", textAlign: "center", color: "var(--app-text-4)", fontSize: 14 }}>
                Loading…
              </div>
            ) : false ? (
              /* Not authenticated */
              <div style={{
                padding: "48px 32px", textAlign: "center",
                background: "var(--app-bg)", borderRadius: 12,
                border: "1px solid var(--app-border)", margin: "48px 0",
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "#fff", border: "1px solid var(--app-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 20px",
                }}>
                  <LogIn style={{ width: 24, height: 24, color: "var(--app-text-4)" }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>
                  Sign in to access the Supplier Dashboard
                </div>
                <p style={{ fontSize: 14, color: "var(--app-text-4)", lineHeight: 1.6, maxWidth: 400, margin: "0 auto 24px" }}>
                  The Supplier Dashboard provides supply opportunity intelligence, portfolio risk monitoring, and market gap analysis for pharmaceutical suppliers.
                </p>
                <Link
                  href="/login"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "12px 28px", borderRadius: 8,
                    background: "var(--teal)", color: "#fff",
                    fontSize: 14, fontWeight: 600, textDecoration: "none",
                  }}
                >
                  <LogIn style={{ width: 16, height: 16 }} />
                  Sign in
                </Link>
              </div>
            ) : false ? (
              /* Authenticated but not supplier role */
              <div style={{
                padding: "48px 32px", textAlign: "center",
                background: "var(--app-bg)", borderRadius: 12,
                border: "1px solid var(--app-border)", margin: "48px 0",
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "#fff", border: "1px solid var(--app-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 20px",
                }}>
                  <Shield style={{ width: 24, height: 24, color: "var(--teal)" }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>
                  Supplier access required
                </div>
                <p style={{ fontSize: 14, color: "var(--app-text-4)", lineHeight: 1.6, maxWidth: 400, margin: "0 auto 24px" }}>
                  Set your role to &ldquo;Supplier&rdquo; in your account settings to access supply intelligence, opportunity tracking, and portfolio risk monitoring.
                </p>
                <Link
                  href="/account"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "12px 28px", borderRadius: 8,
                    background: "var(--teal)", color: "#fff",
                    fontSize: 14, fontWeight: 600, textDecoration: "none",
                  }}
                >
                  Go to Account Settings
                </Link>
              </div>
            ) : (
              /* Full dashboard */
              <>
                <MorningBriefing />
                <SupplyOpportunities />
                <MarketGapAnalysis />
                <DemandSignals />
                <PortfolioRiskMonitor />
                <RegulatorySignals />
                <AccessPathways />
              </>
            )}
          </div>

          {/* Sidebar (35%) */}
          <div className="supplier-sidebar-col" style={{ width: 300, flexShrink: 0 }}>
            <div style={{ paddingTop: 48 }}>
              <MarketSidebar />
            </div>
          </div>

        </div>
      </div>

      <SiteFooter />

      <style>{`
        @media (max-width: 1024px) {
          .supplier-two-col { flex-direction: column !important; }
          .supplier-sidebar-col {
            width: 100% !important;
            border-top: 1px solid #e5e7eb;
            padding-top: 32px !important;
          }
          .supplier-sidebar-col > div { padding-top: 0 !important; }
          .market-sidebar { position: static !important; }
        }
        @media (max-width: 640px) {
          .supplier-main-col section > div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
