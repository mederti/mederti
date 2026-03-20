export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import Link from "next/link";
import { SEV_RANK, calculateRiskScore, riskStyle } from "@/lib/risk-score";
import SiteNav from "@/app/components/landing-nav";
import V3ChatPanel from "./chat-panel";
import { buildAiInsightText } from "./build-insight-text";
import { ShortageForcast } from "./forecast";
import { V4BellButton } from "./v4/bell-button";
import { HeaderActions } from "./v4/header-actions";
import { getDevice } from "@/lib/get-device";
import { MobileDrugPage } from "@/app/components/mobile/MobileDrugPage";
import { truncateDrugName } from "@/lib/utils";
import { getPartnerForCountry } from "@/lib/suppliers";
import { DrugImage } from "./drug-image";

interface Props {
  params: Promise<{ id: string }>;
}

/* ── SEO: dynamic metadata ── */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [drugRes, shortageRes] = await Promise.all([
    supabase
      .from("drugs")
      .select("generic_name, drug_class")
      .eq("id", id)
      .single(),
    supabase
      .from("shortage_events")
      .select("status, severity, country_code")
      .eq("drug_id", id)
      .eq("status", "active")
      .order("severity", { ascending: true })
      .limit(1)
      .single(),
  ]);

  const drug = drugRes.data;
  const shortage = shortageRes.data;

  if (!drug) {
    // Try catalogue fallback
    const { data: cat } = await supabase
      .from("drug_catalogue")
      .select("generic_name")
      .eq("id", id)
      .single();
    const name = cat?.generic_name ?? "Drug";
    return {
      title: `${name} Supply Status — Mederti`,
      description: `${name} supply status and shortage history. Tracked by Mederti in real time across 20+ countries.`,
      alternates: { canonical: `https://mederti.vercel.app/drugs/${id}` },
    };
  }

  const drugName = drug.generic_name;
  const hasShortage = !!shortage;
  const country = shortage?.country_code ?? "";
  const severity = shortage?.severity ?? "";
  const year = new Date().getFullYear();

  const title = hasShortage
    ? `${drugName} Shortage ${country} ${year} — Mederti`
    : `${drugName} Supply Status — Mederti`;

  const description = hasShortage
    ? `${drugName} is currently in ${severity} shortage in ${country}. Track real-time supply status, alternatives, and expected return dates on Mederti.`
    : `${drugName} supply status, shortage history, and availability across 20+ countries. Tracked by Mederti in real time.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://mederti.vercel.app/drugs/${id}`,
      siteName: "Mederti",
      type: "website",
      images: [{ url: `https://mederti.vercel.app/api/og/drug/${id}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    alternates: {
      canonical: `https://mederti.vercel.app/drugs/${id}`,
    },
  };
}

/* ── Flag icon helper ── */
function FlagIcon({ code, size = 16 }: { code: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code.toUpperCase()}.svg`}
      alt={code}
      width={Math.round(size * 1.5)}
      height={size}
      style={{ borderRadius: 2, objectFit: "cover", display: "inline-block", verticalAlign: "middle", border: "1px solid rgba(0,0,0,0.08)" }}
    />
  );
}

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan",
};

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
  if (name.includes("s\u00e9curit\u00e9 du m\u00e9dicament") || name.includes("ANSM")) return "ANSM";
  if (name.includes("Italiana del Farmaco") || name.includes("AIFA")) return "AIFA";
  if (name.includes("Espa\u00f1ola") || name.includes("AEMPS")) return "AEMPS";
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

export default async function DrugPage({ params }: Props) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  /* ── Parallel data fetching ── */
  const [drugRes, shortagesRes, logRes, alternativesRes, recallsRes, productsRes] =
    await Promise.allSettled([
      supabase.from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class, dosage_forms, strengths, routes_of_administration, therapeutic_category, is_controlled_substance")
        .eq("id", id).single(),
      supabase.from("shortage_events")
        .select("shortage_id, id, drug_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, updated_at, created_at, notes, data_sources(name, abbreviation, country_code)")
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

  /* ── Catalogue fallback for drugs not in drugs table ── */
  if (!drug) {
    const { data: catEntry } = await supabase
      .from("drug_catalogue")
      .select("id, generic_name, brand_name, strength, dosage_form, route, source_name, source_country, registration_number, registration_status, sponsor")
      .eq("id", id)
      .single();

    if (!catEntry) {
      return (
        <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", color: "var(--app-text-3)" }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>Drug not found</p>
            <Link href="/search" style={{ color: "var(--teal)", fontSize: 14, textDecoration: "none" }}>{"\u2190"} Back to search</Link>
          </div>
        </div>
      );
    }

    /* Render a minimal stable-supply page for catalogue-only drugs */
    const catCountry = catEntry.source_country ?? "AU";
    const catFlag = COUNTRY_NAMES[catCountry] ?? catCountry;
    return (
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SiteNav />
        <div style={{ background: "var(--navy)", padding: "8px 24px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--bd)" }}>
          <Link href="/search" style={{ fontSize: 11, color: "var(--teal-l)", textDecoration: "none" }}>{"\u2190"} Back to search</Link>
        </div>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
          {/* Drug header */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
              {catEntry.generic_name}
              {catEntry.strength && <span style={{ fontWeight: 400, color: "var(--app-text-3)", fontSize: 18, marginLeft: 8 }}>{catEntry.strength}</span>}
            </h1>
            {catEntry.brand_name && catEntry.brand_name !== catEntry.generic_name && (
              <div style={{ fontSize: 13, color: "var(--app-text-3)", marginTop: 4 }}>{catEntry.brand_name}</div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {catEntry.dosage_form && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--app-border)", color: "var(--app-text-3)" }}>{catEntry.dosage_form}</span>}
              {catEntry.route && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--app-border)", color: "var(--app-text-3)" }}>{catEntry.route}</span>}
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--app-border)", color: "var(--app-text-3)" }}>{catEntry.source_name}</span>
            </div>
          </div>

          {/* In supply card */}
          <div style={{
            background: "var(--low-bg)", border: "1px solid var(--low-b)", borderRadius: 14,
            padding: "20px 24px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--low)", marginBottom: 6 }}>
              {catFlag} &middot; Supply status
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--app-text)", marginBottom: 4 }}>In supply</div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.6 }}>
              No shortage has been reported for this drug. It is registered as <strong>{catEntry.registration_status ?? "active"}</strong> with {catEntry.source_name}.
            </div>
          </div>

          {/* Registration details */}
          <div style={{
            background: "var(--app-bg-2)", border: "1px solid var(--app-border)", borderRadius: 12,
            padding: "16px 20px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)", marginBottom: 12 }}>
              Registration
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", fontSize: 13 }}>
              {catEntry.registration_number && (
                <div>
                  <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Registration number</div>
                  <div style={{ color: "var(--app-text)", fontFamily: "monospace", fontSize: 12 }}>{catEntry.registration_number}</div>
                </div>
              )}
              <div>
                <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Source</div>
                <div style={{ color: "var(--app-text)" }}>{catEntry.source_name} ({catEntry.source_country})</div>
              </div>
              {catEntry.sponsor && (
                <div>
                  <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Sponsor</div>
                  <div style={{ color: "var(--app-text)" }}>{catEntry.sponsor}</div>
                </div>
              )}
              <div>
                <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Status</div>
                <div style={{ color: "var(--low)", fontWeight: 500 }}>{catEntry.registration_status ?? "Active"}</div>
              </div>
            </div>
          </div>

          {/* AI insight */}
          <div style={{
            background: "var(--ind-bg)", border: "1px solid var(--ind-b)", borderRadius: 12,
            padding: "14px 18px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--indigo)", marginBottom: 6 }}>
              AI insight
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-2)", lineHeight: 1.6 }}>
              No active shortages are currently reported for {catEntry.generic_name}. Supply appears stable. This drug is registered with {catEntry.source_name} and no disruptions have been flagged by any monitored regulatory source.
            </div>
          </div>
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
  const cookieStore = await cookies();
  const userCountry = cookieStore.get("mederti-country")?.value ?? "AU";

  /* ── Risk Score ── */
  const now = Date.now();
  const d30ms = now - 30 * 86400000;
  const d60ms = now - 60 * 86400000;
  let riskLast30 = 0, riskPrior30 = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of shortages as any[]) {
    const t = new Date(s.updated_at ?? s.created_at).getTime();
    if (t >= d30ms) riskLast30++;
    else if (t >= d60ms) riskPrior30++;
  }
  let riskEscalations = 0, riskLogEntries = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const log of statusLog as any[]) {
    const t = new Date(log.changed_at).getTime();
    if (t >= d30ms) {
      riskLogEntries++;
      if ((SEV_RANK[log.new_severity] ?? 0) > (SEV_RANK[log.old_severity] ?? 0)) riskEscalations++;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of availability as any[]) {
    const cc = a.country ?? "";
    if (!countryGroups[cc] && a.status !== "available") {
      countryGroups[cc] = { country: cc, countryCode: cc, source: a.source_agency ?? "", severity: a.severity ?? a.status ?? "medium", lastUpdated: a.last_verified_at ?? "", count: 1 };
    }
  }
  const countries = Object.values(countryGroups).sort((a, b) => {
    const ai = SEV_ORDER.indexOf(a.severity as typeof SEV_ORDER[number]);
    const bi = SEV_ORDER.indexOf(b.severity as typeof SEV_ORDER[number]);
    return ai - bi;
  });
  const userCountryInList = countries.some((c) => c.countryCode === userCountry);

  const userShortage = activeShortages.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.country_code?.toUpperCase() === userCountry,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anticipatedShortages = activeShortages.filter((s: any) => s.status?.toLowerCase() === "anticipated");
  const isAnticipatedOnly = activeShortages.length > 0 && anticipatedShortages.length === activeShortages.length;

  /* ── My Country card data ── */
  const myShortage = userShortage as { status?: string; severity?: string; estimated_resolution_date?: string; start_date?: string; end_date?: string; reason?: string; reason_category?: string; country_code?: string } | undefined;
  const myStatus = myShortage ? (myShortage.status ?? "active").toLowerCase() : null;
  const myIsAnticipated = myStatus === "anticipated";
  const mySevRaw = myShortage?.severity ?? "medium";
  const cName = COUNTRY_NAMES[userCountry] ?? userCountry;
  const myTheme = myShortage
    ? (myIsAnticipated
      ? { color: "#d97706", bg: "#fef3c7", border: "#f59e0b44" }
      : mySevRaw === "low"
        ? { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)" }
        : sevColor(mySevRaw))
    : { color: "var(--low)", bg: "var(--low-bg)", border: "var(--low-b)" };
  const myLabel = myIsAnticipated
    ? "Anticipated shortage"
    : myShortage
      ? (mySevRaw.charAt(0).toUpperCase() + mySevRaw.slice(1)) + " shortage"
      : "In supply";
  const mySubtext = myShortage
    ? (myIsAnticipated
      ? "Supply disruption expected"
      : (myShortage.reason?.replace(/^availability:\s*/i, "") ?? "Supply disruption"))
    : "No shortage reported";

  // Predicted return for My Country card
  const hasResDate = !!myShortage?.estimated_resolution_date;
  const hasMultipleSources = sourceSet.size >= 2;
  const confidence = hasResDate ? (hasMultipleSources ? 74 : 61) : 0;
  let predictedReturnDate: string | null = null;
  if (myShortage && myStatus !== "anticipated" && myShortage.estimated_resolution_date) {
    predictedReturnDate = new Date(myShortage.estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
  }

  /* ── Timeline ── */
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
      if (s.reason && !/^availability:/i.test(s.reason.trim())) desc += ` ${s.reason}`;
      else if (s.reason_category) desc += ` ${s.reason_category.replace(/_/g, " ")}`;
    }
    timeline.push({ date: eventDate, source: src, description: desc, type, countryCode: s.country_code ?? "" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const log of statusLog as any[]) {
    const ms = shortageMap.get(log.shortage_event_id);
    const src = ms ? abbreviateSource(ms.data_sources?.name ?? "", ms.data_sources?.abbreviation) : "";
    const cc = ms?.country_code ?? "";
    const country = ms?.country ?? cc;
    let type: TimelineEntry["type"] = "update";
    let desc = `${country} \u2014 `;
    const oldI = SEV_ORDER.indexOf(log.old_severity as typeof SEV_ORDER[number]);
    const newI = SEV_ORDER.indexOf(log.new_severity as typeof SEV_ORDER[number]);
    if (log.new_status === "resolved") { type = "resolved"; desc += "Shortage resolved."; }
    else if (newI >= 0 && oldI >= 0 && newI < oldI) { type = "escalation"; desc += `Escalated ${log.old_severity} \u2192 ${log.new_severity}.`; }
    else if (newI >= 0 && oldI >= 0 && newI > oldI) { type = "de_escalation"; desc += `De-escalated ${log.old_severity} \u2192 ${log.new_severity}.`; }
    else { desc += "Status updated."; }
    timeline.push({ date: log.changed_at, source: src, description: desc, type, countryCode: cc });
  }

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const deduped: TimelineEntry[] = [];
  for (const entry of timeline) {
    if (!deduped.some((e) => Math.abs(new Date(e.date).getTime() - new Date(entry.date).getTime()) < 3600000 && e.countryCode === entry.countryCode && e.type === entry.type))
      deduped.push(entry);
  }

  /* ── Verified sources ── */
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

  /* ── Opening AI message ── */
  const localStatus = countryGroups[userCountry];
  const localName = COUNTRY_NAMES[userCountry] ?? userCountry;
  let openingMessage: string;
  if (activeShortages.length > 0) {
    const sevLabel = worstSeverity === "critical" ? "critical" : worstSeverity === "high" ? "significant" : "moderate";
    openingMessage = `${drug.generic_name} is currently under ${sevLabel} shortage in ${affectedCountries.size} countr${affectedCountries.size !== 1 ? "ies" : "y"}.`;
    if (localStatus) {
      const localLabel = localStatus.severity === "critical" ? "not available" : localStatus.severity === "high" ? "very limited" : localStatus.severity === "medium" ? "limited" : "reduced";
      openingMessage += ` In ${localName}, supply is ${localLabel} according to ${localStatus.source}.`;
    } else {
      openingMessage += ` No shortage is currently reported in ${localName}.`;
    }
    if (alternatives.length > 0) openingMessage += ` There are ${alternatives.length} known therapeutic alternative${alternatives.length !== 1 ? "s" : ""}.`;
    openingMessage += " What would you like to know?";
  } else {
    openingMessage = `No active shortages are currently reported for ${drug.generic_name}. Supply appears stable across all monitored countries. Ask me anything about this drug's history, alternatives, or market status.`;
  }

  /* ── Drug context for chat ── */
  const drugContext = {
    id: drug.id,
    generic_name: drug.generic_name,
    brand_names: drug.brand_names ?? [],
    atc_code: drug.atc_code ?? null,
    strength: drugStrength,
    form: drugForm,
    userCountry,
    userCountryName: cName,
    userCountryStatus: myShortage?.status ?? "no data",
    userCountrySeverity: myShortage?.severity ?? "unknown",
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

  /* ── Mobile layout ── */
  const device = await getDevice();
  if (device === "mobile") {
    const mobilePartner = getPartnerForCountry(userCountry);
    return (
      <MobileDrugPage
        drug={drug}
        activeShortages={activeShortages}
        userCountry={userCountry}
        partner={mobilePartner}
        drugStrength={drugStrength}
        predictedReturnDate={predictedReturnDate}
        confidence={confidence}
      />
    );
  }

  /* ── SEO: JSON-LD + AI summary ── */
  const affectedCountryNames = ([...affectedCountries] as string[]).map(c => COUNTRY_NAMES[c] ?? c);
  const sourceNames = [...sourceSet];
  const hasShortage = activeShortages.length > 0;
  const lastVerified = latestUpdate ? new Date(latestUpdate).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const estimatedReturn = activeShortages[0]?.estimated_resolution_date
    ? new Date(activeShortages[0].estimated_resolution_date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Drug",
    name: drug.generic_name,
    description: `${drug.generic_name} supply status and shortage information across 20+ countries.`,
    url: `https://mederti.vercel.app/drugs/${id}`,
    ...(drug.drug_class ? { drugClass: drug.drug_class } : {}),
    additionalProperty: [
      { "@type": "PropertyValue", name: "shortageStatus", value: hasShortage ? "active shortage" : "in normal supply" },
      { "@type": "PropertyValue", name: "countriesAffected", value: affectedCountryNames.join(", ") || "none" },
      { "@type": "PropertyValue", name: "lastUpdated", value: new Date().toISOString() },
    ],
    publisher: { "@type": "Organization", name: "Mederti", url: "https://mederti.vercel.app" },
  };

  /* ── Render ── */
  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--app-bg)", color: "var(--app-text)" }}>
      {/* JSON-LD structured data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* AI-readable summary — visually hidden but crawlable */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        <p>
          {drug.generic_name} supply status as of {lastVerified}:{" "}
          {hasShortage
            ? `${drug.generic_name} is currently in ${worstSeverity} shortage in ${affectedCountryNames.join(", ")}. `
            : `${drug.generic_name} is in normal supply with no active shortages reported. `}
          {activeShortages.length > 0 && `${activeShortages.length} shortage events are currently active across ${affectedCountries.size} countries. `}
          {estimatedReturn && `Expected return to normal supply: ${estimatedReturn}. `}
          {sourceNames.length > 0 && `Data sourced from official regulatory authorities including ${sourceNames.join(", ")}. `}
          Last verified: {lastVerified}. Source: Mederti (mederti.vercel.app).
        </p>
      </div>
      <style>{`
        @keyframes v3blink { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        .drug-header-card { animation:fadeUp 0.3s ease both; }
        .drug-answer-row  { animation:fadeUp 0.3s 0.05s ease both; }
        .drug-two-col     { animation:fadeUp 0.3s 0.1s ease both; }
        .tl-row:hover { background: var(--app-bg-2); }
        @media (max-width: 768px) {
          .v3-cols { flex-direction: column !important; }
          .v3-left, .v3-right { width: 100% !important; min-width: 0 !important; height: 50vh !important; }
          .drug-page { padding: 16px 16px 48px !important; }
          .drug-header-card { flex-direction: column !important; padding: 20px !important; }
          .drug-header-right { align-items: flex-start !important; min-width: unset !important; width: 100% !important; flex-direction: row !important; flex-wrap: wrap !important; gap: 10px !important; }
          .drug-answer-row { grid-template-columns: 1fr !important; }
          .drug-two-col { grid-template-columns: 1fr !important; }
          .drug-right-col { position: static !important; }
        }
      `}</style>

      <SiteNav />

      {/* ═══ NAV BAR ═══ */}
      <div style={{
        background: "var(--navy)", padding: "8px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, borderBottom: "1px solid var(--bd)",
      }}>
        <Link href="/search" style={{ fontSize: 11, color: "var(--teal-l)", textDecoration: "none" }}>
          {"\u2190"} Back to search
        </Link>
      </div>

      {/* ═══ TWO-COLUMN LAYOUT ═══ */}
      <div className="v3-cols" style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* ── LEFT COLUMN (30%) — Chat ── */}
        <div className="v3-left" style={{ width: "25%", minWidth: 280, borderRight: "1px solid var(--app-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <V3ChatPanel drugId={id} drugContext={drugContext} openingMessage={openingMessage} />
        </div>

        {/* ── RIGHT COLUMN (70%) — Drug Detail ── */}
        <div className="v3-right" style={{ flex: 1, overflowY: "auto", background: "var(--app-bg)", color: "var(--app-text)" }}>

          {/* ═══ 1. HEADER ROW — Drug Identity left + My Country card right ═══ */}
          <div style={{ background: "#fff", borderBottom: "1px solid var(--app-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div
              className="drug-header-card"
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                padding: "28px 32px",
                display: "flex",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: 24,
              }}
            >
              {/* LEFT — Drug Identity */}
              <div style={{ flex: 1, display: "flex", gap: 20 }}>
                {/* Drug product image from DailyMed */}
                <DrugImage genericName={drug.generic_name} />

                <div style={{ flex: 1 }}>
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
                </div>

                {/* Drug name */}
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--app-text)", lineHeight: 1.15, marginBottom: 4 }}>
                  {truncateDrugName(drug.generic_name, 120)}
                  {drugStrength && (
                    <span style={{ fontSize: 18, fontWeight: 400, color: "var(--app-text-3)", marginLeft: 8 }}>
                      {drugStrength}
                    </span>
                  )}
                </div>

                {/* Subtitle */}
                <div style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 6 }}>
                  {[truncateDrugName(drug.generic_name, 120).toLowerCase(), drugForm, drugStrength].filter(Boolean).join(" \u00b7 ")}
                  {drugRoute && ` \u00b7 ${drugRoute}`}
                </div>

                {/* Meta line */}
                <div style={{ fontSize: 12, color: "var(--app-text-4)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                  {drug.atc_code && (
                    <span style={{
                      display: "inline-flex", padding: "2px 7px", borderRadius: 4,
                      fontSize: 11, background: "var(--ind-bg)", color: "var(--indigo)",
                      border: "1px solid var(--ind-b)",
                      fontFamily: "var(--font-dm-mono), monospace",
                    }}>
                      ATC: {drug.atc_code}
                    </span>
                  )}
                  <span>{" \u00b7 "}</span>
                  {sourceSet.size > 0 && (
                    <span>{Array.from(sourceSet).slice(0, 3).join(", ")}</span>
                  )}
                  <span>{" \u00b7 "}</span>
                  <span>{latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : "Updated today"}</span>
                  <span>{" \u00b7 "}</span>
                  <span><strong style={{ color: "var(--teal)" }}>{sourceSet.size}</strong> source{sourceSet.size !== 1 ? "s" : ""}</span>
                </div>

                {/* Tag pills — filter out scraper provenance strings */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {drug.drug_class && !/scraper|auto.created/i.test(drug.drug_class) && (
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                      {drug.drug_class}
                    </span>
                  )}
                  {drug.therapeutic_category && !/scraper|auto.created/i.test(drug.therapeutic_category) && (
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                      {drug.therapeutic_category}
                    </span>
                  )}
                  {drug.dosage_forms?.filter((f: string) => !/scraper|auto.created/i.test(f)).slice(0, 2).map((f: string) => (
                    <span key={f} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, background: "var(--app-bg-2)", color: "var(--app-text-3)", border: "1px solid var(--app-border)" }}>
                      {f}
                    </span>
                  ))}
                </div>

                {/* Action buttons */}
                <HeaderActions
                  drugId={id}
                  drugName={`${drug.generic_name}${drugStrength ? ` ${drugStrength}` : ""}`.trim()}
                  userCountry={userCountry}
                  severity={mySevRaw}
                />
                </div>
              </div>

              {/* RIGHT — My Country card with bell icon */}
              <div className="drug-header-right" style={{
                position: "relative",
                background: myTheme.bg,
                border: `1px solid ${myTheme.border}`,
                borderRadius: 12,
                padding: "16px 20px",
                minWidth: 260,
                maxWidth: 320,
                display: "flex",
                flexDirection: "column",
              }}>
                {/* Bell icon — top right */}
                <V4BellButton drugId={id} hasShortage={!!userShortage} />

                {/* Country label */}
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                  color: myTheme.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
                }}>
                  <FlagIcon code={userCountry} size={14} />
                  {cName} &middot; NOW
                </div>

                {/* Status */}
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 3 }}>
                  {myLabel}
                </div>
                <div style={{ fontSize: 12, color: "var(--app-text-3)", marginBottom: 12 }}>
                  {mySubtext}
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "var(--app-border)", marginBottom: 10 }} />

                {/* Predicted return */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--app-text-4)", marginBottom: 4 }}>
                      Predicted return
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)" }}>
                      {predictedReturnDate ?? "Unknown"}
                    </div>
                  </div>
                  {confidence > 0 && (
                    <div style={{ fontSize: 12, fontFamily: "var(--font-dm-mono), monospace", color: "var(--teal)", fontWeight: 500 }}>
                      {confidence} / 100
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="drug-page" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 64px" }}>

            {/* ═══ 2. SHORTAGE FORECAST ═══ */}
            <ShortageForcast shortages={shortages} userCountry={userCountry} drugName={drug.generic_name} />

            {/* ═══ 3. SHORTAGE REPORTS BY COUNTRY ═══ */}
            <div id="country-list" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Shortage reports by country</span>
                <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {countries.length} countr{countries.length !== 1 ? "ies" : "y"} affected
                </span>
              </div>
              <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden", padding: "16px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {!userCountryInList && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 2px",
                      borderBottom: countries.length > 0 ? "1px solid var(--app-border)" : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 28, textAlign: "center", display: "inline-flex", justifyContent: "center" }}>
                          <FlagIcon code={userCountry} size={14} />
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
                          {COUNTRY_NAMES[userCountry] ?? userCountry}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--low)", display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--low)" }}>No shortage</span>
                      </div>
                    </div>
                  )}
                  {countries.map((g, i) => {
                    const sc = g.severity === "low"
                      ? { color: "var(--med)", bg: "var(--med-bg)", border: "var(--med-b)" }
                      : sevColor(g.severity);
                    const isUser = g.countryCode === userCountry;
                    const availText = g.severity === "critical" ? "Not available" : g.severity === "high" ? "Very limited" : g.severity === "medium" ? "Limited" : "Supply disruption";
                    return (
                      <div key={g.countryCode} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 2px",
                        borderBottom: i < countries.length - 1 ? "1px solid var(--app-border)" : "none",
                        ...(isUser ? { order: -1 } : {}),
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 28, textAlign: "center", display: "inline-flex", justifyContent: "center" }}>
                            <FlagIcon code={g.countryCode} size={14} />
                          </span>
                          <span style={{ fontSize: 14, fontWeight: isUser ? 600 : 500, color: "var(--app-text)" }}>{g.country}</span>
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
            </div>

            {/* ═══ 4. AI INSIGHT TEXT ═══ */}
            <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--app-text-2)", marginBottom: 20 }}>
              {buildAiInsightText({
                drugName: drug.generic_name,
                activeShortages: activeShortages as { country_code?: string; status?: string; severity?: string; reason?: string; start_date?: string; estimated_resolution_date?: string; data_sources?: { name?: string; abbreviation?: string } }[],
                userCountry,
                affectedCountries: affectedCountries as Set<string>,
              })}
            </p>

            {/* ═══ 5. SUPPLY TIMELINE ═══ */}
            {deduped.length > 0 && (
              <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Supply Timeline</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {deduped.length} event{deduped.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {deduped.slice(0, 15).map((entry, i) => {
                      const dotColor = DOT_COLORS[entry.type] ?? DOT_COLORS.update;
                      const isFirst = i === 0;
                      const isLast = i === Math.min(deduped.length, 15) - 1;
                      return (
                        <div key={`${entry.date}-${i}`} className="tl-row" style={{ display: "flex", gap: 14, paddingBottom: isLast ? 0 : 16, borderRadius: 6, transition: "background 0.1s" }}>
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
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {formatDate(entry.date)}
                                {entry.date && ` \u00b7 ${timeAgo(entry.date)}`}
                              </span>
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

            {/* ═══ 6. WHAT CAN I USE INSTEAD? ═══ */}
            <div style={{ marginBottom: 20 }}>
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
                        padding: "14px 20px",
                        background: "#fff", border: "1px solid var(--app-border)",
                        borderRadius: 12, textDecoration: "none",
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

            {/* ═══ 7. VERIFIED SOURCES ═══ */}
            {shortages.length > 0 && (
              <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--app-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>Verified Sources</span>
                  <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    cross-checked {latestUpdate ? timeAgo(latestUpdate) : "today"}
                  </span>
                </div>
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Array.from(seenSources.values()).map((src) => (
                      <div key={src.abbreviation} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 16px", borderRadius: 8, background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <FlagIcon code={src.countryCode} size={14} />
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
                            <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>{"\u2197"}</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ 8. GLOBAL STATUS + RISK SCORE (slim, below fold) ═══ */}
            <div style={{
              background: "#fff",
              border: "1px solid var(--app-border)",
              borderRadius: 12, padding: "16px 20px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                  color: "var(--app-text-3)", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--app-text-3)" }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Global Status
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>
                    {activeShortages.length > 0
                      ? isAnticipatedOnly
                        ? "Anticipated shortage"
                        : (worstSeverity.charAt(0).toUpperCase() + worstSeverity.slice(1)) + " shortage"
                      : "In supply"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                    {affectedCountries.size > 0
                      ? `${affectedCountries.size} countr${affectedCountries.size !== 1 ? "ies" : "y"} affected`
                      : "0 countries affected"}
                  </span>
                </div>
              </div>
              {activeShortages.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--app-text-4)" }}>Supply Risk Score</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em", background: riskColors.bg, color: riskColors.color, border: `1px solid ${riskColors.border}`, whiteSpace: "nowrap" }}>{drugRisk.riskLevel}</span>
                      <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 18, fontWeight: 700, color: riskColors.color }}>{drugRisk.riskScore}</span>
                    </div>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--app-bg-3, #e2e8f0)", overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ width: `${drugRisk.riskScore}%`, height: "100%", borderRadius: 2, background: drugRisk.riskScore >= 70 ? "var(--crit, #dc2626)" : drugRisk.riskScore >= 40 ? "var(--med, #ca8a04)" : "var(--low, #16a34a)" }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--app-text-3)" }}>{drugRisk.primarySignal}</div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
