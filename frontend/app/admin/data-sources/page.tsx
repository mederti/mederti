/**
 * Data-source health dashboard.
 *
 * One page that answers "what data does Mederti actually have and is
 * it fresh?" — both for the regulator-feed scrapers (shortage_events,
 * recalls, raw_scrapes) and for the reference-data importers we built
 * during Paths A and B.
 *
 * Server-rendered. All queries gracefully degrade if a table is
 * missing (e.g. before its migration has been applied).
 */
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";


interface RegulatorRow {
  id: string;
  name: string;
  country_code: string | null;
  is_active: boolean | null;
  last_scraped_at: string | null;
  source_type: string | null;
}

interface ReferenceRow {
  label: string;
  table: string;
  rows: number | null;
  description: string;
  migration: string;
  last_imported: string | null;
  status: "live" | "empty" | "missing";
}


async function safeCount(sb: ReturnType<typeof getSupabaseAdmin>, table: string): Promise<number | null> {
  try {
    const r = await sb.from(table).select("*", { count: "exact", head: true });
    return r.count ?? 0;
  } catch {
    return null;
  }
}

async function safeMaxTs(sb: ReturnType<typeof getSupabaseAdmin>, table: string, col: string): Promise<string | null> {
  try {
    const r = await sb.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
    const row = r.data as Record<string, unknown> | null;
    return row ? String(row[col] ?? "") || null : null;
  } catch { return null; }
}


function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function freshnessLabel(hrs: number | null): { text: string; tone: "good" | "warn" | "stale" | "unknown" } {
  if (hrs === null) return { text: "no record", tone: "unknown" };
  if (hrs < 26)     return { text: `${Math.round(hrs)}h ago`, tone: "good" };
  if (hrs < 24 * 7) return { text: `${Math.round(hrs / 24)}d ago`, tone: "warn" };
  return              { text: `${Math.round(hrs / 24)}d ago`,   tone: "stale" };
}

const TONE_COLORS: Record<"good" | "warn" | "stale" | "unknown", { c: string; bg: string; b: string }> = {
  good:    { c: "var(--low)",       bg: "var(--low-bg)",  b: "var(--low-b)"      },
  warn:    { c: "var(--med)",       bg: "var(--med-bg)",  b: "var(--med-b)"      },
  stale:   { c: "var(--crit)",      bg: "var(--crit-bg)", b: "var(--crit-b)"     },
  unknown: { c: "var(--app-text-4)", bg: "var(--app-bg-2)", b: "var(--app-border)" },
};


export default async function DataSourcesPage() {
  const sb = getSupabaseAdmin();

  // ── 1. Regulator feed scrapers (the existing shortage / recall side) ──
  const regulators: RegulatorRow[] = (
    (await sb
      .from("data_sources")
      .select("id, name, country_code, is_active, last_scraped_at, source_type")
      .order("name")
      .limit(200)
    ).data as RegulatorRow[] | null
  ) ?? [];

  // ── 2. Volume by target table (the actual signal) ──
  const [drugsCount, shortagesCount, recallsCount, alternativesCount] = await Promise.all([
    safeCount(sb, "drugs"),
    safeCount(sb, "shortage_events"),
    safeCount(sb, "recalls"),
    safeCount(sb, "drug_alternatives"),
  ]);

  // ── 3. Reference-data ingests (Paths A + B) ──
  const referenceTables: ReferenceRow[] = [];
  const refSpec: Array<[string, string, string, string, string]> = [
    // [label, table, description, migration, lastImportedColumn]
    ["WHO ATC/DDD index",          "atc_codes",             "Canonical drug-class hierarchy + DDD values from WHO Collaborating Centre.",                "031", "imported_at"],
    ["Drug synonyms",              "drug_synonyms",         "INN ⇄ USAN ⇄ BAN aliases (paracetamol↔acetaminophen, etc.).",                                "026", "created_at"],
    ["RxNorm mapping",             "drug_rxnorm",           "US universal clinical IDs (RxCUI) per Mederti drug + ingredient links.",                     "032", "imported_at"],
    ["API supplier summary",       "api_supply_summary",    "PharmaCompass aggregate counts per API (USDMF, CEP, JDMF, KDMF, EU WC).",                    "032", "imported_at"],
    ["API manufacturers (per-maker)", "api_manufacturers",  "Schema reserved — per-maker DMF/CEP rows ingest once a licensed source is connected.",       "032", "imported_at"],
    ["OECD pharma macro",          "oecd_pharma_metrics",   "Per-country × ATC class × year pharmaceutical sales, consumption, generic share.",           "033", "imported_at"],
    ["SNOMED CT",                  "snomed_concepts",       "Drug-extension concepts from SNOMED — awaiting AU/UK affiliate license.",                    "033", "imported_at"],
    ["Drug alternatives",          "drug_alternatives",     "Therapeutic alternative graph (clinical equivalence + paediatric branches).",                "—",   "created_at"],
    ["Intelligence sources",       "intelligence_sources",  "Macro signal catalog (WHO, OECD, IMS, FDA enforcement) for the briefings layer.",            "—",   "created_at"],
  ];

  for (const [label, table, description, migration, tsCol] of refSpec) {
    const rows = await safeCount(sb, table);
    const last = rows === null ? null : await safeMaxTs(sb, table, tsCol);
    referenceTables.push({
      label, table, rows, description, migration,
      last_imported: last,
      status: rows === null ? "missing" : rows === 0 ? "empty" : "live",
    });
  }

  // ── 4. Recent raw_scrapes (success / fail / processing buckets) ──
  let recentRuns: { status: string; count: number }[] = [];
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const r = await sb
      .from("raw_scrapes")
      .select("status, id")
      .gte("created_at", cutoff)
      .limit(2000);
    const map = new Map<string, number>();
    for (const row of (r.data as Array<{ status: string | null }> | null) ?? []) {
      const k = row.status ?? "unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    recentRuns = [...map.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  } catch { /* raw_scrapes table may not exist on slim deployments */ }

  // Sort regulators by freshness
  const regsRanked = [...regulators].sort((a, b) => {
    const ha = hoursSince(a.last_scraped_at) ?? Number.POSITIVE_INFINITY;
    const hb = hoursSince(b.last_scraped_at) ?? Number.POSITIVE_INFINITY;
    return ha - hb;
  });

  // Tally regulator health
  const totals = { fresh: 0, warm: 0, stale: 0, unknown: 0 };
  for (const r of regulators) {
    const h = hoursSince(r.last_scraped_at);
    if (h === null) totals.unknown++;
    else if (h < 26) totals.fresh++;
    else if (h < 24 * 7) totals.warm++;
    else totals.stale++;
  }


  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg-2)", color: "var(--app-text)" }}>
      <SiteNav />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Header */}
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.08em", color: "var(--teal)",
          fontFamily: "var(--font-dm-mono), monospace", marginBottom: 8,
        }}>
          Mederti · Internal · Data Health
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em", marginBottom: 10 }}>
          Data source health
        </h1>
        <p style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.6, marginBottom: 28, maxWidth: 760 }}>
          Live state of every data source feeding Mederti: which regulator
          scrapers are fresh, which are stale, and which reference-data
          ingests have landed. Auto-refreshed on every page load.
        </p>

        {/* ── KPI strip ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10, marginBottom: 28,
        }}>
          {[
            { label: "Regulator feeds", value: regulators.length, sub: `${totals.fresh} fresh · ${totals.stale} stale` },
            { label: "Drugs",           value: drugsCount,        sub: "canonical entities" },
            { label: "Shortage events", value: shortagesCount,    sub: "deduplicated" },
            { label: "Recalls",         value: recallsCount,      sub: "Class I/II/III" },
            { label: "Alternatives",    value: alternativesCount, sub: "therapeutic links" },
          ].map(k => (
            <div key={k.label} style={{
              background: "var(--app-bg)", border: "1px solid var(--app-border)",
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--app-text-4)",
                textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "var(--app-text)",
                marginTop: 4, fontFamily: "var(--font-dm-mono), monospace" }}>
                {k.value === null ? "—" : k.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "var(--app-text-3)", marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Section 1: Reference-data ingests ── */}
        <SectionHeader title="Reference-data ingests" subtitle="Paths A + B free-data pipeline" />
        <div style={{
          background: "var(--app-bg)", border: "1px solid var(--app-border)",
          borderRadius: 12, overflow: "hidden", marginBottom: 32,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "var(--app-bg-2)" }}>
              <tr>
                {["Source", "Migration", "Status", "Rows", "Last import"].map(h => (
                  <th key={h} style={{
                    textAlign: "left", padding: "10px 14px",
                    fontSize: 11, fontWeight: 600, color: "var(--app-text-4)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    borderBottom: "1px solid var(--app-border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {referenceTables.map(r => {
                const tone =
                  r.status === "live" ? "good"
                  : r.status === "empty" ? "warn"
                  : "stale";
                const t = TONE_COLORS[tone];
                return (
                  <tr key={r.table} style={{ borderTop: "1px solid var(--app-border)" }}>
                    <td style={{ padding: "12px 14px", fontSize: 13 }}>
                      <div style={{ fontWeight: 600, color: "var(--app-text)" }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: "var(--app-text-3)", marginTop: 2, lineHeight: 1.5 }}>
                        {r.description}
                      </div>
                      <code style={{ fontSize: 10, color: "var(--app-text-4)",
                        fontFamily: "var(--font-dm-mono), monospace", marginTop: 3, display: "inline-block" }}>
                        {r.table}
                      </code>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--app-text-3)",
                      fontFamily: "var(--font-dm-mono), monospace" }}>{r.migration}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{
                        fontSize: 10, padding: "3px 8px", borderRadius: 5,
                        fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
                        fontFamily: "var(--font-dm-mono), monospace",
                        background: t.bg, color: t.c, border: `1px solid ${t.b}`,
                      }}>
                        {r.status === "missing" ? "table missing" : r.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--app-text)",
                      fontFamily: "var(--font-dm-mono), monospace" }}>
                      {r.rows === null ? "—" : r.rows.toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--app-text-3)" }}>
                      {r.last_imported
                        ? new Date(r.last_imported).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Section 2: Recent scraper runs ── */}
        {recentRuns.length > 0 && (
          <>
            <SectionHeader title="Recent scraper runs (last 7 days)" subtitle="from raw_scrapes" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 32 }}>
              {recentRuns.map(r => {
                const isOk = r.status === "complete" || r.status === "success" || r.status === "ok";
                const isProc = r.status === "processing";
                const tone = isOk ? "good" : isProc ? "warn" : "stale";
                const t = TONE_COLORS[tone];
                return (
                  <div key={r.status} style={{
                    padding: "12px 18px", borderRadius: 9,
                    background: t.bg, border: `1px solid ${t.b}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: t.c,
                      textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.status}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: t.c,
                      fontFamily: "var(--font-dm-mono), monospace", marginTop: 2 }}>
                      {r.count}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Section 3: Regulator feed health ── */}
        <SectionHeader
          title="Regulator feeds"
          subtitle={`${regulators.length} sources · ${totals.fresh} fresh · ${totals.warm} warm · ${totals.stale} stale · ${totals.unknown} unknown`}
        />
        <div style={{
          background: "var(--app-bg)", border: "1px solid var(--app-border)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "var(--app-bg-2)" }}>
              <tr>
                {["Source", "Country", "Type", "Active", "Last scrape"].map(h => (
                  <th key={h} style={{
                    textAlign: "left", padding: "10px 14px",
                    fontSize: 11, fontWeight: 600, color: "var(--app-text-4)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    borderBottom: "1px solid var(--app-border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regsRanked.map(r => {
                const fr = freshnessLabel(hoursSince(r.last_scraped_at));
                const t = TONE_COLORS[fr.tone];
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--app-border)" }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500,
                      color: "var(--app-text)" }}>{r.name}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--app-text-3)",
                      fontFamily: "var(--font-dm-mono), monospace" }}>
                      {r.country_code ?? "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--app-text-3)" }}>
                      {r.source_type ?? "shortage"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12 }}>
                      {r.is_active
                        ? <span style={{ color: "var(--low)" }}>✓</span>
                        : <span style={{ color: "var(--app-text-4)" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontSize: 11, padding: "3px 9px", borderRadius: 5,
                        background: t.bg, color: t.c, border: `1px solid ${t.b}`,
                        fontFamily: "var(--font-dm-mono), monospace",
                      }}>
                        {fr.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer link */}
        <div style={{ marginTop: 24, fontSize: 12, color: "var(--app-text-4)" }}>
          See also: <Link href="/admin/naming-graph" style={{ color: "var(--teal)" }}>
            Naming reconciliation graph
          </Link>
        </div>
      </div>
    </div>
  );
}


function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em" }}>{title}</div>
      {subtitle && (
        <div style={{
          fontSize: 11, color: "var(--app-text-4)",
          fontFamily: "var(--font-dm-mono), monospace",
        }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
