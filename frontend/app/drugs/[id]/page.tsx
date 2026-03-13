export const dynamic = "force-dynamic";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import Link from "next/link";
import { WatchlistButton } from "@/app/components/watchlist-button";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { SEV_RANK, calculateRiskScore, riskStyle } from "@/lib/risk-score";

interface Props {
  params: Promise<{ id: string }>;
}

/* ── Flags ── */
const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  EU: "🇪🇺", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪",
  NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭", SE: "🇸🇪",
  AT: "🇦🇹", BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵",
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
  return name.length > 16 ? name.slice(0, 15) + "…" : name;
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
  initial: "#94a3b8",       // grey
  escalation: "#dc2626",    // red
  de_escalation: "#ca8a04", // amber
  resolved: "#16a34a",      // green
  update: "#0d9488",        // teal
};

/* ── Page Component ── */
export default async function DrugPage({ params }: Props) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  /* ── Parallel data fetching ── */
  const [drugRes, shortagesRes, logRes, alternativesRes, recallsRes, productsRes] =
    await Promise.allSettled([
      /* 1. Drug info */
      supabase
        .from("drugs")
        .select(
          "id, generic_name, brand_names, atc_code, atc_description, drug_class, " +
          "dosage_forms, strengths, routes_of_administration, therapeutic_category, is_controlled_substance"
        )
        .eq("id", id)
        .single(),

      /* 2. All shortage events with source info */
      supabase
        .from("shortage_events")
        .select(
          "shortage_id, id, drug_id, country, country_code, status, severity, " +
          "reason, reason_category, start_date, end_date, estimated_resolution_date, " +
          "source_url, last_verified_at, updated_at, created_at, " +
          "data_sources(name, abbreviation, country_code)"
        )
        .eq("drug_id", id)
        .order("updated_at", { ascending: false }),

      /* 3. Shortage status change log */
      supabase
        .from("shortage_status_log")
        .select("id, shortage_event_id, drug_id, old_status, new_status, old_severity, new_severity, changed_at")
        .eq("drug_id", id)
        .order("changed_at", { ascending: false }),

      /* 4. Drug alternatives */
      supabase
        .from("drug_alternatives")
        .select(
          "alternative_drug_id, relationship_type, clinical_evidence_level, " +
          "similarity_score, dose_conversion_notes, availability_note, " +
          "drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)"
        )
        .eq("drug_id", id)
        .eq("is_approved", true)
        .order("similarity_score", { ascending: false }),

      /* 5. Recalls */
      supabase
        .from("recalls")
        .select(
          "id, recall_id, country_code, recall_class, generic_name, brand_name, " +
          "manufacturer, announced_date, status, reason_category, press_release_url"
        )
        .eq("drug_id", id)
        .order("announced_date", { ascending: false }),

      /* 6. Drug products (for form, strength, route details) */
      supabase
        .from("drug_products")
        .select("id, product_name, trade_name, strength, dosage_form, route, country, registry_status")
        .textSearch("product_name", id) // will fallback below
        .limit(0), // placeholder — we'll do a name search after getting drug info
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

  /* ── Fetch drug_products by generic name (needs drug info first) ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let products: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let availability: any[] = [];

  if (drug) {
    const { data: prodData } = await supabase
      .from("drug_products")
      .select("id, product_name, trade_name, strength, dosage_form, route, country, registry_status, sponsors(name)")
      .ilike("product_name", `%${drug.generic_name}%`)
      .limit(30);
    products = prodData ?? [];

    if (products.length > 0) {
      const productIds = products.map((p: { id: string }) => p.id);
      const { data: availData } = await supabase
        .from("drug_availability")
        .select("product_id, country, status, severity, expected_resolution, last_verified_at, source_agency")
        .in("product_id", productIds);
      availability = availData ?? [];
    }
  }

  /* ── Not found ── */
  if (!drug) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "var(--app-text-3)" }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Drug not found</p>
          <Link href="/dashboard" style={{ color: "var(--teal)", fontSize: 14, textDecoration: "none" }}>← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  /* ── Derived data ── */
  const activeShortages = shortages.filter((s: { status: string }) => s.status?.toLowerCase() !== "resolved");
  const activeClassIRecalls = recalls.filter(
    (r: { recall_class: string; status: string }) => r.recall_class === "I" && r.status === "active"
  );

  const worstSeverity = activeShortages.reduce((worst: string, s: { severity: string | null }) => {
    const si = SEV_ORDER.indexOf((s.severity ?? "") as typeof SEV_ORDER[number]);
    const wi = SEV_ORDER.indexOf(worst as typeof SEV_ORDER[number]);
    return si >= 0 && si < wi ? (s.severity ?? worst) : worst;
  }, "low");

  const affectedCountries = new Set(activeShortages.map((s: { country_code: string }) => s.country_code));
  const isCritical = worstSeverity.toLowerCase() === "critical";

  const statusTheme = activeShortages.length > 0
    ? (worstSeverity === "low"
      ? { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)" }
      : sevColor(worstSeverity))
    : { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" };

  // Get product details for form/strength display
  const primaryProduct = products[0];
  const drugForm = primaryProduct?.dosage_form ?? drug.dosage_forms?.[0] ?? "";
  const drugStrength = primaryProduct?.strength ?? drug.strengths?.[0] ?? "";
  const drugRoute = primaryProduct?.route ?? drug.routes_of_administration?.[0] ?? "";

  // Unique sources reporting
  const sourceSet = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shortages.forEach((s: any) => {
    const abbr = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    if (abbr) sourceSet.add(abbr);
  });

  // Most recent update
  const latestUpdate = shortages[0]?.updated_at ?? shortages[0]?.last_verified_at;

  // User's country from cookie
  const cookieStore = await cookies();
  const userCountry = cookieStore.get("mederti-country")?.value ?? "AU";
  const userCountryName: Record<string, string> = {
    AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
    NZ: "New Zealand", SG: "Singapore", DE: "Germany", FR: "France",
  };
  const userShortage = activeShortages.find(
    (s: { country_code: string }) => s.country_code?.toUpperCase() === userCountry
  );

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
    last30: riskLast30,
    prior30: riskPrior30,
    countryCount: affectedCountries.size,
    logEntries: riskLogEntries,
    escalations: riskEscalations,
    maxSev: maxSevRank,
  });
  const riskColors = riskStyle(drugRisk.riskLevel);

  /* ── Build Supply Timeline ── */
  const timeline: TimelineEntry[] = [];

  // Build a map of shortage event IDs → shortage info for cross-referencing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortageMap = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages) shortageMap.set((s as any).id, s);

  // From shortage_events: initial reports and current state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages as any[]) {
    const src = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    const sev = (s.severity ?? "").toLowerCase();

    // Use start_date as the event date for shortage entries
    const eventDate = s.start_date ?? s.created_at;

    let type: TimelineEntry["type"] = "update";
    if (s.status === "resolved") {
      type = "resolved";
    }

    // Build description
    let desc = `${s.country ?? s.country_code} — `;
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

    timeline.push({
      date: eventDate,
      source: src,
      description: desc,
      type,
      countryCode: s.country_code ?? "",
    });

    // Also add an "updated" entry if updated_at is significantly different from start_date
    if (s.updated_at && s.start_date) {
      const updateTime = new Date(s.updated_at).getTime();
      const startTime = new Date(s.start_date).getTime();
      // Only add update entry if it's more than 24h after start
      if (updateTime - startTime > 86400000) {
        timeline.push({
          date: s.updated_at,
          source: src,
          description: `${s.country ?? s.country_code} — shortage ${s.status === "resolved" ? "resolved" : "confirmed"}, latest update from ${src}.`,
          type: s.status === "resolved" ? "resolved" : "update",
          countryCode: s.country_code ?? "",
        });
      }
    }
  }

  // From shortage_status_log: severity and status changes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const log of statusLog as any[]) {
    const matchingShortage = shortageMap.get(log.shortage_event_id);
    const src = matchingShortage
      ? abbreviateSource(matchingShortage.data_sources?.name ?? "", matchingShortage.data_sources?.abbreviation)
      : "";
    const cc = matchingShortage?.country_code ?? "";
    const country = matchingShortage?.country ?? cc;

    let type: TimelineEntry["type"] = "update";
    let desc = `${country} — `;

    const oldSevIdx = SEV_ORDER.indexOf(log.old_severity as typeof SEV_ORDER[number]);
    const newSevIdx = SEV_ORDER.indexOf(log.new_severity as typeof SEV_ORDER[number]);

    if (log.new_status === "resolved") {
      type = "resolved";
      desc += "Shortage resolved.";
    } else if (newSevIdx >= 0 && oldSevIdx >= 0 && newSevIdx < oldSevIdx) {
      // New severity is higher (closer to index 0 = critical)
      type = "escalation";
      desc += `Escalated from ${log.old_severity} → ${log.new_severity}.`;
    } else if (newSevIdx >= 0 && oldSevIdx >= 0 && newSevIdx > oldSevIdx) {
      // New severity is lower
      type = "de_escalation";
      desc += `De-escalated from ${log.old_severity} → ${log.new_severity}.`;
    } else if (log.old_status && log.new_status && log.old_status !== log.new_status) {
      desc += `Status changed from ${log.old_status} → ${log.new_status}.`;
    } else if (log.new_severity && log.old_severity) {
      desc += `Severity updated: ${log.old_severity} → ${log.new_severity}.`;
    } else {
      desc += "Status updated.";
    }

    timeline.push({
      date: log.changed_at,
      source: src,
      description: desc,
      type,
      countryCode: cc,
    });
  }

  // Sort newest first and deduplicate by close timestamps
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Deduplicate entries that are within 1 hour and have same country + similar description
  const deduped: TimelineEntry[] = [];
  for (const entry of timeline) {
    const isDupe = deduped.some((existing) => {
      const timeDiff = Math.abs(new Date(existing.date).getTime() - new Date(entry.date).getTime());
      return timeDiff < 3600000 && existing.countryCode === entry.countryCode && existing.type === entry.type;
    });
    if (!isDupe) deduped.push(entry);
  }

  /* ── Country availability from shortage_events (grouped by country) ── */
  const countryGroups: Record<string, {
    country: string;
    countryCode: string;
    source: string;
    severity: string;
    lastUpdated: string;
    count: number;
  }> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of activeShortages as any[]) {
    const cc = s.country_code ?? "";
    const src = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
    if (!countryGroups[cc]) {
      countryGroups[cc] = {
        country: s.country ?? cc,
        countryCode: cc,
        source: src,
        severity: (s.severity ?? "low").toLowerCase(),
        lastUpdated: s.updated_at ?? s.last_verified_at ?? "",
        count: 0,
      };
    }
    countryGroups[cc].count++;
    // Keep worst severity
    const existing = SEV_ORDER.indexOf(countryGroups[cc].severity as typeof SEV_ORDER[number]);
    const current = SEV_ORDER.indexOf((s.severity ?? "low").toLowerCase() as typeof SEV_ORDER[number]);
    if (current >= 0 && current < existing) {
      countryGroups[cc].severity = (s.severity ?? "low").toLowerCase();
    }
  }

  // Also enrich with drug_availability data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of availability as any[]) {
    const cc = a.country ?? "";
    if (!countryGroups[cc] && a.status !== "available") {
      countryGroups[cc] = {
        country: cc,
        countryCode: cc,
        source: a.source_agency ?? "",
        severity: a.severity ?? a.status ?? "medium",
        lastUpdated: a.last_verified_at ?? "",
        count: 1,
      };
    }
  }

  const countries = Object.values(countryGroups).sort((a, b) => {
    const ai = SEV_ORDER.indexOf(a.severity as typeof SEV_ORDER[number]);
    const bi = SEV_ORDER.indexOf(b.severity as typeof SEV_ORDER[number]);
    return ai - bi;
  });

  // Ensure user's country always appears in the list
  const userCountryInList = countries.some((c) => c.countryCode === userCountry);

  /* ── Render ── */
  return (
    <div style={{ background: "var(--app-bg-2)", minHeight: "100vh", color: "var(--app-text)" }}>
      <style>{`
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        .drug-header-card { animation:fadeUp 0.3s ease both; }
        .drug-answer-row  { animation:fadeUp 0.3s 0.05s ease both; }
        .drug-two-col     { animation:fadeUp 0.3s 0.1s ease both; }
        .tl-row:hover { background: var(--app-bg-2); }
        @media (max-width: 768px) {
          .drug-page { padding: 16px 16px 48px !important; }
          .drug-header-card { flex-direction: column !important; padding: 20px !important; }
          .drug-header-right { align-items: flex-start !important; min-width: unset !important; width: 100% !important; flex-direction: row !important; flex-wrap: wrap !important; gap: 10px !important; }
          .drug-answer-row { grid-template-columns: 1fr !important; }
          .drug-two-col { grid-template-columns: 1fr !important; }
          .drug-right-col { position: static !important; }
        }
      `}</style>

      <SiteNav />

      {/* ═══ FULL-WIDTH HEADER BAND ═══ */}
      <div style={{ background: "#fff", borderBottom: "1px solid var(--app-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div
          className="drug-header-card"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "28px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div>
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
                  ⚠ {activeClassIRecalls.length} Class I Recall{activeClassIRecalls.length > 1 ? "s" : ""}
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
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--app-text)", lineHeight: 1.15, marginBottom: 4 }}>
              {drug.generic_name}
              {drugStrength && (
                <span style={{ fontSize: 18, fontWeight: 400, color: "var(--app-text-3)", marginLeft: 8 }}>
                  {drugStrength}
                </span>
              )}
            </div>

            {/* Subtitle — form · route */}
            <div style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 12 }}>
              {[drug.generic_name.toLowerCase(), drugForm, drugStrength].filter(Boolean).join(" · ")}
              {drugRoute && ` · ${drugRoute}`}
            </div>

            {/* Tag pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {drug.drug_class && (
                <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                  {drug.drug_class}
                </span>
              )}
              {drug.therapeutic_category && (
                <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                  {drug.therapeutic_category}
                </span>
              )}
              {drug.is_controlled_substance && (
                <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                  Controlled Substance
                </span>
              )}
              {drug.dosage_forms?.slice(0, 2).map((f: string) => (
                <span key={f} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Right — freshness + alert */}
          <div className="drug-header-right" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, flexShrink: 0, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--low)", display: "inline-block" }} />
              <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                {latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : "Updated today"}
                {" · "}
                <strong style={{ color: "var(--teal)" }}>{sourceSet.size}</strong> source{sourceSet.size !== 1 ? "s" : ""}
                {" · "}
                <strong style={{ color: "var(--teal)" }}>{affectedCountries.size}</strong> countr{affectedCountries.size !== 1 ? "ies" : "y"}
              </span>
            </div>
            <WatchlistButton drugId={id} hasShortage={!!userShortage} />
          </div>
        </div>
      </div>

      <div className="drug-page" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 64px" }}>

        {/* ═══ ANSWER ROW — 3 panels ═══ */}
        <div className="drug-answer-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>

          {/* 1. MY COUNTRY */}
          {(() => {
            const myTheme = userShortage
              ? sevColor((userShortage as { severity?: string }).severity ?? "medium")
              : { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" };
            const mySev = userShortage ? ((userShortage as { severity?: string }).severity ?? "active") : null;
            const mySevIsCritical = mySev?.toLowerCase() === "critical";
            return (
              <div style={{
                background: mySevIsCritical ? myTheme.bg : "#fff",
                border: `1px solid ${mySevIsCritical ? myTheme.border : "var(--app-border)"}`,
                borderLeft: `4px solid ${myTheme.color}`,
                borderRadius: 12, padding: "22px 24px",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                  color: myTheme.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{FLAGS[userCountry] ?? "🌐"}</span>
                  {userCountryName[userCountry] ?? userCountry}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 4 }}>
                  {mySev ? (mySev.charAt(0).toUpperCase() + mySev.slice(1)) + " shortage" : "In supply"}
                </div>
                <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
                  {userShortage
                    ? ((userShortage as { reason?: string }).reason?.replace(/^availability:\s*/i, "") ?? "Supply disruption")
                    : "No shortage reported"}
                </div>
              </div>
            );
          })()}

          {/* 2. GLOBAL STATUS */}
          <div style={{
            background: isCritical ? statusTheme.bg : "#fff",
            border: `1px solid ${isCritical ? statusTheme.border : "var(--app-border)"}`,
            borderLeft: `4px solid ${statusTheme.color}`,
            borderRadius: 12, padding: "22px 24px",
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
              color: statusTheme.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", display: "inline-block", animation: "blink 1.6s ease-in-out infinite" }} />
              {activeShortages.length > 0
                ? (affectedCountries.size === 1
                  ? `Shortage in ${activeShortages[0]?.country ?? "1 country"}`
                  : `Shortage in ${affectedCountries.size} countries`)
                : "Global status"}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 4 }}>
              {activeShortages.length > 0
                ? (worstSeverity.charAt(0).toUpperCase() + worstSeverity.slice(1)) + " shortage"
                : "In supply"}
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
              {(() => {
                const reason = activeShortages[0]?.reason;
                const isAvailabilityField = reason && /^availability:/i.test(reason.trim());
                return isAvailabilityField
                  ? (activeShortages[0]?.reason_category?.replace(/_/g, " ") ?? "Supply disruption")
                  : (reason ?? activeShortages[0]?.reason_category?.replace(/_/g, " ") ?? (activeShortages.length > 0 ? "Supply disruption" : "No active shortage reported"));
              })()}
            </div>
          </div>

          {/* 3. PREDICTED SUPPLY + RISK SCORE */}
          <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, padding: "22px 24px" }}>
            <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Predicted supply
            </div>
            {/* Estimated availability date */}
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", lineHeight: 1.1, marginBottom: 4 }}>
              {activeShortages[0]?.estimated_resolution_date
                ? new Date(activeShortages[0].estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
                : activeShortages.length > 0 ? "TBC" : "In supply"}
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 14 }}>
              {activeShortages[0]?.start_date
                ? `Since ${formatDate(activeShortages[0].start_date)}`
                : activeShortages.length > 0 ? "Start date unavailable" : "No disruption"}
            </div>
            {/* Divider */}
            <div style={{ height: 1, background: "var(--app-border)", marginBottom: 12 }} />
            {/* Risk score row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Supply Risk Score
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {activeShortages.length > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    background: riskColors.bg, color: riskColors.color,
                    border: `1px solid ${riskColors.border}`,
                    whiteSpace: "nowrap",
                  }}>
                    {drugRisk.riskLevel}
                  </span>
                )}
                <span style={{
                  fontFamily: "var(--font-dm-mono), monospace",
                  fontSize: 18, fontWeight: 700,
                  color: activeShortages.length > 0 ? riskColors.color : "var(--app-text-3)",
                }}>
                  {activeShortages.length > 0 ? drugRisk.riskScore : "—"}
                </span>
              </div>
            </div>
            {/* Visual bar */}
            {activeShortages.length > 0 && (
              <div style={{
                height: 5, borderRadius: 3, background: "#e2e8f0",
                overflow: "hidden", marginBottom: 6,
              }}>
                <div style={{
                  width: `${drugRisk.riskScore}%`, height: "100%", borderRadius: 3,
                  background: `linear-gradient(90deg, #ca8a04 0%, ${riskColors.color} 100%)`,
                }} />
              </div>
            )}
            {/* Primary signal */}
            <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>
              {activeShortages.length > 0 ? drugRisk.primarySignal : "No active shortage signal"}
            </div>
          </div>
        </div>

        {/* ═══ MAIN TWO-COL LAYOUT ═══ */}
        <div className="drug-two-col" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* WHERE IS IT AVAILABLE? */}
            <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Shortage reports by country</span>
                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {countries.length} countr{countries.length !== 1 ? "ies" : "y"} affected
                </span>
              </div>
              <div style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {/* User's country — always shown first */}
                  {!userCountryInList && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 2px",
                      borderBottom: countries.length > 0 ? "1px solid var(--app-border)" : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: "center" }}>
                          {FLAGS[userCountry] ?? "🌐"}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
                          {userCountryName[userCountry] ?? userCountry}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--low)", display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--low)" }}>No shortage</span>
                      </div>
                    </div>
                  )}
                  {countries.map((g, i) => {
                    const sc = sevColor(g.severity);
                    const isUser = g.countryCode === userCountry;
                    const availText = g.severity === "critical" ? "Not available" : g.severity === "high" ? "Very limited" : g.severity === "medium" ? "Limited" : "Available";
                    return (
                      <div key={g.countryCode} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 2px",
                        borderBottom: i < countries.length - 1 ? "1px solid var(--app-border)" : "none",
                        ...(isUser ? { order: -1 } : {}),
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: "center" }}>
                            {FLAGS[g.countryCode] ?? "🌐"}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: isUser ? 600 : 500, color: "var(--app-text)" }}>{g.country}</span>
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", marginLeft: 6 }}>
                            {g.source}{g.lastUpdated ? ` · ${timeAgo(g.lastUpdated)}` : ""}
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
            </div>

            {/* AI INSIGHT — borderless section */}
            <div style={{ padding: "4px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>AI Insight</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--indigo)", fontWeight: 500 }}>
                  ✦ AI-generated
                </div>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--app-text-2)", marginBottom: 14 }}>
                {activeShortages.length > 0
                  ? `This drug is currently under active shortage in ${affectedCountries.size} countr${affectedCountries.size !== 1 ? "ies" : "y"}. Supply disruptions of this type typically persist for 3–9 months based on historical patterns. Consider therapeutic alternatives where clinically appropriate.`
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

            {/* ═══ SUPPLY TIMELINE ═══ */}
            {deduped.length > 0 && (
              <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Supply Timeline</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {deduped.length} event{deduped.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {deduped.slice(0, 15).map((entry, i) => {
                      const dotColor = DOT_COLORS[entry.type] ?? DOT_COLORS.update;
                      const isFirst = i === 0;
                      const isLast = i === Math.min(deduped.length, 15) - 1;
                      return (
                        <div key={`${entry.date}-${i}`} className="tl-row" style={{ display: "flex", gap: 14, paddingBottom: isLast ? 0 : 16, borderRadius: 6, transition: "background 0.1s" }}>
                          {/* Timeline rail */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 18, flexShrink: 0 }}>
                            <div style={{
                              width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                              border: `2px solid ${dotColor}`,
                              background: isFirst ? dotColor : "var(--app-bg)",
                            }} />
                            {!isLast && (
                              <div style={{ flex: 1, width: 1, background: "var(--app-border)", marginTop: 3 }} />
                            )}
                          </div>
                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {formatDate(entry.date)}
                                {entry.date && ` · ${timeAgo(entry.date)}`}
                              </span>
                              {/* Event type badge */}
                              {entry.type !== "update" && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                                  textTransform: "uppercase", letterSpacing: "0.04em",
                                  color: dotColor,
                                  background: entry.type === "escalation" ? "var(--crit-bg)"
                                    : entry.type === "resolved" ? "var(--low-bg)"
                                    : entry.type === "de_escalation" ? "var(--med-bg)"
                                    : "var(--app-bg-2)",
                                  border: `1px solid ${entry.type === "escalation" ? "var(--crit-b)"
                                    : entry.type === "resolved" ? "var(--low-b)"
                                    : entry.type === "de_escalation" ? "var(--med-b)"
                                    : "var(--app-border)"}`,
                                }}>
                                  {entry.type === "escalation" ? "Escalation"
                                    : entry.type === "de_escalation" ? "De-escalation"
                                    : entry.type === "resolved" ? "Resolved"
                                    : entry.type === "initial" ? "Initial report"
                                    : "Update"}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.55 }}>
                              {entry.source && (
                                <strong style={{ color: "var(--app-text)", fontWeight: 500 }}>{entry.source}</strong>
                              )}
                              {entry.source ? " — " : ""}{entry.description}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* RECALL HISTORY */}
            {recalls.length > 0 && (
              <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                    Recall History
                  </span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {recalls.length} recall{recalls.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {recalls.slice(0, 5).map((r: any) => {
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
                                {FLAGS[r.country_code] ?? "🌐"} {r.country_code}
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
                                Notice ↗
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* VERIFIED SOURCES */}
            {shortages.length > 0 && (
              <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Verified Sources</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    cross-checked {latestUpdate ? timeAgo(latestUpdate) : "today"}
                  </span>
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {/* Deduplicate by source name */}
                    {(() => {
                      const seenSources = new Map<string, {
                        name: string;
                        abbreviation: string;
                        countryCode: string;
                        sourceUrl: string | null;
                        lastVerified: string | null;
                      }>();
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      for (const s of shortages as any[]) {
                        const abbr = abbreviateSource(s.data_sources?.name ?? "", s.data_sources?.abbreviation);
                        if (!abbr || seenSources.has(abbr)) continue;
                        seenSources.set(abbr, {
                          name: s.data_sources?.name ?? abbr,
                          abbreviation: abbr,
                          countryCode: s.data_sources?.country_code ?? s.country_code ?? "",
                          sourceUrl: s.source_url,
                          lastVerified: s.last_verified_at ?? s.updated_at,
                        });
                      }
                      return Array.from(seenSources.values()).map((src) => (
                        <div key={src.abbreviation} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "9px 14px", borderRadius: 8, background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 17 }}>{FLAGS[src.countryCode] ?? "🌐"}</span>
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
                              <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>↗</a>
                            )}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN (sticky) ── */}
          <div className="drug-right-col" style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 76 }}>

            {/* ALTERNATIVES — no outer wrapper, cards sit directly */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
                  What can I use instead?
                </span>
                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {alternatives.length} alternative{alternatives.length !== 1 ? "s" : ""}
                </span>
              </div>
              {alternatives.length === 0 ? (
                <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>No alternatives on file.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {alternatives.map((alt: any) => (
                    <Link
                      key={alt.alternative_drug_id}
                      href={`/drugs/${alt.alternative_drug_id}`}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "14px 18px",
                        background: "#fff", border: "1px solid var(--app-border)",
                        borderRadius: 10, textDecoration: "none",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>
                          {alt.drugs?.generic_name ?? "Unknown"}
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
                        {alt.similarity_score != null && (
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                            {Math.round(alt.similarity_score * 100)}% match
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
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
                background: "var(--app-bg)", border: "1px solid var(--app-border)",
                color: "var(--app-text-2)", cursor: "pointer", textAlign: "center", textDecoration: "none",
              }}>
                Switch to Dashboard view →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
