export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canonicalUrl, siteUrl, pageTitle, pageDescription, drugJsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { cookies } from "next/headers";
import Link from "next/link";
import { SEV_RANK, calculateRiskScore, riskStyle } from "@/lib/risk-score";
import SiteNav from "@/app/components/landing-nav";
import { AskMedertiCta } from "./ask-mederti-cta";
import { buildAiInsightText } from "./build-insight-text";
import { V4BellButton } from "./bell-button";
import { HeaderActions } from "./header-actions";
import { getDevice } from "@/lib/get-device";
import { MobileDrugPage } from "@/app/components/mobile/MobileDrugPage";
import { truncateDrugName } from "@/lib/utils";
import { affinity } from "@/lib/alternatives";
import { cleanBrandNames } from "@/lib/brand";
import { getPartnerForCountry } from "@/lib/suppliers";
import { DrugImage } from "./drug-image";
import AvailableSuppliers from "./AvailableSuppliers";
import SoWhatInsight from "./SoWhatInsight";
import PersonaSwitcher from "./PersonaSwitcher";
import PharmacistAnswerCard from "./PharmacistAnswerCard";
import V1DrugView from "./V1DrugView";
import ProcurementView from "./ProcurementView";
import SupplierView from "./SupplierView";

/** Tiny ISO-3166 → emoji-flag map for the country chips. */
const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦",
  SG: "🇸🇬", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪",
  CH: "🇨🇭", NO: "🇳🇴", SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰", NL: "🇳🇱",
  BE: "🇧🇪", AT: "🇦🇹", PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", JP: "🇯🇵",
  KR: "🇰🇷", IN: "🇮🇳", CN: "🇨🇳", BR: "🇧🇷", MX: "🇲🇽", ZA: "🇿🇦",
};
const flagFor = (cc: string): string => FLAG[cc?.toUpperCase()] ?? "🌐";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ as?: string }>;
}

type Persona = "pharmacist" | "procurement" | "supplier";

/** Maps user_profiles.role → persona view. */
function personaFromRole(role: string | null | undefined): Persona | null {
  if (!role) return null;
  if (role === "pharmacist") return "pharmacist";
  // Closes audit FINDING-UX-04: doctors previously fell through to the
  // supplier (F bento) view despite /doctors marketing promising
  // "shortage alerts before you prescribe". Pharmacist view is the
  // closest fit for clinical decision-makers.
  if (role === "doctor") return "pharmacist";
  if (role === "hospital" || role === "government") return "procurement";
  if (role === "supplier") return "supplier";
  return null; // 'default' or unknown
}

/** Explicit ?as= wins, else session role, else pharmacist. */
function resolvePersona(as: string | undefined, sessionRole: string | null): Persona {
  if (as === "procurement") return "procurement";
  if (as === "supplier") return "supplier";
  if (as === "pharmacist") return "pharmacist";
  // Closes audit FINDING-UX-04: previously defaulted to "supplier" (F bento
  // layout) when role was missing or unknown. Pharmacist view is the
  // CLAUDE.md-stated "radical simplification — answer + actions" default;
  // safer fallback than dropping unknown users into a market-scan UI.
  return personaFromRole(sessionRole) ?? "pharmacist";
}

/* ── SEO: dynamic metadata ── */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [drugRes, shortagesRes, catalogueCountryRes] = await Promise.all([
    supabase
      .from("drugs")
      .select("generic_name, drug_class, atc_code, atc_description, brand_names, who_essential_medicine, rxcui")
      .eq("id", id)
      .single(),
    // All active shortages, severity-sorted, so we can summarise across markets
    supabase
      .from("shortage_events")
      .select("status, severity, country_code, start_date")
      .eq("drug_id", id)
      .eq("status", "active")
      .order("severity", { ascending: true })
      .limit(20),
    // Country count via drug_catalogue (cross-border footprint)
    supabase
      .from("drug_catalogue")
      .select("source_country")
      .eq("drug_id", id)
      .limit(2000),
  ]);

  const drug = drugRes.data;
  const shortages = (shortagesRes.data ?? []) as Array<{
    status: string; severity: string; country_code: string; start_date: string | null;
  }>;
  const countries = new Set((catalogueCountryRes.data ?? []).map((c) => (c as { source_country: string }).source_country));

  if (!drug) {
    // Try catalogue fallback
    const { data: cat } = await supabase
      .from("drug_catalogue")
      .select("generic_name")
      .eq("id", id)
      .single();
    const name = cat?.generic_name ?? "Drug";
    return {
      title: pageTitle({ generic_name: name }),
      description: pageDescription({ generic_name: name }, [], 20),
      alternates: { canonical: canonicalUrl(`/drugs/${id}`) },
      robots: { index: true, follow: true },
    };
  }

  // Map to the JSON-LD-friendly shape
  const shortagesForSeo = shortages.map((s) => ({
    country: s.country_code,
    severity: s.severity,
    status: s.status,
    start_date: s.start_date,
  }));

  const title = pageTitle(drug, shortagesForSeo[0]);
  const description = pageDescription(drug, shortagesForSeo, countries.size);
  const url = canonicalUrl(`/drugs/${id}`);

  return {
    title,
    description,
    keywords: [
      drug.generic_name,
      `${drug.generic_name} shortage`,
      `${drug.generic_name} supply`,
      `${drug.generic_name} alternatives`,
      `${drug.generic_name} manufacturer`,
      ...cleanBrandNames(drug.brand_names, drug.generic_name).slice(0, 3),
      drug.drug_class,
      drug.atc_description,
    ].filter(Boolean) as string[],
    openGraph: {
      title,
      description,
      url,
      siteName: "Mederti",
      type: "website",
      images: [{ url: `${siteUrl()}/api/og/drug/${id}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteUrl()}/api/og/drug/${id}`],
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    other: {
      // Schema.org JSON-LD — Next.js inlines `other.*` keys as <meta>,
      // but the JSON-LD goes in the page body via <script> below. We
      // expose the serialized payload here so the page component can
      // pick it up via the same generateMetadata-fetched data.
      "mederti:drug_id": id,
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

export default async function DrugPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};

  // ── Persona resolution ──────────────────────────────────────────────────
  // Precedence: ?as= query > signed-in user's role > pharmacist default.
  // Session lookup is best-effort — never block the page on it.
  let sessionRole: string | null = null;
  try {
    const { createServerClient } = await import("@/lib/supabase/server");
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const admin = getSupabaseAdmin();
      const { data: profile } = await admin
        .from("user_profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      sessionRole = (profile as { role?: string } | null)?.role ?? null;
    }
  } catch { /* anonymous — default persona */ }
  // Pharmacist-only launch: when soft-launch is on, the isolated site serves a
  // single audience — lock to the pharmacist view and ignore ?as=/role so the
  // procurement/supplier surfaces never appear. Full platform (flag off)
  // keeps the persona system intact.
  const PHARMACIST_ONLY =
    (process.env.NEXT_PUBLIC_SOFT_LAUNCH ?? "").toLowerCase() === "true";
  const persona: Persona = PHARMACIST_ONLY
    ? "pharmacist"
    : resolvePersona(sp.as, sessionRole);

  const supabase = getSupabaseAdmin();

  /* ── Parallel data fetching ── */
  const [drugRes, shortagesRes, logRes, alternativesRes, recallsRes, productsRes] =
    await Promise.allSettled([
      supabase.from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class, dosage_forms, strengths, routes_of_administration, therapeutic_category, is_controlled_substance, who_essential_medicine, who_eml_section, who_eml_year")
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
      // Closes audit FINDING-UX-10: previously returned a 200 with HTML
      // saying "Drug not found", which Google would index as a real page.
      // notFound() throws past the layout and serves Next's actual 404.
      notFound();
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

  // Pharmacist-only launch: render the V1 design, fed by the already-fetched
  // (and safety-hardened) data. Bypasses the legacy persona render entirely.
  //
  // NOTE ON MOBILE: V1DrugView is fully responsive (its 3-column shell
  // collapses to a single column on phones), so we do NOT branch to
  // MobileDrugPage here. The getDevice()/MobileDrugPage path further down
  // is the LEGACY persona render's mobile variant and only runs when
  // soft-launch is OFF (full platform). It is dormant — not dead — while
  // PHARMACIST_ONLY is true; don't delete it without also retiring the
  // persona views it serves.
  if (PHARMACIST_ONLY) {
    // API supply-base concentration from FDA Drug Master Files (active Type II
    // DMFs = manufacturers cleared to supply this API into the US market). This
    // is the primary-source manufacturing-concentration signal — the headline
    // feature of the Johns Hopkins supply-chain dashboard, sourced directly.
    const inn = (drug.generic_name ?? "").toLowerCase();
    const { data: apiSupplierRows } = await supabase
      .from("api_suppliers")
      .select("manufacturer_name, country, source, who_pq")
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .limit(300);
    const supplierRows = (apiSupplierRows ?? []) as { manufacturer_name: string | null; country: string | null; who_pq: boolean | null }[];
    const makerSet = new Map<string, string>();
    const whoPqMakers = new Set<string>();
    for (const r of supplierRows) {
      const name = (r.manufacturer_name ?? "").trim();
      if (name && !makerSet.has(name.toLowerCase())) makerSet.set(name.toLowerCase(), name);
      if (name && r.who_pq) whoPqMakers.add(name.toLowerCase());
    }
    const makerNames = [...makerSet.values()];
    const makerCount = makerNames.length;
    const apiCountries = [
      ...new Set(
        ((apiSupplierRows ?? []) as { country: string | null }[])
          .map((r) => (r.country ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const apiConcentration =
      makerCount > 0
        ? {
            count: makerCount,
            band: (
              makerCount === 1 ? "very_high" :
              makerCount <= 3 ? "high" :
              makerCount <= 6 ? "medium" : "low"
            ) as "very_high" | "high" | "medium" | "low",
            makers: makerNames.slice(0, 6),
            countries: apiCountries,
            whoPqCount: whoPqMakers.size,
          }
        : null;

    // FDA approval footprint — NDA (brand/innovator) vs ANDA (generic) is a
    // market-depth signal: more approved generics = a more resilient supply.
    const { data: approvalRows } = await supabase
      .from("drug_approvals")
      .select("authority, application_type, approval_date, brand_name")
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .order("approval_date", { ascending: false })
      .limit(200);
    const approvals = (approvalRows ?? []) as { application_type: string | null; approval_date: string | null; brand_name: string | null }[];
    const approvalFootprint =
      approvals.length > 0
        ? {
            total: approvals.length,
            generics: approvals.filter((a) => (a.application_type ?? "").toUpperCase() === "ANDA").length,
            brands: approvals.filter((a) => ["NDA", "BLA"].includes((a.application_type ?? "").toUpperCase())).length,
            latest: approvals.map((a) => a.approval_date).filter(Boolean)[0] ?? null,
          }
        : null;

    // Structured regulatory-eligibility entries (TGA Section 19A et al) from the
    // regulatory_eligibility table (migration 040), populated by the eligibility
    // scrapers. This is the authoritative substitution-pathway signal — a real
    // approval number a pharmacist can quote, with a verifiable source URL —
    // replacing the brittle string-match on shortage notes. If the migration
    // isn't applied yet the query errors softly (data → null) and the view
    // falls back to notes-parsing, so this is safe to ship ahead of the DDL.
    const { data: eligRows } = await supabase
      .from("regulatory_eligibility")
      .select(
        "scheme, status, scheme_reference, description, brand_name, listed_at, expires_at, source_url, source_name, country_code",
      )
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .eq("status", "active")
      .limit(50);
    const eligibility = (eligRows ?? []) as {
      scheme: string;
      status: string;
      scheme_reference: string | null;
      description: string | null;
      brand_name: string | null;
      listed_at: string | null;
      expires_at: string | null;
      source_url: string | null;
      source_name: string | null;
      country_code: string | null;
    }[];

    // PBS trade price (AEMP ex-manufacturer + DPMQ dispensed) for the user's
    // market, from drug_pricing (populated by the PBS ingest). Defensive: if the
    // dispensed_amount column / rows aren't there yet the query errors softly
    // (data → null) and the view simply omits the price block. AU-only today.
    const { data: priceRows } = await supabase
      .from("drug_pricing")
      .select("price_amount, dispensed_amount, currency, pack_size, price_date, source")
      .eq("drug_id", id)
      .eq("country_code", userCountry)
      .order("price_date", { ascending: false, nullsFirst: false })
      .limit(1);
    const pr = (priceRows ?? [])[0] as
      | { price_amount: number | null; dispensed_amount: number | null; currency: string | null; pack_size: string | null; price_date: string | null; source: string | null }
      | undefined;
    const pricing =
      pr && pr.price_amount != null
        ? {
            ex_manufacturer: Number(pr.price_amount),
            dispensed: pr.dispensed_amount != null ? Number(pr.dispensed_amount) : null,
            currency: pr.currency ?? "AUD",
            pack: pr.pack_size ?? null,
            price_date: pr.price_date ?? null,
            source: pr.source ?? "PBS",
          }
        : null;

    return (
      <V1DrugView
        id={id}
        drug={drug}
        shortages={shortages}
        statusLog={statusLog}
        alternatives={alternatives}
        userCountry={userCountry}
        apiConcentration={apiConcentration}
        recalls={recalls}
        approvalFootprint={approvalFootprint}
        eligibility={eligibility}
        pricing={pricing}
      />
    );
  }

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
  // No genuine confidence metric exists yet — the prior 74/61 heuristic was a
  // fabricated score. Pinned to 0 so every "AI confidence" UI (each guarded on
  // confidence > 0) stays hidden until a real metric is wired.
  const confidence = 0;
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

  // Rich JSON-LD graph: Drug + WebPage + (up to 5) MedicalCondition
  // nodes for active shortages. See lib/seo.ts.
  const jsonLd = drugJsonLd(
    {
      id,
      generic_name: drug.generic_name,
      brand_names: cleanBrandNames((drug as { brand_names?: string[] | null }).brand_names, drug.generic_name),
      atc_code: drug.atc_code ?? null,
      atc_description: (drug as { atc_description?: string | null }).atc_description ?? null,
      drug_class: drug.drug_class ?? null,
      is_controlled_substance: (drug as { is_controlled_substance?: boolean | null }).is_controlled_substance ?? null,
      who_essential_medicine: (drug as { who_essential_medicine?: boolean | null }).who_essential_medicine ?? null,
      rxcui: (drug as { rxcui?: string | null }).rxcui ?? null,
    },
    activeShortages.slice(0, 8).map((s: { country_code: string; severity: string; status: string; start_date?: string | null }) => ({
      country: s.country_code,
      severity: s.severity,
      status: s.status,
      start_date: s.start_date ?? null,
    })),
    affectedCountries.size,
  );

  // Breadcrumb structured data — Google shows this above the page title
  // in SERPs. Path: Home › Search › {drug.generic_name}
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Mederti",    path: "/" },
    { name: "Drug search", path: "/search" },
    { name: drug.generic_name, path: `/drugs/${id}` },
  ]);

  /* ── Persona-aware render: procurement and supplier views ───────────────── */
  if (persona === "procurement" || persona === "supplier") {
    const sev: "critical" | "high" | "medium" | "low" =
      worstSeverity === "critical" || worstSeverity === "high" || worstSeverity === "medium" || worstSeverity === "low"
        ? worstSeverity
        : "medium";
    const statusLabel = sev === "critical" ? "Not available" : sev === "high" ? "Very limited" : sev === "medium" ? "Limited" : "Available";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const altsArr = (alternatives as any[]).slice(0, 4).map((a: any) => ({
      name: a.drugs?.generic_name ?? "Alternative",
      form: a.relationship_type ? String(a.relationship_type).replace(/_/g, " ") : "therapeutic alternative",
      // Real ATC-similarity from drug_alternatives, or null when unscored —
      // never a fabricated default (a made-up "70% match" is a safety claim).
      matchPercent: a.similarity_score != null ? Math.round(a.similarity_score * 100) : null,
      isAvailable: true,
    }));

    const top = altsArr[0]
      ? { name: altsArr[0].name, matchPercent: altsArr[0].matchPercent, isAvailable: altsArr[0].isAvailable, form: altsArr[0].form }
      : null;

    // Oldest start_date among active shortages → "since Feb '25"-style label
    const firstStart = activeShortages
      .map((s: { start_date?: string | null }) => s.start_date ? new Date(s.start_date).getTime() : null)
      .filter((t: number | null): t is number => t !== null)
      .sort((a: number, b: number) => a - b)[0];
    const sinceLabel = firstStart
      ? `since ${new Date(firstStart).toLocaleDateString("en-AU", { month: "short", year: "2-digit" }).replace(/(\d{2})$/, "'$1")}`
      : undefined;
    const firstReported = firstStart ? new Date(firstStart).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }).replace(/(\d{2})$/, "'$1") : undefined;

    // Prior incidents = resolved/stale shortage_events for this drug (approx)
    const priorIncidents = (shortages as Array<{ status: string }>).filter(
      (s) => s.status === "resolved" || s.status === "stale"
    ).length;

    // Sources array for SupplierView (regulator, country, flag, hoursAgo)
    const supplierSources = Array.from(seenSources.values())
      .filter((s) => s.lastVerified)
      .map((s) => {
        const hoursAgo = (Date.now() - new Date(s.lastVerified!).getTime()) / 3_600_000;
        return {
          regulator: s.abbreviation,
          country: s.countryCode,
          flag: flagFor(s.countryCode),
          hoursAgo: Math.max(0, hoursAgo),
        };
      })
      .sort((a, b) => a.hoursAgo - b.hoursAgo)
      .slice(0, 5);

    const drugName = `${drug.generic_name}${drugStrength ? ` ${drugStrength}` : ""}`.trim();
    const status = {
      label: statusLabel,
      severity: sev,
      markets: affectedCountries.size > 0
        ? `${affectedCountries.size} market${affectedCountries.size === 1 ? "" : "s"} affected`
        : "no active shortages",
    };

    // ── Reference data (Paths A + B) — gracefully degrades if migrations not applied ──
    let manufacturerConcentration: {
      count: number;
      band: "unknown" | "high_risk" | "moderate_risk" | "low_risk";
      usdmf?: number;
      cep?: number;
      euWc?: number;
    } | null = null;
    try {
      const mc = await supabase
        .from("v_drug_manufacturer_concentration")
        .select("manufacturer_count, concentration_risk, usdmf_count, aggregate_cep_count, eu_wc_count")
        .eq("drug_id", id)
        .maybeSingle();
      const row = mc.data as {
        manufacturer_count?: number;
        concentration_risk?: string;
        usdmf_count?: number;
        aggregate_cep_count?: number;
        eu_wc_count?: number;
      } | null;
      if (row && row.manufacturer_count && row.manufacturer_count > 0) {
        manufacturerConcentration = {
          count: row.manufacturer_count,
          band: (row.concentration_risk as "unknown" | "high_risk" | "moderate_risk" | "low_risk") || "unknown",
          usdmf: row.usdmf_count ?? undefined,
          cep:   row.aggregate_cep_count ?? undefined,
          euWc:  row.eu_wc_count ?? undefined,
        };
      }
    } catch { /* migration 032 not yet applied — silently skip */ }

    let countryPharmaSpend: { country: string; year: number; usdPpp: number } | null = null;
    if (userCountry) {
      try {
        const cs = await supabase
          .from("v_country_pharma_spend_latest")
          .select("country_code2, country_name, year, spending_usd_ppp_per_capita")
          .eq("country_code2", userCountry)
          .maybeSingle();
        const row = cs.data as {
          country_name?: string;
          year?: number;
          spending_usd_ppp_per_capita?: number;
        } | null;
        if (row && row.spending_usd_ppp_per_capita !== undefined && row.year) {
          countryPharmaSpend = {
            country: row.country_name ?? userCountry,
            year: row.year,
            usdPpp: row.spending_usd_ppp_per_capita,
          };
        }
      } catch { /* migration 033 not yet applied — silently skip */ }
    }
    // Expected return is shown ONLY from a sponsor-declared resolution date
    // carried on the regulator notice. We never compute/predict a date from
    // severity — an invented "back in 3–6 months" is a clinical-safety error.
    // confidence:0 hides the (previously fabricated) confidence meter.
    const expectedReturn = predictedReturnDate
      ? { label: "Expected return · sponsor estimate", range: predictedReturnDate, confidence: 0 }
      : null;

    return (
      <div style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

        <style>{`
          @media (max-width: 900px) {
            .v3-cols { flex-direction: column !important; }
            .v3-left { width: 100% !important; max-height: 320px; border-right: 0 !important; border-bottom: 1px solid var(--app-border) !important; }
          }
        `}</style>

        <SiteNav />
        {!PHARMACIST_ONLY && <PersonaSwitcher current={persona} drugId={id} />}

        <div className="v3-cols" style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

          {/* ── LEFT COLUMN — So What insight + Chat ── */}
          <div className="v3-left" style={{ width: "25%", minWidth: 280, borderRight: "1px solid var(--app-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 14px 0", flexShrink: 0 }}>
              <SoWhatInsight drugId={id} />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <AskMedertiCta drugName={drug.generic_name} />
            </div>
          </div>

          {/* ── RIGHT COLUMN — Persona view ── */}
          <div className="v3-right" style={{ flex: 1, overflowY: "auto", background: "var(--app-bg)", color: "var(--app-text)" }}>
            <div style={{ background: "var(--navy)", padding: "8px 24px", borderBottom: "1px solid var(--bd)" }}>
              <Link href="/search" style={{ fontSize: 11, color: "var(--teal-l)", textDecoration: "none" }}>
                {"←"} Back to search
              </Link>
            </div>

            <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 24px 60px", width: "100%" }}>
              {persona === "procurement" ? (
                <ProcurementView
                  drugName={drugName}
                  genericName={drug.generic_name}
                  atcCode={drug.atc_code ?? undefined}
                  drugClass={[drug.atc_description, drug.drug_class, drug.therapeutic_category].filter(Boolean).join(" · ") || undefined}
                  status={status}
                  expectedReturn={expectedReturn}
                  topAlternative={top ? { name: top.name, matchPercent: top.matchPercent, isAvailable: top.isAvailable } : null}
                  alternatives={altsArr}
                  tradePrice={null}
                  shortageDetails={{
                    reason: activeShortages[0]?.reason_category || activeShortages[0]?.reason || undefined,
                    firstReported,
                    sourcesCount: seenSources.size || undefined,
                    priorIncidents: priorIncidents || undefined,
                  }}
                  manufacturer={manufacturerConcentration}
                  marketSpend={countryPharmaSpend}
                />
              ) : (
                <SupplierView
                  drugName={drugName}
                  genericName={drug.generic_name}
                  atcCode={drug.atc_code ?? undefined}
                  status={{ ...status, sinceLabel }}
                  expectedReturn={expectedReturn}
                  topAlternative={top ? { name: top.name, form: top.form, matchPercent: top.matchPercent, isAvailable: top.isAvailable } : null}
                  tradePrice={null}
                  alternatives={altsArr.map((a) => ({ name: a.name, matchPercent: a.matchPercent, isAvailable: a.isAvailable }))}
                  sources={supplierSources}
                  manufacturer={manufacturerConcentration}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--app-bg)", color: "var(--app-text)" }}>
      {/* JSON-LD structured data — Drug graph + Breadcrumbs */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      {/* AI-readable summary — visually hidden but crawlable */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        <p>
          {drug.generic_name} supply status as of {lastVerified}:{" "}
          {hasShortage
            ? `${drug.generic_name} is currently in ${worstSeverity} shortage in ${affectedCountryNames.join(", ")}. `
            : `${drug.generic_name} is in normal supply with no active shortages reported. `}
          {activeShortages.length > 0 && `${activeShortages.length} shortage events are currently active across ${affectedCountries.size} countries. `}
          {estimatedReturn && `Expected return to normal supply (sponsor estimate via regulator notice): ${estimatedReturn}. `}
          {sourceNames.length > 0 && `Data sourced from official regulatory authorities including ${sourceNames.join(", ")}. `}
          Last verified: {lastVerified}. Source: Mederti ({canonicalUrl(`/drugs/${id}`)}).
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

      {/* ═══ PERSONA SWITCHER ═══ */}
      {!PHARMACIST_ONLY && <PersonaSwitcher current={persona} drugId={id} />}

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

        {/* ── LEFT COLUMN (30%) — So What insight + Chat ── */}
        <div className="v3-left" style={{ width: "25%", minWidth: 280, borderRight: "1px solid var(--app-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 14px 0", flexShrink: 0 }}>
            <SoWhatInsight drugId={id} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <AskMedertiCta drugName={drug.generic_name} />
          </div>
        </div>

        {/* ── RIGHT COLUMN (70%) — Drug Detail ── */}
        <div className="v3-right" style={{ flex: 1, overflowY: "auto", background: "var(--app-bg)", color: "var(--app-text)" }}>

          {/* ═══ 0. PHARMACIST ANSWER HERO — recommended substitute, ETA, trade price ═══ */}
          {activeShortages.length > 0 && alternatives.length > 0 && (
            <div style={{ background: "var(--app-bg)", padding: "20px 32px 4px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
              <PharmacistAnswerCard
                drugName={`${drug.generic_name}${drugStrength ? ` ${drugStrength}` : ""}`.trim()}
                genericName={drug.generic_name}
                atcCode={drug.atc_code ?? undefined}
                status={{
                  label: worstSeverity === "critical" ? "Not available" : worstSeverity === "high" ? "Very limited" : "Limited",
                  severity: (worstSeverity === "critical" || worstSeverity === "high" || worstSeverity === "medium" || worstSeverity === "low" ? worstSeverity : "medium") as "critical" | "high" | "medium" | "low",
                  markets: `${affectedCountries.size} ${affectedCountries.size === 1 ? "market" : "markets"} affected`,
                }}
                topAlternative={(() => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const alt = alternatives[0] as any;
                  if (!alt) return null;
                  const altName = alt.drugs?.generic_name ?? "Therapeutic alternative";
                  return {
                    name: altName,
                    form: alt.relationship_type ? alt.relationship_type.replace(/_/g, " ") : "therapeutic alternative",
                    isAvailable: true,
                    matchPercent: alt.similarity_score != null ? Math.round(alt.similarity_score * 100) : null,
                    clinicalReasoning: alt.dose_conversion_notes ?? alt.availability_note ?? `Listed therapeutic alternative for ${drug.generic_name}. Confirm dosing and clinical fit with the prescriber before substituting.`,
                  };
                })()}
                expectedReturn={predictedReturnDate ? {
                  label: "Expected return · sponsor estimate",
                  range: predictedReturnDate,
                  confidence: 0,
                } : null}
                tradePrice={null}
                paediatricAlternative={null}
              />
            </div>
          )}

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
                      Expected return
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)" }}>
                      {predictedReturnDate ?? "No estimate provided"}
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

            {/* ═══ 2.5 AVAILABLE SUPPLIERS (marketplace — actionable for pharmacist) ═══ */}
            <AvailableSuppliers drugId={id} drugName={drug.generic_name} />

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

            {/* ═══ 5. SUPPLY TIMELINE — hidden in simplified pharmacist view ═══ */}
            {false && deduped.length > 0 && (
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
                        {affinity(alt.similarity_score != null ? Math.round(alt.similarity_score * 100) : null) && (
                          <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                            {affinity(Math.round(alt.similarity_score * 100))}
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
