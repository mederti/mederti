/**
 * Programmatic-SEO data layer for the public shortage pages:
 *
 *   /medicine/[slug]                       — per-molecule shortage status
 *   /country/[slug]/medicine-shortages    — per-country live register
 *   /regulator/[slug]                      — per-source profile
 *
 * These pages are PUBLIC (allowlisted in proxy.ts) while the product app
 * (/drugs, /search, …) stays behind the closed-funnel login wall. They query
 * Supabase directly via the service-role client — never via /api/* over HTTP —
 * so ISR regeneration is fast and never hits the per-IP rate limiter.
 *
 * Drug URLs use a derived slug (no slug column exists in the DB). The slug is
 * slugify(generic_name); resolution goes exact-normalised-match first, then a
 * wildcard fallback, and every candidate is verified by re-slugifying its
 * generic_name so a wildcard can never serve the wrong molecule.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ─── Slugs ──────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics left by NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Index-quality gate ─────────────────────────────────────────────────────
//
// The drugs table mixes clean molecules with product-level junk rows
// ("Metocor 50 Mg Tablets…", "Fi-Vnr-053563", non-Latin product strings).
// Only entity-strong rows earn a place in the sitemap and an index,follow
// robots meta; everything else stays reachable but noindexed. Applied
// identically in app/sitemap.ts and /medicine/[slug]'s generateMetadata so
// the two never disagree.

const FORM_WORDS =
  /(^|-)(tablets?|capsules?|injection|injectable|ointment|cream|syrup|solution|suspension|powder|spray|drops|patch|suppositor|mg|ml|mcg)(-|$)/;

export function isQualityDrugSlug(slug: string): boolean {
  if (slug.length < 3 || slug.length > 60) return false;
  if ((slug.match(/-/g)?.length ?? 0) > 5) return false;
  if (FORM_WORDS.test(slug)) return false;
  if (/^[a-z]{2}-vnr-/.test(slug)) return false; // registry-code pseudo-names
  return true;
}

export function isIndexableDrug(
  drug: Pick<PseoDrug, "generic_name" | "rxcui" | "atc_code">,
  eventCount: number,
): boolean {
  return (
    eventCount > 0 &&
    Boolean(drug.rxcui || drug.atc_code) &&
    isQualityDrugSlug(slugify(drug.generic_name))
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PseoDrug {
  id: string;
  generic_name: string;
  brand_names: string[] | null;
  atc_code: string | null;
  atc_description: string | null;
  drug_class: string | null;
  dosage_forms: string[] | null;
  strengths: string[] | null;
  routes_of_administration: string[] | null;
  therapeutic_category: string | null;
  who_essential_medicine: boolean | null;
  who_eml_section: string | null;
  rxcui: string | null;
  updated_at: string;
}

export interface PseoShortageEvent {
  id: string;
  country: string;
  country_code: string | null;
  status: string;
  severity: string | null;
  reason: string | null;
  reason_category: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
  last_verified_at: string | null;
  updated_at: string | null;
  data_sources: { name: string; abbreviation: string | null; source_url: string | null } | null;
}

export interface RegulatorRow {
  id: string;
  name: string;
  abbreviation: string;
  country: string;
  country_code: string;
  region: string | null;
  source_url: string;
  scrape_frequency_hours: number | null;
  last_scraped_at: string | null;
  is_active: boolean;
}

const DRUG_COLS =
  "id, generic_name, brand_names, atc_code, atc_description, drug_class, dosage_forms, strengths, routes_of_administration, therapeutic_category, who_essential_medicine, who_eml_section, rxcui, updated_at";

const EVENT_COLS =
  "id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, updated_at, data_sources(name, abbreviation, source_url)";

// Exclude linker-generated synthetic rows from public pages. `.or` keeps
// NULLs (rows that predate the column) rather than silently dropping them.
// Deliberately does NOT filter is_upstream_signal: that column (migration
// 010) is absent from the production DB (schema drift, verified 2026-08-01)
// and referencing it makes PostgREST reject the whole query.
function realEventsFilter<T extends { or: (f: string) => T }>(q: T): T {
  return q.or("synthetic.is.null,synthetic.eq.false");
}

// ─── Drug resolution ────────────────────────────────────────────────────────

/**
 * Resolve a /medicine/[slug] segment to a canonical drug row.
 * Returns null when nothing verifiably matches.
 */
export async function drugBySlug(slug: string): Promise<PseoDrug | null> {
  const clean = slug.toLowerCase();
  if (!/^[a-z0-9-]{2,120}$/.test(clean)) return null;
  const admin = getSupabaseAdmin();

  // 1) Fast path: hyphens were spaces in the original name.
  //    generic_name_normalised = lower(trim(generic_name)) (migration 001).
  const spaced = clean.replace(/-/g, " ");
  let candidates: PseoDrug[] = [];
  const exact = await admin
    .from("drugs")
    .select(DRUG_COLS)
    .eq("generic_name_normalised", spaced)
    .limit(10);
  candidates = (exact.data ?? []) as unknown as PseoDrug[];

  // 2) Fallback: a slug hyphen can also stand for "-", "/", " / ", "(" etc.
  //    Wildcard-match, then verify below so over-matching is harmless.
  if (candidates.length === 0) {
    const pattern = clean.replace(/-/g, "%");
    const fuzzy = await admin
      .from("drugs")
      .select(DRUG_COLS)
      .ilike("generic_name_normalised", pattern)
      .limit(25);
    candidates = (fuzzy.data ?? []) as unknown as PseoDrug[];
  }

  const verified = candidates.filter((d) => slugify(d.generic_name) === clean);
  if (verified.length === 0) return null;
  if (verified.length === 1) return verified[0];

  // Duplicate generic names exist; prefer the row with the richest identity.
  const score = (d: PseoDrug) =>
    (d.rxcui ? 4 : 0) +
    (d.atc_code ? 2 : 0) +
    (d.brand_names && d.brand_names.length > 0 ? 1 : 0);
  return [...verified].sort((a, b) => score(b) - score(a))[0];
}

/** All shortage events for one drug, newest first (public honesty filter on). */
export async function eventsForDrug(drugId: string): Promise<PseoShortageEvent[]> {
  const admin = getSupabaseAdmin();
  const q = realEventsFilter(
    admin
      .from("shortage_events")
      .select(EVENT_COLS)
      .eq("drug_id", drugId),
  )
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(300);
  const { data } = await q;
  return (data ?? []) as unknown as PseoShortageEvent[];
}

export interface AlternativeRow {
  alternative_drug_id: string;
  relationship_type: string | null;
  clinical_evidence_level: string | null;
  similarity_score: number | null;
  availability_note: string | null;
  drugs: { generic_name: string; brand_names: string[] | null } | null;
}

export async function alternativesForDrug(drugId: string): Promise<AlternativeRow[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("drug_alternatives")
    .select(
      "alternative_drug_id, relationship_type, clinical_evidence_level, similarity_score, availability_note, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)",
    )
    .eq("drug_id", drugId)
    .eq("is_approved", true)
    .order("similarity_score", { ascending: false })
    .limit(6);
  return (data ?? []) as unknown as AlternativeRow[];
}

/** Medicines in the same ATC family (first 4 chars) — internal-link fodder. */
export async function relatedDrugs(
  drug: Pick<PseoDrug, "id" | "atc_code" | "drug_class">,
): Promise<Array<{ id: string; generic_name: string; atc_description: string | null }>> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("drugs")
    .select("id, generic_name, atc_description")
    .neq("id", drug.id)
    .limit(6);
  if (drug.atc_code && drug.atc_code.length >= 4) {
    q = q.ilike("atc_code", `${drug.atc_code.slice(0, 4)}%`);
  } else if (drug.drug_class) {
    q = q.eq("drug_class", drug.drug_class);
  } else {
    return [];
  }
  const { data } = await q;
  return data ?? [];
}

// ─── Country data ───────────────────────────────────────────────────────────

export interface CountrySummary {
  active: number | null;
  anticipated: number | null;
  critical: number | null;
  recent: PseoShortageEventWithDrug[];
}

export interface PseoShortageEventWithDrug extends PseoShortageEvent {
  drug_id: string | null;
  drugs: { generic_name: string } | null;
}

export async function countrySummary(code: string): Promise<CountrySummary> {
  const admin = getSupabaseAdmin();

  const countWhere = async (extra: Record<string, string>) => {
    try {
      let q = admin
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("country_code", code);
      for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
      const { count, error } = await realEventsFilter(q);
      return error ? null : count;
    } catch {
      return null;
    }
  };

  const [active, anticipated, critical, recentRes] = await Promise.all([
    countWhere({ status: "active" }),
    countWhere({ status: "anticipated" }),
    countWhere({ status: "active", severity: "critical" }),
    // Only events resolved to a canonical molecule: each row links out to its
    // /medicine page, and unlinked catalogue-level rows would render as an
    // unclickable "Unlinked product" wall on a public page.
    realEventsFilter(
      admin
        .from("shortage_events")
        .select(
          `drug_id, drugs(generic_name), ${EVENT_COLS}`,
        )
        .eq("country_code", code)
        .not("drug_id", "is", null)
        .in("status", ["active", "anticipated"]),
    )
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(50),
  ]);

  return {
    active,
    anticipated,
    critical,
    recent: ((recentRes as { data: unknown[] | null }).data ??
      []) as unknown as PseoShortageEventWithDrug[],
  };
}

// ─── Regulators ─────────────────────────────────────────────────────────────

export async function allRegulators(): Promise<RegulatorRow[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("data_sources")
    .select(
      "id, name, abbreviation, country, country_code, region, source_url, scrape_frequency_hours, last_scraped_at, is_active",
    )
    .order("country_code");
  return (data ?? []) as unknown as RegulatorRow[];
}

export function regulatorSlug(r: Pick<RegulatorRow, "abbreviation" | "country_code">): string {
  // Abbreviations alone collide across countries (e.g. two "FDA"s), so the
  // slug is abbreviation + country, e.g. "tga-au", "fda-us".
  return `${slugify(r.abbreviation)}-${r.country_code.toLowerCase()}`;
}

export async function regulatorBySlug(slug: string): Promise<RegulatorRow | null> {
  const regs = await allRegulators();
  return regs.find((r) => regulatorSlug(r) === slug.toLowerCase()) ?? null;
}

// ─── FAQ builders (data-driven, never fabricated) ───────────────────────────

export interface Faq {
  question: string;
  answer: string;
}

const REASON_LABELS: Record<string, string> = {
  manufacturing_issue: "manufacturing problems",
  supply_chain: "supply-chain disruption",
  demand_surge: "unexpected increases in demand",
  regulatory_action: "regulatory action",
  discontinuation: "product discontinuation",
  raw_material: "raw-material (API) supply problems",
  distribution: "distribution issues",
  other: "other reported causes",
  unknown: "causes not stated by the regulator",
};

export function reasonLabel(cat: string | null | undefined): string | null {
  if (!cat) return null;
  return REASON_LABELS[cat] ?? null;
}

/**
 * FAQs for a medicine page, derived strictly from the data we hold.
 * Questions with no data behind them are omitted, never invented.
 */
export function buildDrugFaqs(
  name: string,
  active: PseoShortageEvent[],
  countryNames: string[],
  alternativesCount: number,
): Faq[] {
  const faqs: Faq[] = [];

  if (active.length > 0) {
    const listed = countryNames.slice(0, 6).join(", ");
    faqs.push({
      question: `Is ${name} currently in shortage?`,
      answer: `Yes. As of the latest regulator updates, ${name} has ${active.length} active shortage ${
        active.length === 1 ? "notice" : "notices"
      } across ${countryNames.length} ${countryNames.length === 1 ? "country" : "countries"} (${listed}${
        countryNames.length > 6 ? " and more" : ""
      }). Status is refreshed daily from official regulatory sources.`,
    });

    const reasons = Array.from(
      new Set(active.map((e) => reasonLabel(e.reason_category)).filter(Boolean)),
    ) as string[];
    if (reasons.length > 0) {
      faqs.push({
        question: `Why is ${name} in shortage?`,
        answer: `Regulators attribute the current ${name} shortages to ${reasons.slice(0, 3).join(", ")}. The exact cause varies by country and product — each notice on this page links to the official source.`,
      });
    }

    const resolutions = active
      .map((e) => e.estimated_resolution_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    if (resolutions.length > 0) {
      faqs.push({
        question: `When will the ${name} shortage be resolved?`,
        answer: `Regulator-estimated resolution dates currently range from ${fmtDate(resolutions[0])} to ${fmtDate(
          resolutions[resolutions.length - 1],
        )}, depending on country and product. These estimates come from the manufacturers via regulators and often change — check the per-country table above for the latest.`,
      });
    }
  } else {
    faqs.push({
      question: `Is ${name} currently in shortage?`,
      answer: `No active shortage of ${name} is currently reported by any of the national medicines regulators Mederti tracks. Shortages can emerge quickly — this page updates daily from official sources.`,
    });
  }

  if (alternativesCount > 0) {
    faqs.push({
      question: `What are the alternatives to ${name}?`,
      answer: `Mederti lists ${alternativesCount} clinically related ${
        alternativesCount === 1 ? "alternative" : "alternatives"
      } for ${name} (see the alternatives section above). Alternatives require clinical judgement — always confirm suitability with a pharmacist or prescriber and your national guidance before substituting.`,
    });
  }

  faqs.push({
    question: `Where does this ${name} shortage data come from?`,
    answer: `Every shortage notice on this page is scraped daily from an official national medicines regulator (such as the FDA, TGA, MHRA or EMA) and linked back to its source. Mederti aggregates 40+ regulators across 50+ countries and never publishes unsourced shortage claims.`,
  });

  return faqs;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
