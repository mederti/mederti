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
import { unstable_cache } from "next/cache";
import { COVERAGE_COPY } from "@/lib/coverage-copy";

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
  //    slugify() also drops leading/trailing punctuation ("Rabipur,",
  //    "Acetylcysteine(600Mg)"), so the pattern must be open at the ends or
  //    those sitemap URLs render "Medicine not found". The trailing-only
  //    pattern goes first so a common name can't be crowded out of the limit.
  if (candidates.length === 0) {
    const pattern = clean.replace(/-/g, "%");
    for (const p of [`${pattern}%`, `%${pattern}%`]) {
      const fuzzy = await admin
        .from("drugs")
        .select(DRUG_COLS)
        .ilike("generic_name_normalised", p)
        .limit(50);
      candidates = ((fuzzy.data ?? []) as unknown as PseoDrug[])
        .filter((d) => slugify(d.generic_name) === clean);
      if (candidates.length > 0) break;
    }
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
  atc_match_level: number | null;
  drugs: { generic_name: string; brand_names: string[] | null; atc_code: string | null } | null;
}

export async function alternativesForDrug(drugId: string): Promise<AlternativeRow[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("drug_alternatives")
    .select(
      "alternative_drug_id, relationship_type, atc_match_level, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names, atc_code)",
    )
    .eq("drug_id", drugId)
    .eq("is_approved", true)
    .order("atc_match_level", { ascending: false })
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
  // Same class = shared ATC level 4 (first 5 characters, e.g. N02BE), not
  // level 3 (N02B), which grouped Paracetamol with Gabapentin.
  if (drug.atc_code && drug.atc_code.length >= 5) {
    q = q.ilike("atc_code", `${drug.atc_code.slice(0, 5)}%`).neq("atc_code", drug.atc_code);
  } else if (drug.drug_class) {
    q = q.eq("drug_class", drug.drug_class);
  } else {
    return [];
  }
  const { data } = await q;
  return data ?? [];
}

// ─── Medicine × country ─────────────────────────────────────────────────────

export interface PseoEventDetail extends PseoShortageEvent {
  data_source_id: string | null;
  anticipated_start_date: string | null;
  availability_status: string | null;
  raw_data: Record<string, unknown> | null;
}

// raw_data is heavy; only the per-country page (≤ a few hundred rows for one
// drug in one market) selects it, and it is reduced to a product label
// server-side before anything reaches a client component.
const EVENT_DETAIL_COLS = `${EVENT_COLS}, data_source_id, anticipated_start_date, availability_status, raw_data`;

/** Every real notice for one drug in one country, newest first. */
export async function eventsForDrugInCountry(
  drugId: string,
  countryCode: string,
): Promise<PseoEventDetail[]> {
  const admin = getSupabaseAdmin();
  const { data } = await realEventsFilter(
    admin
      .from("shortage_events")
      .select(EVENT_DETAIL_COLS)
      .eq("drug_id", drugId)
      .eq("country_code", countryCode.toUpperCase()),
  )
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(500);
  return (data ?? []) as unknown as PseoEventDetail[];
}

/**
 * The country-specific view is indexable only when the medicine itself passes
 * the index gate AND the country has at least one open (active/anticipated)
 * notice for it. Mirrors openCountryMedicinePairs(), which feeds the sitemap —
 * keep the two rules identical.
 */
export function isIndexableCountryView(
  drug: Pick<PseoDrug, "generic_name" | "rxcui" | "atc_code">,
  totalEventCount: number,
  openInCountry: number,
): boolean {
  return openInCountry > 0 && isIndexableDrug(drug, totalEventCount);
}

export interface TrackedCountry {
  /** Most recent last_verified_at across this country's shortage feeds. */
  latestVerified: string | null;
  sources: Array<{ name: string; abbreviation: string | null }>;
}

/**
 * Countries where Mederti actually holds shortage data — at least one real
 * notice from one of the country's regulator feeds — keyed by ISO-2 code
 * (plus "EU" for the EMA bloc feed). This is what separates "no shortage on
 * record" from "data unavailable": a data_sources row alone is not coverage
 * (12 'covered' countries had never written a row, 2026-11-09).
 * Throws on any probe error so a transient failure is never cached.
 */
async function computeTrackedCountries(): Promise<Record<string, TrackedCountry>> {
  const admin = getSupabaseAdmin();
  const { data: sources, error } = await admin
    .from("data_sources")
    .select("id, name, abbreviation, country_code");
  if (error || !sources) throw new Error(`data_sources lookup failed: ${error?.message ?? "no data"}`);

  const out: Record<string, TrackedCountry> = {};
  for (let i = 0; i < sources.length; i += 10) {
    const batch = sources.slice(i, i + 10);
    const probes = await Promise.all(
      batch.map((s) =>
        realEventsFilter(
          admin
            .from("shortage_events")
            .select("last_verified_at")
            .eq("data_source_id", s.id),
        )
          .order("last_verified_at", { ascending: false, nullsFirst: false })
          .limit(1),
      ),
    );
    probes.forEach((p, j) => {
      const src = batch[j] as { name: string; abbreviation: string | null; country_code: string | null };
      if (p.error) throw new Error(`coverage probe failed for ${src.name}: ${p.error.message}`);
      const row = (p.data ?? [])[0] as { last_verified_at: string | null } | undefined;
      const code = (src.country_code ?? "").toUpperCase();
      if (!row || !code || code === "ZZ") return;
      const entry = (out[code] ??= { latestVerified: null, sources: [] });
      entry.sources.push({ name: src.name, abbreviation: src.abbreviation });
      if (row.last_verified_at && (!entry.latestVerified || row.last_verified_at > entry.latestVerified)) {
        entry.latestVerified = row.last_verified_at;
      }
    });
  }
  return out;
}

const cachedTrackedCountries = unstable_cache(computeTrackedCountries, ["pseo-tracked-countries-v1"], {
  revalidate: 21600,
});

/** null on failure — callers must then avoid any "no shortage" claim. */
export async function trackedCountries(): Promise<Record<string, TrackedCountry> | null> {
  try {
    return await cachedTrackedCountries();
  } catch (err) {
    console.warn("trackedCountries failed:", err);
    return null;
  }
}

export interface CountryMedicinePair {
  slug: string;
  countryCode: string;
  lastModified: string | null;
}

/**
 * Every (medicine, country) pair with an open notice whose medicine passes
 * the slug/identity part of the index gate — the sitemap's source for
 * /medicine/[slug]/[country]. Paged (PostgREST caps at 1,000 rows) and cached
 * 6h because it walks every open notice.
 */
async function computeOpenCountryMedicinePairs(): Promise<CountryMedicinePair[]> {
  const admin = getSupabaseAdmin();
  const pairs = new Map<string, CountryMedicinePair>();
  const page = (from: number) =>
    realEventsFilter(
      admin
        .from("shortage_events")
        .select("id, country_code, last_verified_at, drugs!inner(generic_name, rxcui, atc_code)")
        .in("status", ["active", "anticipated"])
        .not("drug_id", "is", null)
        .not("country_code", "is", null),
    )
      .or("rxcui.not.is.null,atc_code.not.is.null", { referencedTable: "drugs" })
      .order("id")
      .range(from, from + 999);
  // ~18k qualifying open notices (2026-11-11) ≈ 19 pages at ~1s each, so
  // fetch 5 pages at a time; stop at the first short page.
  let done = false;
  for (let base = 0; base < 100000 && !done; base += 5000) {
    const results = await Promise.all([0, 1, 2, 3, 4].map((k) => page(base + k * 1000)));
    for (const { data, error } of results) {
      if (error) throw new Error(`open pair scan failed: ${error.message}`);
      const rows = (data ?? []) as unknown as Array<{
        country_code: string;
        last_verified_at: string | null;
        drugs: { generic_name: string } | null;
      }>;
      for (const r of rows) {
        if (!r.drugs) continue;
        const slug = slugify(r.drugs.generic_name);
        if (!slug || !isQualityDrugSlug(slug)) continue;
        const code = r.country_code.toUpperCase();
        const key = `${slug}|${code}`;
        const prev = pairs.get(key);
        if (!prev) {
          pairs.set(key, { slug, countryCode: code, lastModified: r.last_verified_at });
        } else if (r.last_verified_at && (!prev.lastModified || r.last_verified_at > prev.lastModified)) {
          prev.lastModified = r.last_verified_at;
        }
      }
      if (rows.length < 1000) done = true;
    }
  }
  return [...pairs.values()];
}

const cachedOpenPairs = unstable_cache(computeOpenCountryMedicinePairs, ["pseo-open-country-pairs-v1"], {
  revalidate: 21600,
});

export async function openCountryMedicinePairs(): Promise<CountryMedicinePair[] | null> {
  try {
    return await cachedOpenPairs();
  } catch (err) {
    console.warn("openCountryMedicinePairs failed:", err);
    return null;
  }
}

// ─── Status vocabulary (one place; rendered on every public medicine page) ──

export const STATUS_DEFINITIONS: Array<{ term: string; definition: string }> = [
  {
    term: "Active shortage",
    definition:
      "A national regulator currently lists the notice as an ongoing shortage or supply disruption for at least one product (strength, form or pack) of the medicine.",
  },
  {
    term: "Anticipated shortage",
    definition:
      "The regulator or manufacturer has announced a shortage that has not started yet, or is expected. Not a Mederti prediction.",
  },
  {
    term: "Resolved",
    definition:
      "The regulator has closed the notice or removed it from its shortage list. This does not confirm that every product is back in stock.",
  },
  {
    term: "No shortage notice on record",
    definition:
      "Mederti receives data from this country's regulator but holds no notice linked to this medicine record. Some regulators file notices under a salt or local-language name (for example \"amoxicillin trihydrate\" or \"amoxicillinum\") that may be held as a separate record, so check the country's register. Never confirmation of supply at any pharmacy or wholesaler.",
  },
  {
    term: "Data unavailable",
    definition:
      "Mederti has no shortage data source for this country, so its status is unknown.",
  },
];

// ─── Country data ───────────────────────────────────────────────────────────

export interface CountrySummary {
  active: number | null;
  anticipated: number | null;
  critical: number | null;
  /**
   * Distinct canonical medicines behind the active notices. Regulators list
   * each strength/pack separately, so `active` counts notices and runs well
   * above official per-medicine tallies; this is the comparable figure.
   * null when it couldn't be computed (or the country is too large to page).
   */
  activeMedicines: number | null;
  recent: PseoShortageEventWithDrug[];
  /**
   * Regulator-announced future shortages: anticipated or active notices whose
   * start date is still ahead. Facts published by the regulator — not
   * a Mederti forecast. Soonest first.
   */
  upcoming: PseoShortageEventWithDrug[];
  /** Total behind `upcoming` (uncapped): anticipated + active notices with start_date > today. */
  upcomingTotal: number | null;
  /** Active notices with a regulator-estimated resolution date, soonest first. */
  resolving: PseoShortageEventWithDrug[];
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

  // Distinct drug_id across active notices. PostgREST aggregates are disabled,
  // so page the column (1,000-row cap per request); bail out past 20k rows
  // rather than hammer the DB for a figure that's only context.
  const distinctActiveMedicines = async (): Promise<number | null> => {
    try {
      const ids = new Set<string>();
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await realEventsFilter(
          admin
            .from("shortage_events")
            .select("drug_id")
            .eq("country_code", code)
            .eq("status", "active")
            .not("drug_id", "is", null),
        )
          .order("id")
          .range(from, from + 999);
        if (error || !data) return null;
        for (const r of data as { drug_id: string }[]) ids.add(r.drug_id);
        if (data.length < 1000) return ids.size;
      }
      return null;
    } catch {
      return null;
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  const [active, anticipated, critical, activeMedicines, recentRes] = await Promise.all([
    countWhere({ status: "active" }),
    countWhere({ status: "anticipated" }),
    countWhere({ status: "active", severity: "critical" }),
    distinctActiveMedicines(),
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
        .in("status", ["active", "anticipated"])
        // "Latest notices" sorts by start_date desc, so forward-dated notices
        // (TGA discontinuations effective 2027) would otherwise pin the top
        // of the table with dates that haven't happened yet.
        .lte("start_date", today),
    )
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(50),
  ]);

  const [anticipatedRes, futureActiveRes, resolvingRes] = await Promise.all([
    realEventsFilter(
      admin
        .from("shortage_events")
        .select(`drug_id, drugs(generic_name), ${EVENT_COLS}`)
        .eq("country_code", code)
        .eq("status", "anticipated")
        .not("drug_id", "is", null)
        // Only notices still ahead of us: an "anticipated" row whose start date
        // has passed is stale, not upcoming.
        .gt("start_date", today),
    )
      .order("start_date", { ascending: true })
      .limit(50),
    realEventsFilter(
      admin
        .from("shortage_events")
        .select(`drug_id, drugs(generic_name), ${EVENT_COLS}`)
        .eq("country_code", code)
        .eq("status", "active")
        .not("drug_id", "is", null)
        .gt("start_date", today),
    )
      .order("start_date", { ascending: true })
      .limit(50),
    realEventsFilter(
      admin
        .from("shortage_events")
        .select(`drug_id, drugs(generic_name), ${EVENT_COLS}`)
        .eq("country_code", code)
        .eq("status", "active")
        .not("drug_id", "is", null)
        .gte("estimated_resolution_date", today),
    )
      .order("estimated_resolution_date", { ascending: true })
      .limit(50),
  ]);

  const countFuture = async (status: string): Promise<number | null> => {
    try {
      const { count, error } = await realEventsFilter(
        admin
          .from("shortage_events")
          .select("id", { count: "exact", head: true })
          .eq("country_code", code)
          .eq("status", status)
          .not("drug_id", "is", null)
          .gt("start_date", today),
      );
      return error ? null : count;
    } catch {
      return null;
    }
  };
  const [futureAnticipated, futureActive] = await Promise.all([
    countFuture("anticipated"),
    countFuture("active"),
  ]);
  const upcomingTotal =
    futureAnticipated === null || futureActive === null ? null : futureAnticipated + futureActive;

  const rows = (r: unknown) =>
    ((r as { data: unknown[] | null }).data ?? []) as unknown as PseoShortageEventWithDrug[];

  return {
    active,
    anticipated,
    critical,
    activeMedicines,
    recent: rows(recentRes),
    upcoming: [...rows(anticipatedRes), ...rows(futureActiveRes)]
      .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"))
      .slice(0, 50),
    upcomingTotal,
    resolving: rows(resolvingRes),
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
      answer: `No active shortage notice is currently linked to ${name} in Mederti's data from the national medicines regulators it tracks. Some regulators list notices under a salt or local-language name, so check the relevant country register too. Shortages can emerge quickly — this page updates daily from official sources.`,
    });
  }

  if (alternativesCount > 0) {
    faqs.push({
      question: `What are the alternatives to ${name}?`,
      answer: `Mederti lists ${alternativesCount} ${
        alternativesCount === 1 ? "drug" : "drugs"
      } in the same WHO ATC class as ${name} (see above). These are classification context only — not clinically reviewed substitutes. Always confirm any switch with a pharmacist or prescriber and your national guidance.`,
    });
  }

  faqs.push({
    question: `Where does this ${name} shortage data come from?`,
    answer: `Every shortage notice on this page is scraped daily from an official national medicines regulator (such as the FDA, TGA, MHRA or EMA) and linked back to its source. Mederti aggregates ${COVERAGE_COPY.regulators} across ${COVERAGE_COPY.countries} and never publishes unsourced shortage claims.`,
  });

  return faqs;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
