export const dynamic = "force-dynamic";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { SEV_RANK, calculateRiskScore, riskStyle } from "@/lib/risk-score";
import Accordion from "./accordion";
import DrugChatPanel from "./drug-chat-panel";
import { buildAiInsightText } from "../build-insight-text";

interface Props {
  params: Promise<{ id: string }>;
}

/* ── Flags ── */
const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}", US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", CA: "\u{1F1E8}\u{1F1E6}",
  DE: "\u{1F1E9}\u{1F1EA}", FR: "\u{1F1EB}\u{1F1F7}", IT: "\u{1F1EE}\u{1F1F9}", ES: "\u{1F1EA}\u{1F1F8}",
  EU: "\u{1F1EA}\u{1F1FA}", NZ: "\u{1F1F3}\u{1F1FF}", SG: "\u{1F1F8}\u{1F1EC}", IE: "\u{1F1EE}\u{1F1EA}",
  NO: "\u{1F1F3}\u{1F1F4}", FI: "\u{1F1EB}\u{1F1EE}", CH: "\u{1F1E8}\u{1F1ED}", SE: "\u{1F1F8}\u{1F1EA}",
  AT: "\u{1F1E6}\u{1F1F9}", BE: "\u{1F1E7}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", JP: "\u{1F1EF}\u{1F1F5}",
};

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;

function sevColor(sev: string) {
  const s = sev.toLowerCase();
  if (s === "critical") return { color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" };
  if (s === "high")     return { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" };
  if (s === "medium")   return { color: "var(--med)",  bg: "var(--med-bg)",  border: "var(--med-b)"  };
  return                       { color: "var(--low)",  bg: "var(--low-bg)",  border: "var(--low-b)"  };
}

function abbreviateSource(name: string, abbreviation?: string | null): string {
  if (abbreviation) return abbreviation;
  if (name.includes("Food and Drug")) return "FDA";
  if (name.includes("Therapeutic Goods")) return "TGA";
  if (name.includes("European Medicines")) return "EMA";
  if (name.includes("Healthcare products") || name.includes("MHRA")) return "MHRA";
  if (name.includes("Health Canada")) return "Health Canada";
  if (name.includes("Bundesinstitut") || name.includes("BfArM")) return "BfArM";
  if (name.includes("sécurité du médicament") || name.includes("ANSM")) return "ANSM";
  if (name.includes("Italiana del Farmaco") || name.includes("AIFA")) return "AIFA";
  if (name.includes("Española") || name.includes("AEMPS")) return "AEMPS";
  if (name.includes("Health Products Regulatory") || name.includes("HPRA")) return "HPRA";
  if (name.includes("Finnish Medicines") || name.includes("Fimea")) return "Fimea";
  if (name.includes("Norwegian") || name.includes("NoMA")) return "NoMA";
  if (name.includes("Swissmedic")) return "Swissmedic";
  if (name.includes("Pharmac")) return "Pharmac";
  if (name.includes("Medsafe")) return "Medsafe";
  if (name.includes("HSA")) return "HSA";
  return name.length > 16 ? name.slice(0, 15) + "\u2026" : name;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Date unknown";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ── Timeline types ── */
interface TimelineEntry {
  date: string;
  source: string;
  description: string;
  type: "initial" | "escalation" | "de_escalation" | "resolved" | "update";
  countryCode: string;
}

const DOT_COLORS: Record<string, string> = {
  initial: "#94a3b8",
  escalation: "#dc2626",
  de_escalation: "#ca8a04",
  resolved: "#16a34a",
  update: "#0F172A",
};

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan",
};

/* ── Page Component ── */
export default async function DrugPageV2({ params }: Props) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  /* ── Parallel data fetching ── */
  const [drugRes, shortagesRes, logRes, alternativesRes, recallsRes, productsRes] =
    await Promise.allSettled([
      supabase.from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class, dosage_forms, strengths, routes_of_administration, therapeutic_category, is_controlled_substance")
        .eq("id", id).single(),

      supabase.from("shortage_events")
        .select("shortage_id, id, drug_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, updated_at, created_at, data_sources(name, abbreviation, country_code)")
        .eq("drug_id", id).order("updated_at", { ascending: false }),

      supabase.from("shortage_status_log")
        .select("id, shortage_event_id, drug_id, old_status, new_status, old_severity, new_severity, changed_at")
        .eq("drug_id", id).order("changed_at", { ascending: false }),

      supabase.from("drug_alternatives")
        .select("alternative_drug_id, relationship_type, clinical_evidence_level, similarity_score, dose_conversion_notes, availability_note, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)")
        .eq("drug_id", id).eq("is_approved", true).order("similarity_score", { ascending: false }),

      supabase.from("recalls")
        .select("id, recall_id, country_code, recall_class, generic_name, brand_name, manufacturer, announced_date, status, reason_category, press_release_url")
        .eq("drug_id", id).order("announced_date", { ascending: false }),

      supabase.from("drug_products")
        .select("id, product_name, trade_name, strength, dosage_form, route, country, registry_status")
        .textSearch("product_name", id).limit(0),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drug = drugRes.status === "fulfilled" ? (drugRes.value as any).data : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortages = shortagesRes.status === "fulfilled" ? ((shortagesRes.value as any).data ?? []) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusLog = logRes.status === "fulfilled" ? ((logRes.value as any).data ?? []) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alternatives = alternativesRes.status === "fulfilled" ? ((alternativesRes.value as any).data ?? []) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recalls = recallsRes.status === "fulfilled" ? ((recallsRes.value as any).data ?? []) : [];

  /* ── Fetch drug_products by generic name ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let products: any[] = [];
  if (drug) {
    const { data: prodData } = await supabase
      .from("drug_products")
      .select("id, product_name, trade_name, strength, dosage_form, route, country, registry_status, sponsors(name)")
      .ilike("product_name", `%${drug.generic_name}%`)
      .limit(30);
    products = prodData ?? [];
  }

  /* ── Not found ── */
  if (!drug) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "var(--app-text-3)" }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Drug not found</p>
          <Link href="/dashboard" style={{ color: "var(--teal)", fontSize: 14, textDecoration: "none" }}>\u2190 Back to dashboard</Link>
        </div>
      </div>
    );
  }

  /* ── Derived data ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeShortages = shortages.filter((s: any) => s.status?.toLowerCase() !== "resolved");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeClassIRecalls = recalls.filter((r: any) => r.recall_class === "I" && r.status === "active");

  const worstSeverity = activeShortages.reduce((worst: string, s: { severity: string | null }) => {
    const sLower = (s.severity ?? "").toLowerCase();
    const si = SEV_ORDER.indexOf(sLower as typeof SEV_ORDER[number]);
    const wi = SEV_ORDER.indexOf(worst as typeof SEV_ORDER[number]);
    return si >= 0 && si < wi ? sLower : worst;
  }, "low");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const affectedCountries = new Set(activeShortages.map((s: any) => s.country_code));
  const isCritical = worstSeverity.toLowerCase() === "critical";

  const statusTheme = activeShortages.length > 0
    ? (worstSeverity === "low"
      ? { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)" }
      : sevColor(worstSeverity))
    : { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" };

  const primaryProduct = products[0];
  const drugStrength = primaryProduct?.strength ?? drug.strengths?.[0] ?? "";
  const drugForm = primaryProduct?.dosage_form ?? drug.dosage_forms?.[0] ?? "";
  const drugRoute = primaryProduct?.route ?? drug.routes_of_administration?.[0] ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceSet = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shortages.forEach((s: any) => {
    const abbr = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    if (abbr) sourceSet.add(abbr);
  });

  const latestUpdate = shortages[0]?.updated_at ?? shortages[0]?.last_verified_at;

  // User's country
  const cookieStore = await cookies();
  const userCountry = cookieStore.get("mederti-country")?.value ?? "AU";

  /* ── Compute Supply Risk Score ── */
  const now = Date.now();
  const d30ms = now - 30 * 86400000;
  const d60ms = now - 60 * 86400000;

  let riskLast30 = 0;
  let riskPrior30 = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages as any[]) {
    const t = new Date(s.updated_at ?? s.created_at).getTime();
    if (t >= d30ms) riskLast30++;
    else if (t >= d60ms) riskPrior30++;
  }

  let riskEscalations = 0;
  let riskLogEntries = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const log of statusLog as any[]) {
    const t = new Date(log.changed_at).getTime();
    if (t >= d30ms) {
      riskLogEntries++;
      const oldS = SEV_RANK[log.old_severity] ?? 0;
      const newS = SEV_RANK[log.new_severity] ?? 0;
      if (newS > oldS) riskEscalations++;
    }
  }

  const maxSevRank = SEV_RANK[worstSeverity] ?? 0;
  const drugRisk = calculateRiskScore({
    last30: riskLast30, prior30: riskPrior30,
    countryCount: affectedCountries.size,
    logEntries: riskLogEntries, escalations: riskEscalations,
    maxSev: maxSevRank,
  });
  const riskColors = riskStyle(drugRisk.riskLevel);

  /* ── Build Supply Timeline ── */
  const timeline: TimelineEntry[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortageMap = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages) shortageMap.set((s as any).id, s);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages as any[]) {
    const src = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    const sev = (s.severity ?? "").toLowerCase();
    const eventDate = s.start_date ?? s.created_at;

    let type: TimelineEntry["type"] = "update";
    if (s.status === "resolved") type = "resolved";

    let desc = `${s.country ?? s.country_code} \u2014 `;
    if (s.status === "resolved") {
      desc += "Shortage resolved.";
      if (s.end_date) desc += ` Ended ${formatDate(s.end_date)}.`;
    } else if (s.status === "anticipated") {
      desc += "Shortage anticipated.";
      if (s.reason && !/^availability:/i.test(s.reason.trim())) desc += ` ${s.reason}`;
    } else {
      desc += `${sev ? sev.charAt(0).toUpperCase() + sev.slice(1) + " " : ""}shortage reported.`;
      if (s.reason && !/^availability:/i.test(s.reason.trim())) {
        desc += ` ${s.reason}`;
      } else if (s.reason_category) {
        desc += ` ${s.reason_category.replace(/_/g, " ")}`;
      }
    }

    timeline.push({ date: eventDate, source: src, description: desc, type, countryCode: s.country_code ?? "" });

    if (s.updated_at && s.start_date) {
      const updateTime = new Date(s.updated_at).getTime();
      const startTime = new Date(s.start_date).getTime();
      if (updateTime - startTime > 86400000) {
        timeline.push({
          date: s.updated_at, source: src,
          description: `${s.country ?? s.country_code} \u2014 shortage ${s.status === "resolved" ? "resolved" : "confirmed"}, latest update from ${src}.`,
          type: s.status === "resolved" ? "resolved" : "update",
          countryCode: s.country_code ?? "",
        });
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const log of statusLog as any[]) {
    const matchingShortage = shortageMap.get(log.shortage_event_id);
    const src = matchingShortage ? abbreviateSource(matchingShortage.data_sources?.name ?? "", matchingShortage.data_sources?.abbreviation) : "";
    const cc = matchingShortage?.country_code ?? "";
    const country = matchingShortage?.country ?? cc;

    let type: TimelineEntry["type"] = "update";
    let desc = `${country} \u2014 `;
    const oldSevIdx = SEV_ORDER.indexOf(log.old_severity as typeof SEV_ORDER[number]);
    const newSevIdx = SEV_ORDER.indexOf(log.new_severity as typeof SEV_ORDER[number]);

    if (log.new_status === "resolved") { type = "resolved"; desc += "Shortage resolved."; }
    else if (newSevIdx >= 0 && oldSevIdx >= 0 && newSevIdx < oldSevIdx) { type = "escalation"; desc += `Escalated from ${log.old_severity} \u2192 ${log.new_severity}.`; }
    else if (newSevIdx >= 0 && oldSevIdx >= 0 && newSevIdx > oldSevIdx) { type = "de_escalation"; desc += `De-escalated from ${log.old_severity} \u2192 ${log.new_severity}.`; }
    else if (log.old_status && log.new_status && log.old_status !== log.new_status) { desc += `Status changed from ${log.old_status} \u2192 ${log.new_status}.`; }
    else { desc += "Status updated."; }

    timeline.push({ date: log.changed_at, source: src, description: desc, type, countryCode: cc });
  }

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const deduped: TimelineEntry[] = [];
  for (const entry of timeline) {
    const isDupe = deduped.some((existing) => {
      const timeDiff = Math.abs(new Date(existing.date).getTime() - new Date(entry.date).getTime());
      return timeDiff < 3600000 && existing.countryCode === entry.countryCode && existing.type === entry.type;
    });
    if (!isDupe) deduped.push(entry);
  }

  /* ── Country groups ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countryGroups: Record<string, { country: string; countryCode: string; source: string; severity: string; lastUpdated: string; count: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of activeShortages as any[]) {
    const cc = s.country_code ?? "";
    const src = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    if (!countryGroups[cc]) {
      countryGroups[cc] = { country: s.country ?? cc, countryCode: cc, source: src, severity: (s.severity ?? "low").toLowerCase(), lastUpdated: s.updated_at ?? s.last_verified_at ?? "", count: 0 };
    }
    countryGroups[cc].count++;
    const existing = SEV_ORDER.indexOf(countryGroups[cc].severity as typeof SEV_ORDER[number]);
    const current = SEV_ORDER.indexOf((s.severity ?? "low").toLowerCase() as typeof SEV_ORDER[number]);
    if (current >= 0 && current < existing) countryGroups[cc].severity = (s.severity ?? "low").toLowerCase();
  }
  const countries = Object.values(countryGroups).sort((a, b) => {
    const ai = SEV_ORDER.indexOf(a.severity as typeof SEV_ORDER[number]);
    const bi = SEV_ORDER.indexOf(b.severity as typeof SEV_ORDER[number]);
    return ai - bi;
  });

  /* ── Verified sources (deduplicated) ── */
  const seenSources = new Map<string, { name: string; abbreviation: string; countryCode: string; sourceUrl: string | null; lastVerified: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages as any[]) {
    const abbr = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    if (!abbr || seenSources.has(abbr)) continue;
    seenSources.set(abbr, {
      name: s.data_sources?.name ?? abbr, abbreviation: abbr,
      countryCode: s.data_sources?.country_code ?? s.country_code ?? "",
      sourceUrl: s.source_url, lastVerified: s.last_verified_at ?? s.updated_at,
    });
  }

  /* ── AI insight text ── */
  const insightText = buildAiInsightText({
    drugName: drug.generic_name,
    activeShortages: activeShortages as { country_code?: string; status?: string; severity?: string; reason?: string; start_date?: string; estimated_resolution_date?: string; data_sources?: { name?: string; abbreviation?: string } }[],
    userCountry,
    affectedCountries: affectedCountries as Set<string>,
  });

  /* ── Build drugContext for chat panel ── */
  const drugContext = {
    id: drug.id,
    generic_name: drug.generic_name,
    brand_names: drug.brand_names ?? [],
    atc_code: drug.atc_code ?? null,
    strength: drugStrength,
    form: drugForm,
    activeShortageCount: activeShortages.length,
    affectedCountries: Array.from(affectedCountries) as string[],
    worstSeverity,
    riskScore: drugRisk.riskScore,
    riskLevel: drugRisk.riskLevel,
    alternativeCount: alternatives.length,
    recallCount: recalls.length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shortagesByCountry: countries.map((c: any) => ({ country: c.country, code: c.countryCode, severity: c.severity })),
  };

  /* ── Render ── */
  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>
      <style>{`
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .v2-header  { animation:fadeIn 0.25s ease both; }
        .v2-body    { animation:fadeIn 0.25s 0.05s ease both; }
        .tl-row:hover { background: var(--app-bg-2); }
        @media (max-width: 768px) {
          .v2-body { grid-template-columns: 1fr !important; }
          .v2-right { position: static !important; height: auto !important; top: auto !important; align-self: stretch !important; }
          .v2-page { padding: 16px 16px 48px !important; }
        }
      `}</style>

      <SiteNav />

      {/* ═══ NAV BAR ═══ */}
      <div style={{
        background: "var(--navy)",
        padding: "10px 0",
        borderBottom: "1px solid var(--bd)",
      }}>
        <div style={{
          maxWidth: 1280, margin: "0 auto", padding: "0 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <Link href="/search" style={{ fontSize: 12, color: "var(--teal-l)", textDecoration: "none" }}>
            {"\u2190"} Back to search
          </Link>
          <Link href={`/drugs/${id}`} style={{ fontSize: 12, color: "var(--txt-2)", textDecoration: "none", opacity: 0.6 }}>
            {"\u2190"} Default view
          </Link>
        </div>
      </div>

      {/* ═══ TWO-COLUMN BODY ═══ */}
      <div className="v2-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 32px 64px" }}>
        <div className="v2-body" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>

          {/* ── LEFT COLUMN (60%) ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 24 }}>

            {/* ═══ DRUG IDENTITY + STATUS ═══ */}
            <div className="v2-header" style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "20px 20px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
              {/* Badges */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                {isCritical && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 5,
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                    background: "var(--crit-bg)", color: "var(--crit)", border: "1px solid var(--crit-b)",
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
                    background: "var(--crit-bg)", color: "var(--crit)", border: "1px solid var(--crit-b)",
                  }}>
                    {"\u26A0"} {activeClassIRecalls.length} Class I Recall{activeClassIRecalls.length > 1 ? "s" : ""}
                  </span>
                )}
                {drug.atc_code && (
                  <span style={{
                    display: "inline-flex", padding: "4px 10px", borderRadius: 5,
                    fontSize: 11, background: "var(--ind-bg)", color: "var(--indigo)",
                    border: "1px solid var(--ind-b)",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}>
                    ATC: {drug.atc_code}
                  </span>
                )}
              </div>

              {/* Drug name */}
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.025em", marginBottom: 4 }}>
                {drug.generic_name}
                {drugStrength && <span style={{ fontSize: 18, fontWeight: 400, color: "var(--app-text-3)", marginLeft: 8 }}>{drugStrength}</span>}
              </div>

              {/* Subtitle */}
              <div style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 8 }}>
                {[drug.generic_name.toLowerCase(), drugForm, drugStrength].filter(Boolean).join(" \u00b7 ")}
                {drugRoute && ` \u00b7 ${drugRoute}`}
              </div>

              {/* Local country status */}
              {(() => {
                const local = countryGroups[userCountry];
                const localFlag = FLAGS[userCountry] ?? "\u{1F310}";
                const localName = COUNTRY_NAMES[userCountry] ?? userCountry;
                if (local) {
                  const lc = sevColor(local.severity);
                  const availText = local.severity === "critical" ? "Not available" : local.severity === "high" ? "Very limited supply" : local.severity === "medium" ? "Limited supply" : "Reduced supply";
                  return (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 16px", borderRadius: 10, marginBottom: 10,
                      background: lc.bg, border: `1px solid ${lc.border}`,
                    }}>
                      <span style={{ fontSize: 22, lineHeight: 1 }}>{localFlag}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: lc.color }}>
                          {availText} in {localName}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 1 }}>
                          {local.source}{local.lastUpdated ? ` \u00b7 verified ${timeAgo(local.lastUpdated)}` : ""}
                        </div>
                      </div>
                      <span style={{
                        width: 9, height: 9, borderRadius: "50%", background: lc.color,
                        flexShrink: 0, animation: "blink 1.6s ease-in-out infinite",
                      }} />
                    </div>
                  );
                }
                return (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", borderRadius: 10, marginBottom: 10,
                    background: "var(--low-bg)", border: "1px solid var(--low-b)",
                  }}>
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{localFlag}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--low)" }}>
                        No shortage reported in {localName}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 1 }}>
                        Based on available regulatory data
                      </div>
                    </div>
                    <span style={{
                      width: 9, height: 9, borderRadius: "50%", background: "var(--low)",
                      flexShrink: 0,
                    }} />
                  </div>
                );
              })()}

              {/* Global status + risk score */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "6px 14px", borderRadius: 8,
                  background: statusTheme.bg, border: `1px solid ${statusTheme.border}`,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusTheme.color, display: "inline-block", animation: "blink 1.6s ease-in-out infinite" }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: statusTheme.color }}>
                    {activeShortages.length > 0
                      ? `${worstSeverity === "critical" ? "Not available" : worstSeverity === "high" ? "Very limited" : worstSeverity === "medium" ? "Limited supply" : "Reduced supply"} in ${affectedCountries.size} countr${affectedCountries.size !== 1 ? "ies" : "y"}`
                      : "In supply"}
                  </span>
                </div>

                {activeShortages.length > 0 && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "6px 14px", borderRadius: 8,
                    background: riskColors.bg, border: `1px solid ${riskColors.border}`,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: riskColors.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {drugRisk.riskLevel}
                    </span>
                    <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 15, fontWeight: 700, color: riskColors.color }}>
                      {drugRisk.riskScore}
                    </span>
                  </div>
                )}

                <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                  {latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : "Updated today"}
                  {" \u00b7 "}{sourceSet.size} source{sourceSet.size !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* SHORTAGE TABLE */}
            {countries.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden", padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Shortage reports by country</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {countries.length} countr{countries.length !== 1 ? "ies" : "y"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {countries.map((g, i) => {
                    const sc = sevColor(g.severity);
                    const availText = g.severity === "critical" ? "Not available" : g.severity === "high" ? "Very limited" : g.severity === "medium" ? "Limited" : "Available";
                    return (
                      <div key={g.countryCode} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 2px",
                        borderBottom: i < countries.length - 1 ? "1px solid var(--app-border)" : "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: "center" }}>{FLAGS[g.countryCode] ?? "\u{1F310}"}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>{g.country}</span>
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", marginLeft: 6 }}>
                            {g.source}{g.lastUpdated ? ` \u00b7 ${timeAgo(g.lastUpdated)}` : ""}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc.color, display: "inline-block", flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 500, color: sc.color }}>{availText}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TIMELINE + ALTERNATIVES side-by-side */}
            <div style={{ display: "grid", gridTemplateColumns: deduped.length > 0 && alternatives.length > 0 ? "1fr 1fr" : "1fr", gap: 16 }}>
              {/* SUPPLY TIMELINE */}
              {deduped.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Supply Timeline</span>
                    <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                      {deduped.length} event{deduped.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {deduped.slice(0, 10).map((entry, i) => {
                        const dotColor = DOT_COLORS[entry.type] ?? DOT_COLORS.update;
                        const isFirst = i === 0;
                        const isLast = i === Math.min(deduped.length, 10) - 1;
                        return (
                          <div key={`${entry.date}-${i}`} className="tl-row" style={{ display: "flex", gap: 14, paddingBottom: isLast ? 0 : 14, borderRadius: 6, transition: "background 0.1s" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 18, flexShrink: 0 }}>
                              <div style={{
                                width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                                border: `2px solid ${dotColor}`,
                                background: isFirst ? dotColor : "#fff",
                              }} />
                              {!isLast && <div style={{ flex: 1, width: 1, background: "var(--app-border)", marginTop: 3 }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                  {formatDate(entry.date)}
                                </span>
                                {entry.type !== "update" && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                                    textTransform: "uppercase", letterSpacing: "0.04em",
                                    color: dotColor,
                                    background: entry.type === "escalation" ? "var(--crit-bg)" : entry.type === "resolved" ? "var(--low-bg)" : entry.type === "de_escalation" ? "var(--med-bg)" : "#fff",
                                    border: `1px solid ${entry.type === "escalation" ? "var(--crit-b)" : entry.type === "resolved" ? "var(--low-b)" : entry.type === "de_escalation" ? "var(--med-b)" : "var(--app-border)"}`,
                                  }}>
                                    {entry.type === "escalation" ? "Escalation" : entry.type === "de_escalation" ? "De-escalation" : entry.type === "resolved" ? "Resolved" : "Initial"}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--app-text-2)", lineHeight: 1.5 }}>
                                {entry.source && <strong style={{ color: "var(--app-text)", fontWeight: 500 }}>{entry.source}</strong>}
                                {entry.source ? " \u2014 " : ""}{entry.description}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ALTERNATIVES */}
              {alternatives.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Alternatives</span>
                    <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                      {alternatives.length}
                    </span>
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {alternatives.slice(0, 6).map((alt: any) => (
                        <Link
                          key={alt.alternative_drug_id}
                          href={`/drugs/${alt.alternative_drug_id}`}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "12px 14px", background: "var(--app-bg)", border: "1px solid var(--app-border)",
                            borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>
                              {alt.drugs?.generic_name ?? "Unknown"}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                              {alt.relationship_type?.replace(/_/g, " ")}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                            {alt.clinical_evidence_level && (
                              <span style={{
                                fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 4,
                                background: "var(--low-bg)", color: "var(--low)", border: "1px solid var(--low-b)",
                              }}>
                                {alt.clinical_evidence_level}
                              </span>
                            )}
                            {alt.similarity_score != null && (
                              <span style={{ fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {Math.round(alt.similarity_score * 100)}% match
                              </span>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RECALLS (Accordion) */}
            {recalls.length > 0 && (
              <Accordion title="Recall History" count={recalls.length}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {recalls.slice(0, 8).map((r: any) => {
                    const classColor = r.recall_class === "I"
                      ? { color: "#b91c1c", bg: "#7f1d1d15", border: "#b91c1c44" }
                      : r.recall_class === "II"
                      ? { color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" }
                      : { color: "var(--app-text-3)", bg: "var(--app-bg-2)", border: "var(--app-border)" };
                    return (
                      <div key={r.id} style={{
                        padding: "12px 14px", borderRadius: 8,
                        background: "var(--app-bg)", border: "1px solid var(--app-border)",
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
                              {FLAGS[r.country_code] ?? "\u{1F310}"} {r.country_code}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.4 }}>
                            {r.reason_category?.replace(/_/g, " ") ?? "Recall notice"}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                            {formatDate(r.announced_date)}
                          </span>
                          {r.press_release_url && (
                            <a href={r.press_release_url} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>
                              Notice \u2197
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Accordion>
            )}

            {/* SOURCES (Accordion) */}
            {seenSources.size > 0 && (
              <Accordion title="Verified Sources" count={seenSources.size}>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {Array.from(seenSources.values()).map((src) => (
                    <div key={src.abbreviation} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 14px", borderRadius: 8, background: "var(--app-bg)", border: "1px solid var(--app-border)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 17 }}>{FLAGS[src.countryCode] ?? "\u{1F310}"}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)" }}>{src.abbreviation}</div>
                          {src.sourceUrl && (
                            <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                              {(() => { try { return new URL(src.sourceUrl).hostname; } catch { return ""; } })()}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {src.lastVerified && (
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                            {timeAgo(src.lastVerified)}
                          </span>
                        )}
                        {src.sourceUrl && (
                          <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>\u2197</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Accordion>
            )}

            {/* Back to default view */}
            <div style={{ paddingTop: 8 }}>
              <Link href={`/drugs/${id}`} style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
                {"\u2190"} Back to default view
              </Link>
            </div>
          </div>

          {/* ── RIGHT COLUMN (40%) — Chat Panel ── */}
          <div className="v2-right" style={{ position: "sticky", top: 64, height: "calc(100vh - 64px)", paddingTop: 24, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}>
            {/* Alert button */}
            {activeShortages.length > 0 && countryGroups[userCountry] && (
              <Link
                href="/alerts"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "12px 16px", borderRadius: 10,
                  background: "var(--teal)", color: "#fff",
                  fontSize: 14, fontWeight: 600, textDecoration: "none",
                  border: "none", cursor: "pointer",
                  transition: "opacity 0.15s",
                  flexShrink: 0,
                }}
              >
                {"\uD83D\uDD14"} Alert me when available
              </Link>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
              <DrugChatPanel
                drugId={id}
                drugContext={drugContext}
                insightText={insightText}
              />
            </div>
          </div>

        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
