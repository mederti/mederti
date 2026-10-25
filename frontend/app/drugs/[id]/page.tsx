export const dynamic = "force-dynamic";

import { fetchSourcedAlternatives, type SourcedAlternativesResult } from "@/lib/alternatives-evidence";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canonicalUrl, siteUrl, pageTitle, pageDescription } from "@/lib/seo";
import { recordDemandSignal } from "@/lib/demand-signal";
import { FREE_VIEW_HEADER } from "@/lib/free-views";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import AppShell from "@/app/components/v1/AppShell";
import { cleanBrandNames } from "@/lib/brand";
import { extractEventBrand } from "@/lib/event-brand";
import { buildSupplyInMarket, type CatalogueRow } from "@/lib/supply-in-market";
import { buildPriceComparison, type CompareResult, type PriceRow } from "@/lib/pricing-compare";
import V1DrugView, { type BrandFocus } from "./V1DrugView";

/** Tiny ISO-3166 → emoji-flag map for the country chips. */
const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦",
  SG: "🇸🇬", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪",
  CH: "🇨🇭", NO: "🇳🇴", SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰", NL: "🇳🇱",
  BE: "🇧🇪", AT: "🇦🇹", PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", JP: "🇯🇵",
  KR: "🇰🇷", IN: "🇮🇳", CN: "🇨🇳", BR: "🇧🇷", MX: "🇲🇽", ZA: "🇿🇦",
};
const flagFor = (cc: string): string => FLAG[cc?.toUpperCase()] ?? "🌐";

/** One market's headline price + (optional) live concession, for the drug page. */
export type MarketPrice = {
  country: string;
  label: string;          // human label for the headline price_type
  value: number | null;   // headline price (pack price preferred, else unit)
  per: string;            // "pack of 28" | "unit" | …
  currency: string;
  source: string | null;
  effective_date: string | null;
  concession: number | null;  // live concession price for this market, if any
};
export type ConcessionSignal = {
  country: string;
  price: number;
  tariff: number | null;
  currency: string;
  pack: string | null;
  effective_date: string;
  source: string;
};

const HEADLINE_PRIORITY = [
  "drug_tariff", "reimbursement", "retail_public", "pharmacy_purchase", "list",
  "wholesale", "ex_factory", "amp", "wac", "reference_price",
];
const PRICE_TYPE_LABEL: Record<string, string> = {
  drug_tariff: "Drug Tariff", reimbursement: "Reimbursement",
  retail_public: "Retail price", pharmacy_purchase: "Acquisition",
  list: "List price", wholesale: "Wholesale",
  ex_factory: "Ex-factory", amp: "AMP", wac: "WAC",
  reference_price: "Reference price", concession: "Concession",
};
// Concessions are granted month-by-month; treat one as "live" only if its
// effective month is recent (covers the current + prior month given scrape lag).
const CONCESSION_ACTIVE_MS = 75 * 86400000;

/** Normalised strength token from a product label ("...60mg tablets" → "60mg"),
 *  used to compare a concession only against a same-strength tariff. */
function strengthOf(label: string | null | undefined): string | null {
  const m = (label ?? "").match(/(\d+(?:\.\d+)?)\s?(mg|mcg|microgram|micrograms|g|ml|%|units?|iu)/i);
  return m ? `${m[1]}${m[2]}`.toLowerCase().replace("micrograms", "mcg").replace("microgram", "mcg") : null;
}

/**
 * Reads drug_pricing_history for this molecule and produces (a) one headline
 * price per market and (b) an active-concession signal for the user's market.
 * Pure-additive + defensive: any error → empty, the card simply omits prices.
 */
async function buildMarketPricing(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  drugId: string,
  genericName: string | null | undefined,
  userCountry: string,
): Promise<{ concession: ConcessionSignal | null; priceMarkets: MarketPrice[] }> {
  const inn = (genericName ?? "").trim();
  // Only use the generic_name fallback when the INN is filter-safe (no
  // PostgREST metacharacters) so we never break the whole query.
  const innSafe = inn && /^[a-z0-9 .\-/]+$/i.test(inn) ? inn : "";

  // Two-step fetch (NOT a single or() filter): once drug_pricing_history got
  // large (post NADAC backfill, ~500k US rows) the or(drug_id, generic_name
  // ilike) shape can't use any index and dies on the statement timeout —
  // which supabase-js reports as a soft `error`, not a throw, so the panel
  // silently vanished. Query by indexed drug_id first; only when it finds
  // nothing, best-effort the name fallback (unlinked-variant case), tolerating
  // a timeout as empty. Migration 067 (trigram idx) makes the fallback fast.
  const PRICE_COLS = "country, price_type, category, pack_price, unit_price, currency, pack_description, product_name, effective_date, source";
  let rows: any[] = [];
  {
    const { data, error } = await supabase
      .from("drug_pricing_history")
      .select(PRICE_COLS)
      .eq("drug_id", drugId)
      .order("effective_date", { ascending: false, nullsFirst: false })
      .limit(400);
    if (error) return { concession: null, priceMarkets: [] };
    rows = data ?? [];
  }
  if (rows.length === 0 && innSafe) {
    const { data } = await supabase
      .from("drug_pricing_history")
      .select(PRICE_COLS)
      .ilike("generic_name", innSafe)
      .order("effective_date", { ascending: false, nullsFirst: false })
      .limit(400);
    rows = data ?? []; // timeout here → just no fallback rows
  }
  if (rows.length === 0) return { concession: null, priceMarkets: [] };

  // Latest row per (country, price_type) — rows are already date-desc.
  const latest = new Map<string, any>();
  for (const r of rows) {
    if (!r.country || !r.price_type) continue;
    const k = `${r.country}|${r.price_type}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const val = (r: any): number | null =>
    r?.pack_price != null ? Number(r.pack_price) : r?.unit_price != null ? Number(r.unit_price) : null;

  const countries = Array.from(new Set(rows.map((r) => r.country).filter(Boolean)));
  const priceMarkets: MarketPrice[] = [];
  for (const country of countries) {
    const headline = HEADLINE_PRIORITY.map((t) => latest.get(`${country}|${t}`)).find(Boolean);
    const conc = latest.get(`${country}|concession`);
    const base = headline ?? conc;
    if (!base) continue;
    priceMarkets.push({
      country,
      label: PRICE_TYPE_LABEL[base.price_type] ?? base.price_type,
      value: val(base),
      per: base.pack_price != null ? (base.pack_description ?? "pack") : "unit",
      currency: base.currency ?? "",
      source: base.source ?? null,
      effective_date: base.effective_date ?? null,
      concession: conc ? val(conc) : null,
    });
  }
  // User's market first, then by (concession-active, has-value).
  priceMarkets.sort((a, b) =>
    (a.country === userCountry ? -1 : b.country === userCountry ? 1 : 0) ||
    (b.concession != null ? 1 : 0) - (a.concession != null ? 1 : 0),
  );

  // Active-concession signal for the user's market. Two honesty guards on the
  // molecule-level rollup: (1) the baseline is the true Drug Tariff = Cat M
  // (quarterly reimbursement), NOT the VIIIA in-month amendments which are
  // announcement-derived and often equal the concession; (2) compare only
  // SAME-STRENGTH rows. No genuine same-strength Cat M baseline → no % delta.
  const concRow = latest.get(`${userCountry}|concession`);
  let concession: ConcessionSignal | null = null;
  if (concRow && concRow.effective_date) {
    const ageMs = Date.now() - new Date(concRow.effective_date).getTime();
    if (!Number.isNaN(ageMs) && ageMs < CONCESSION_ACTIVE_MS) {
      const concStrength = strengthOf(concRow.product_name);
      const concVal = val(concRow);
      const catM = concStrength
        ? rows.find(
            (r) => r.country === userCountry && r.price_type === "drug_tariff" &&
              (r.category ?? "").toLowerCase().includes("cat m") &&
              strengthOf(r.product_name) === concStrength && val(r) != null,
          )
        : null;
      const baseline = catM ? val(catM) : null;
      const showDelta = baseline != null && concVal != null && concVal > baseline;
      concession = {
        country: userCountry,
        price: concVal ?? 0,
        tariff: showDelta ? baseline : null,
        currency: concRow.currency ?? "GBP",
        pack: [concStrength, concRow.pack_description ? `×${concRow.pack_description}` : null].filter(Boolean).join(" ") || null,
        effective_date: concRow.effective_date,
        source: concRow.source ?? "DHSC",
      };
      // User-market tiles, like-for-like. With a real Cat M baseline → tariff +
      // concession side by side; otherwise show the concession price alone
      // (never an arbitrary-strength or amendment "tariff").
      const m = priceMarkets.find((p) => p.country === userCountry);
      if (m) {
        // The concession is the freshest, most decision-relevant fact → its
        // date/source head the panel regardless of which tiles we show.
        m.effective_date = concRow.effective_date;
        m.source = concRow.source ?? m.source;
        if (showDelta) {
          m.value = baseline; m.label = "Drug Tariff (Cat M)";
          m.per = catM!.pack_description ?? m.per; m.concession = concVal;
        } else {
          m.value = concVal; m.label = "Concession";
          m.per = concRow.pack_description ?? m.per; m.concession = null;
        }
      }
    }
  }
  return { concession, priceMarkets };
}

/**
 * Cost-vs-alternatives comparison for the user's market. Fetches per-drug
 * pricing for the current molecule + its alternatives from drug_pricing_history
 * and delegates the like-for-like banding to buildPriceComparison. Defensive:
 * any error → null and the section is simply omitted.
 */
async function buildAlternativePricingData(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  drugId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alternatives: any[],
  userCountry: string,
  genericName: string | null | undefined,
): Promise<CompareResult | null> {
  const altMeta = new Map<string, { name: string; relationship: string | null }>();
  for (const a of alternatives) {
    const altId = a.alternative_drug_id;
    if (!altId || altMeta.has(altId)) continue;
    altMeta.set(altId, {
      name: a.drugs?.generic_name ?? "Therapeutic alternative",
      relationship: a.relationship_type ?? null,
    });
  }
  altMeta.set(drugId, { name: genericName ?? "This medicine", relationship: null });
  const ids = [...altMeta.keys()];
  if (ids.length < 2) return null; // need the anchor + at least one alternative

  let rows: PriceRow[] = [];
  try {
    const { data } = await supabase
      .from("drug_pricing_history")
      .select("drug_id, price_type, currency, pack_price, unit_price, pack_description, product_name, effective_date, source")
      .in("drug_id", ids)
      .eq("country", userCountry)
      .order("effective_date", { ascending: false, nullsFirst: false })
      .limit(600);
    rows = (data ?? []) as PriceRow[];
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const rowsByDrug = new Map<string, PriceRow[]>();
  for (const r of rows) {
    const k = r.drug_id ?? "";
    if (!k) continue;
    (rowsByDrug.get(k) ?? rowsByDrug.set(k, []).get(k)!).push(r);
  }
  return buildPriceComparison(drugId, rowsByDrug, altMeta, HEADLINE_PRIORITY, PRICE_TYPE_LABEL);
}

type CatBrandRow = {
  id: string; brand_name: string | null; source_country: string | null; source_name: string | null;
  registration_number: string | null; registration_status: string | null; sponsor: string | null;
};

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    // brand=1 keeps a linked catalogue brand page from redirecting to its
    // molecule, so it renders as a brand-distinct SKU view.
    brand?: string;
    // brand_hint=<catalogueId> is set by /search when a brand query rolled up
    // to this molecule; drives the "you searched X" provenance banner.
    brand_hint?: string;
    // brand_focus=<catalogueId> opens the molecule page scoped to one brand:
    // the brand's registrations + the regulator notices that name it, inside
    // the same V1 drug template (brand chips link here).
    brand_focus?: string;
  }>;
}

/* ── SEO: dynamic metadata ── */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
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
      .select("generic_name, brand_name, drug_id")
      .eq("id", id)
      .single();
    // Brand SKU view (?brand=1 on a molecule-linked catalogue row): lead the
    // title with the brand, canonicalise to the parent molecule so we never
    // fragment crawl equity across brand variants, and noindex it (a logged-in
    // sourcing surface, not a search-landing page).
    const brandMode = sp.brand === "1" && !!cat?.drug_id;
    const name = (brandMode && cat?.brand_name) ? cat.brand_name : (cat?.generic_name ?? "Drug");
    return {
      title: pageTitle({ generic_name: name }),
      description: pageDescription({ generic_name: name }, [], 20),
      alternates: { canonical: brandMode ? canonicalUrl(`/drugs/${cat!.drug_id}`) : canonicalUrl(`/drugs/${id}`) },
      robots: brandMode ? { index: false, follow: true } : { index: true, follow: true },
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

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", EU: "EU",
  NZ: "New Zealand", SG: "Singapore", IE: "Ireland", NO: "Norway",
  FI: "Finland", CH: "Switzerland", SE: "Sweden", AT: "Austria",
  BE: "Belgium", NL: "Netherlands", JP: "Japan",
};

export default async function DrugPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};

  // Session lookup is best-effort — never block the page on it.
  let loggedIn = false;
  let userId: string | null = null;
  try {
    const { createServerClient } = await import("@/lib/supabase/server");
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    loggedIn = !!user;
    userId = user?.id ?? null;
  } catch { /* anonymous */ }
  const supabase = getSupabaseAdmin();

  /* ── Parallel data fetching ── */
  const [drugRes, shortagesRes, logRes, alternativesRes, recallsRes] =
    await Promise.allSettled([
      supabase.from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class, dosage_forms, strengths, routes_of_administration, therapeutic_category, is_controlled_substance, who_essential_medicine, who_eml_section, who_eml_year")
        .eq("id", id).single(),
      supabase.from("shortage_events")
        .select("shortage_id, id, drug_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, updated_at, created_at, notes, raw_data, data_source_id, data_sources(name, abbreviation, country_code)")
        .eq("drug_id", id).order("updated_at", { ascending: false }),
      supabase.from("shortage_status_log")
        .select("id, shortage_event_id, drug_id, old_status, new_status, old_severity, new_severity, changed_at")
        .eq("drug_id", id).order("changed_at", { ascending: false }),
      supabase.from("drug_alternatives")
        // ATC-class pairing only. Evidence grade, dose notes and availability
        // note are template/lookup values, not evidence — never selected.
        .select("alternative_drug_id, relationship_type, similarity_score, atc_match_level, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)")
        .eq("drug_id", id).eq("is_approved", true).order("atc_match_level", { ascending: false }),
      supabase.from("recalls")
        .select("id, recall_id, country_code, recall_class, generic_name, brand_name, manufacturer, announced_date, status, reason_category, press_release_url")
        .eq("drug_id", id).order("announced_date", { ascending: false }),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drug = drugRes.status === "fulfilled" ? (drugRes.value as any).data : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortagesRaw = shortagesRes.status === "fulfilled" ? ((shortagesRes.value as any).data ?? []) : [];
  // Per-event product identity (brand/sponsor) from the regulator record —
  // extracted here so heavy raw_data never reaches the client components.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortages = shortagesRaw.map(({ raw_data, ...ev }: any) => ({
    ...ev,
    ...extractEventBrand(ev.data_source_id ?? null, raw_data),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusLog = logRes.status === "fulfilled" ? ((logRes.value as any).data ?? []) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alternativesRaw = alternativesRes.status === "fulfilled" ? ((alternativesRes.value as any).data ?? []) : [];
  // Live shortage status for each same-class drug (any market). "No shortage
  // listed" is all we can truthfully say — it is not proof of stock.
  const altIds = alternativesRaw.map((a: any) => a.alternative_drug_id).filter(Boolean);
  const altShortageCounts = new Map<string, number>();
  if (altIds.length > 0) {
    const { data: altSh } = await supabase.from("shortage_events").select("drug_id").in("drug_id", altIds).eq("status", "active");
    for (const r of altSh ?? []) altShortageCounts.set(r.drug_id, (altShortageCounts.get(r.drug_id) ?? 0) + 1);
  }
  // Source-backed alternatives (migration 071). A failure here must not take
  // the page down, and must never render as "none" — the section hides.
  const sourcedAlternatives: SourcedAlternativesResult = await fetchSourcedAlternatives(id)
    .catch((e) => ({ available: false as const, reason: String(e?.message ?? e) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alternatives = alternativesRaw.map((a: any) => ({ ...a, active_shortage_count: altShortageCounts.get(a.alternative_drug_id) ?? 0 }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recalls = recallsRes.status === "fulfilled" ? ((recallsRes.value as any).data ?? []) : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let products: any[] = [];
  if (drug) {
    // Demand-signal instrumentation — the actual product-page view. Previously
    // only chat previews (/api/drug/[id]) recorded drug_view; the server-
    // rendered page read Supabase directly and never logged a view. Fire-and-
    // forget; identifier = user_id when signed in, else client IP (both hashed
    // downstream). country_code left null — the page doesn't reliably know the
    // user's home market server-side, and reading profile.countries here risks
    // the migration-025 drift that would break persona resolution.
    const fwd = (await headers()).get("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0]?.trim() || null;
    recordDemandSignal({
      signal_type: "drug_view",
      drug_id: drug.id,
      identifier: userId ?? ip,
    });

    const { data: prodData } = await supabase
      .from("drug_products")
      .select("id, registry_id, product_name, trade_name, strength, dosage_form, route, country, registry_status, sponsors(name)")
      .ilike("product_name", `%${drug.generic_name}%`)
      .limit(30);
    products = prodData ?? [];
  }

  /* ── Catalogue fallback for drugs not in drugs table ── */
  if (!drug) {
    const { data: catEntry } = await supabase
      .from("drug_catalogue")
      .select("id, drug_id, generic_name, brand_name, strength, dosage_form, route, source_name, source_country, registration_number, registration_status, sponsor")
      .eq("id", id)
      .single();

    if (!catEntry) {
      // Closes audit FINDING-UX-10: previously returned a 200 with HTML
      // saying "Drug not found", which Google would index as a real page.
      // notFound() throws past the layout and serves Next's actual 404.
      notFound();
    }

    // A catalogue product linked to a canonical molecule (drug_id, populated by
    // backend/importers/catalogue_inn_backfill) must NOT render its own thin
    // registration page — that fragments the experience and duplicates the
    // molecule. Bounce to the canonical drug page, which carries the real
    // shortage / alternative / pricing data. Search promotes these rows already,
    // so this catches direct / stale links. Permanent (308) so it's cached and
    // consolidates link equity if drug pages are ever exposed to crawlers (today
    // /drugs/* is login-gated in middleware, so this fires for signed-in users).
    // The self-guard avoids a loop if a row's drug_id were ever set to its own id.
    // ?brand=1 is the explicit escape hatch: a sourcing user wants THIS brand as
    // a distinct SKU (e.g. Fresofol, not Propofol), so skip the rollup redirect
    // and render the brand page below with a breadcrumb back to the molecule.
    // ?brand=1 (legacy brand-chip / search link) now opens the molecule page in
    // brand-focus mode, so a brand never drops the user into a different
    // template. Temporary redirect: the target carries per-user context.
    if (catEntry.drug_id && catEntry.drug_id !== id) {
      if (sp.brand === "1") redirect(`/drugs/${catEntry.drug_id}?brand_focus=${id}`);
      permanentRedirect(`/drugs/${catEntry.drug_id}`);
    }

    /* Registration-only page for catalogue rows not yet linked to a molecule.
       Deliberately makes NO supply claim: an unlinked row has no shortage
       events attached, which is absence of data — not evidence of supply. */
    const catCountry = (catEntry.source_country ?? "").toUpperCase();
    const catCountryName = COUNTRY_NAMES[catCountry] ?? catCountry;
    const catTitle = catEntry.brand_name ?? catEntry.generic_name;
    const catBody = (
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 48px" }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", margin: 0 }}>
            {catTitle}
            {catEntry.strength && <span style={{ fontWeight: 400, color: "var(--app-text-3)", fontSize: 18, marginLeft: 8 }}>{catEntry.strength}</span>}
          </h1>
          {catEntry.brand_name && catEntry.generic_name && catEntry.brand_name !== catEntry.generic_name && (
            <div style={{ fontSize: 13, color: "var(--app-text-3)", marginTop: 4 }}>{catEntry.generic_name}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {[catEntry.dosage_form, catEntry.route, catEntry.source_name].filter(Boolean).map((t) => (
              <span key={t as string} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 7, border: "1px solid var(--app-border)", color: "var(--app-text-3)" }}>{t}</span>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--app-bg-2)", border: "1px solid var(--app-border)", borderRadius: 14, padding: "18px 22px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--app-text-4)", marginBottom: 6 }}>
            {flagFor(catCountry)} {catCountryName} · Supply status
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--app-text)", marginBottom: 4 }}>Not yet linked to shortage data</div>
          <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.6 }}>
            This is a {catEntry.source_name} registration record. Mederti hasn&apos;t matched it to a molecule yet, so shortage
            notices for {catEntry.generic_name ?? "this ingredient"} are not shown here — check the ingredient before relying on supply.
          </div>
          {catEntry.generic_name && (
            <Link href={`/search?q=${encodeURIComponent(catEntry.generic_name)}`} style={{ display: "inline-block", marginTop: 10, fontSize: 13, color: "var(--teal-l)", textDecoration: "none", fontWeight: 600 }}>
              Check {catEntry.generic_name} shortages {"→"}
            </Link>
          )}
        </div>

        <div style={{ background: "var(--app-bg-2)", border: "1px solid var(--app-border)", borderRadius: 14, padding: "16px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-4)", marginBottom: 12 }}>
            Registration
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px 24px", fontSize: 13 }}>
            {catEntry.registration_number && (
              <div>
                <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Registration number</div>
                <div style={{ color: "var(--app-text)", fontFamily: "monospace", fontSize: 12 }}>{catEntry.registration_number}</div>
              </div>
            )}
            <div>
              <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Source</div>
              <div style={{ color: "var(--app-text)" }}>{catEntry.source_name} ({catCountry})</div>
            </div>
            {catEntry.sponsor && (
              <div>
                <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Sponsor</div>
                <div style={{ color: "var(--app-text)" }}>{catEntry.sponsor}</div>
              </div>
            )}
            {catEntry.registration_status && (
              <div>
                <div style={{ color: "var(--app-text-4)", fontSize: 11, marginBottom: 2 }}>Registration status</div>
                <div style={{ color: "var(--app-text)" }}>{catEntry.registration_status}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
    if (loggedIn) {
      return (
        <AppShell
          contentClassName="flush"
          chat={{
            contextKey: `cat:${id}`,
            title: catTitle,
            category: "Registration record",
            bodyText: `The user is viewing the ${catEntry.source_name} registration record for ${catTitle} (${catEntry.generic_name}) in ${catCountryName}. It is not linked to a Mederti molecule record, so look up ${catEntry.generic_name} shortages before answering about supply.`,
            headerLabel: "Ask about this medicine",
            starters: [
              `Is ${catEntry.generic_name} in shortage in ${catCountryName}?`,
              `What can I substitute for ${catEntry.generic_name}?`,
            ],
          }}
        >
          {catBody}
        </AppShell>
      );
    }
    return (
      <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
        <SiteNav />
        {catBody}
      </div>
    );
  }

  const cookieStore = await cookies();
  // Validate the cookie: a malformed/legacy value (e.g. 3 letters) flows into
  // the arbitrage API's destination param, fails its ^[A-Z]{2}$ check → 400,
  // and used to crash the whole drug page. Fall back to AU on anything invalid.
  const rawCountry = (cookieStore.get("mederti-country")?.value ?? "").toUpperCase();
  const userCountry = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : "AU";

  // Anonymous free-tier meter: the proxy reports how many of the free drug
  // views this visitor has used, counting this page (null = signed in).
  const usedHeader = (await headers()).get(FREE_VIEW_HEADER);
  const freeViewsUsed = !loggedIn && usedHeader != null ? Number(usedHeader) || 0 : null;

  // API supply-base concentration from FDA Drug Master Files (active Type II
  // DMFs = manufacturers cleared to supply this API into the US market). This
  // is the primary-source manufacturing-concentration signal — the headline
  // feature of the Johns Hopkins supply-chain dashboard, sourced directly.
  const inn = (drug.generic_name ?? "").toLowerCase();
  // These five reads are mutually independent — fetch them concurrently so the
  // page waits on the slowest one, not the sum. (Was a 5-deep await waterfall:
  // api_suppliers → drug_approvals → regulatory_eligibility → drug_pricing →
  // buildMarketPricing, ~5 serial round-trips before first paint.) supabase-js
  // resolves (not rejects) on a query error, so a missing table still soft-fails
  // to null without taking down the batch.
  const [apiSupplierRes, approvalRes, eligRes, priceRes, marketPricing, altPricing, profileRes] = await Promise.all([
    supabase
      .from("api_suppliers")
      .select("manufacturer_name, country, source, who_pq")
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .limit(300),
    supabase
      .from("drug_approvals")
      .select("authority, application_type, approval_date, brand_name")
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .order("approval_date", { ascending: false })
      .limit(200),
    supabase
      .from("regulatory_eligibility")
      .select(
        "scheme, status, scheme_reference, description, brand_name, listed_at, expires_at, source_url, source_name, country_code",
      )
      .or(`drug_id.eq.${id},generic_name.ilike.${inn}`)
      .eq("status", "active")
      .limit(50),
    supabase
      .from("drug_pricing")
      .select("price_amount, dispensed_amount, currency, pack_size, price_date, source")
      .eq("drug_id", id)
      .eq("country_code", userCountry)
      .order("price_date", { ascending: false, nullsFirst: false })
      .limit(1),
    buildMarketPricing(supabase, id, drug.generic_name, userCountry),
    buildAlternativePricingData(supabase, id, alternatives, userCountry, drug.generic_name),
    // Molecule-level supply profile (inn_risk_scores, nightly): same figures
    // as the National Shortage Dashboard, so the two pages agree.
    supabase
      .from("inn_risk_scores")
      .select("display_name, fragility, who_eml_list, eu_critical, n_api_makers, n_finished_firms, top_api_country, short_countries, drug_ids, geography:components->geography")
      .contains("drug_ids", [id])
      .limit(1),
  ]);
  const apiSupplierRows = apiSupplierRes.data;
  const approvalRows = approvalRes.data;
  const eligRows = eligRes.data;
  const priceRows = priceRes.data;
  const { concession, priceMarkets } = marketPricing;
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
  const prof = (profileRes.data?.[0] ?? null) as {
    display_name: string; fragility: number | null; who_eml_list: "core" | "complementary" | null;
    eu_critical: boolean; n_api_makers: number | null; n_finished_firms: number | null;
    top_api_country: string | null; short_countries: string[];
    geography: { countries?: Record<string, number> } | null;
  } | null;
  const profCountries = prof?.geography?.countries ?? null;
  const profTotal = profCountries ? Object.values(profCountries).reduce((a, b) => a + b, 0) : 0;
  const supplyProfile = prof
    ? {
        molecule: prof.display_name,
        fragility: prof.fragility == null ? null : Number(prof.fragility),
        whoList: prof.who_eml_list,
        euCritical: prof.eu_critical,
        nApiMakers: prof.n_api_makers,
        nFinishedFirms: prof.n_finished_firms,
        topApiCountry: prof.top_api_country,
        topApiShare: prof.top_api_country && profTotal ? (profCountries![prof.top_api_country] ?? 0) / profTotal : null,
        shortCountries: prof.short_countries,
      }
    : null;
  // Supply in the user's market — registered products × open notices
  // (lib/supply-in-market.ts). Notices are read for every drugs row of the
  // molecule (drug_ids from the nightly profile), not just this one, because
  // a market's notices often sit on a salt- or form-specific row.
  const moleculeIds: string[] = [...new Set([id, ...((profileRes.data?.[0] as { drug_ids?: string[] } | undefined)?.drug_ids ?? [])])];
  const [catRes, noticeRes] = await Promise.all([
    supabase
      .from("drug_catalogue")
      .select("brand_name, strength, dosage_form, sponsor, registration_number, active_ingredients")
      .in("drug_id", moleculeIds.slice(0, 150))
      .eq("source_country", userCountry)
      .eq("registration_status", "active")
      .limit(1000),
    supabase
      .from("shortage_events")
      .select("status, start_date, anticipated_start_date, estimated_resolution_date, source_url, data_source_id, artg:raw_data->>artg_numb, din:raw_data->>din, dose_form:raw_data->>dose_form, ca_form:raw_data->>dosage_form, ingredients:raw_data->>ingredients, raw_data")
      .in("drug_id", moleculeIds.slice(0, 150))
      .eq("country_code", userCountry)
      .in("status", ["active", "anticipated"])
      .or("synthetic.is.null,synthetic.eq.false")
      .limit(200),
  ]);
  const supplyInMarket = buildSupplyInMarket(
    userCountry,
    (catRes.data ?? []) as CatalogueRow[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((noticeRes.data ?? []) as any[]).map((n) => ({
      status: n.status,
      start_date: n.start_date,
      anticipated_start_date: n.anticipated_start_date,
      estimated_resolution_date: n.estimated_resolution_date,
      source_url: n.source_url,
      regNo: n.artg ?? n.din ?? null,
      productName: extractEventBrand(n.data_source_id ?? null, n.raw_data).brand_name,
      doseForm: n.dose_form ?? n.ca_form ?? null,
      ingredients: typeof n.ingredients === "string" ? n.ingredients.split(";").map((x: string) => x.trim()).filter(Boolean) : undefined,
    })),
  );

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
  // (Fetched above in the parallel batch.)
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
  // (Fetched above in the parallel batch.)
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
  // (Fetched above in the parallel batch.)
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

  // Official multi-market pricing from drug_pricing_history (NHS Drug Tariff,
  // CMS NADAC, …). Lights up GB/US prices the AU-only `pricing` above can't,
  // and surfaces an active price concession as an early supply-pressure
  // signal. Defensive: soft-errors to empty if the table isn't reachable.
  // (concession + priceMarkets fetched above in the parallel batch.)

  // ── Brand SKUs + search provenance ───────────────────────────────────
  // Brands are catalogue rows that roll up to this molecule. Surface them as
  // clickable chips (→ /drugs/{catId}?brand=1, the brand-distinct sourcing
  // view) and, when the user arrived from a brand search, a "you searched X"
  // hint. One light read; soft-fails to empty so the page never blocks on it.
  const brandSkus: { brand: string; catId: string; country: string }[] = [];
  let brandHint: { brand: string; country: string; catId: string } | null = null;
  let brandFocus: BrandFocus | null = null;
  {
    const { data: catBrands } = await supabase
      .from("drug_catalogue")
      .select("id, brand_name, source_country, source_name, registration_number, registration_status, sponsor")
      .eq("drug_id", id)
      .not("brand_name", "is", null)
      .limit(400);
    const catRows = (catBrands ?? []) as CatBrandRow[];
    // One SKU per cleaned brand; prefer the user-market registration for the
    // chip's link so the brand page opens on the SKU that matters to them.
    const bySku = new Map<string, { brand: string; catId: string; country: string }>();
    for (const r of catRows) {
      const clean = cleanBrandNames([r.brand_name ?? ""], drug.generic_name)[0];
      if (!clean) continue;
      const key = clean.toLowerCase();
      const country = (r.source_country ?? "").toUpperCase();
      const existing = bySku.get(key);
      if (!existing || (country === userCountry && existing.country !== userCountry)) {
        bySku.set(key, { brand: clean, catId: r.id, country });
      }
    }
    brandSkus.push(...bySku.values());

    const hintId = sp.brand_hint;
    if (hintId) {
      const fromList = brandSkus.find((b) => b.catId === hintId);
      if (fromList) {
        brandHint = { brand: fromList.brand, country: fromList.country, catId: fromList.catId };
      } else {
        const { data: hintRow } = await supabase
          .from("drug_catalogue")
          .select("id, brand_name, source_country")
          .eq("id", hintId)
          .single();
        const hr = hintRow as { id: string; brand_name: string | null; source_country: string | null } | null;
        const clean = hr ? (cleanBrandNames([hr.brand_name ?? ""], drug.generic_name)[0] ?? hr.brand_name) : null;
        if (hr && clean) brandHint = { brand: clean, country: (hr.source_country ?? "").toUpperCase(), catId: hr.id };
      }
    }

    // Brand focus: every registration of the focused brand under this
    // molecule. Notices that name the brand are matched in the view from
    // each event's regulator-published brand_name (never drugs.brand_names).
    const focusId = sp.brand_focus;
    if (focusId) {
      const focusRow = catRows.find((r) => r.id === focusId);
      const focusBrand = focusRow ? cleanBrandNames([focusRow.brand_name ?? ""], drug.generic_name)[0] : null;
      if (focusRow && focusBrand) {
        const key = focusBrand.toLowerCase();
        const regs = catRows
          .filter((r) => (cleanBrandNames([r.brand_name ?? ""], drug.generic_name)[0] ?? "").toLowerCase() === key)
          .map((r) => ({
            product: r.brand_name ?? focusBrand,
            country: (r.source_country ?? "").toUpperCase(),
            source: r.source_name,
            regNo: r.registration_number,
            status: r.registration_status,
            sponsor: r.sponsor,
          }))
          .sort((a, b) => Number(b.country === userCountry) - Number(a.country === userCountry) || a.country.localeCompare(b.country) || a.product.localeCompare(b.product));
        brandFocus = { brand: focusBrand, catId: focusRow.id, regs };
        brandHint = null;
      }
    }
  }

  return (
    <V1DrugView
      id={id}
      drug={drug}
      shortages={shortages}
      statusLog={statusLog}
      alternatives={alternatives}
      userCountry={userCountry}
      apiConcentration={apiConcentration}
      supplyProfile={supplyProfile}
      supplyInMarket={supplyInMarket}
      recalls={recalls}
      approvalFootprint={approvalFootprint}
      eligibility={eligibility}
      pricing={pricing}
      concession={concession}
      priceMarkets={priceMarkets}
      altPricing={altPricing}
      products={products}
      brandSkus={brandSkus}
      brandHint={brandHint}
      brandFocus={brandFocus}
      freeViewsUsed={freeViewsUsed}
      sourcedAlternatives={sourcedAlternatives}
    />
  );
}
