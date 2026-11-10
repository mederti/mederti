import { Fragment } from "react";
import { type ConcentrationTier, PEER_GROUPS, TIER_LABEL, tierFor } from "@/lib/insights/dashboard-data-shared";
import { scopeSupply, sameIngredientOptions, type SupplyInMarket, type SupplyProduct, type SupplyStatus } from "@/lib/supply-in-market";
import Link from "next/link";
import { SOURCE_LABELS, type AlternativeCitation, type SourcedAlternative, type SourcedAlternativesResult } from "@/lib/alternatives-sources";
import ClinicalDisclaimer from "@/app/components/ClinicalDisclaimer";
import AppShell from "@/app/components/v1/AppShell";
import { ContextChat } from "@/app/chat/components/ContextChat";
import V1DrugSearch from "@/app/components/v1/V1DrugSearch";
import { ChatSignupGate, FreeViewBanner } from "@/app/components/free-tier/FreeTier";
import { FreeViewBeacon } from "@/app/components/free-tier/FreeViewBeacon";
import V1AiSummary from "./V1AiSummary";
import V1ReportActions from "./V1ReportActions";
import { FindSupplier } from "./find-supplier";
import { WatchButton } from "./watch-button";
import { ParallelTradeSourcing } from "./parallel-trade-sourcing";
import { ParallelTradeArbitrage } from "./parallel-trade-arbitrage";
import { ParallelTradePanel } from "./parallel-trade-panel";
import { PriceTrendChart } from "./PriceTrendChart";
import { ShortageTrendChart } from "@/app/chat/components/views/ShortageTrendChart";
import { ShortageEpisodeTimeline } from "./ShortageEpisodeTimeline";
import { DrugTabs } from "./DrugTabs";
import { detectS19A, getS19AText } from "@/lib/shortage-utils";
import { ALTERNATIVES_CAVEAT, affinity, relationshipLabel } from "@/lib/alternatives";
import { cleanBrandNames } from "@/lib/brand";
import { BAND_LABEL, type CompareResult } from "@/lib/pricing-compare";
import { truncateDrugName } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Structured regulatory-eligibility entry from the regulatory_eligibility table
// (migration 040), populated by backend/scrapers/eligibility/*. The authoritative
// substitution-pathway signal — carries a regulator-published approval reference
// and a verifiable source URL.
export type EligibilityEntry = {
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
};

// Human labels for the substitution schemes. Drives the pathways block so a new
// scraper (MHRA SSP etc.) renders correctly with no further UI change.
const SCHEME_LABEL: Record<string, string> = {
  tga_s19a: "Section 19A approval in force",
  mhra_ssp: "Serious Shortage Protocol active",
  dhsc_msn: "Medicine Supply Notification issued",
  fda_503b: "503B outsourcing eligibility",
  fda_shortage: "On FDA Drug Shortage list",
  eu_art_5_2: "Article 5(2) exemption available",
};

const FLAG: Record<string, string> = {
  AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦", SG: "🇸🇬",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪", CH: "🇨🇭", NO: "🇳🇴",
  SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰", NL: "🇳🇱", JP: "🇯🇵", KR: "🇰🇷",
  BE: "🇧🇪", AT: "🇦🇹", PL: "🇵🇱", PT: "🇵🇹", GR: "🇬🇷", IN: "🇮🇳",
  CN: "🇨🇳", BR: "🇧🇷", MX: "🇲🇽", ZA: "🇿🇦",
};
const flag = (c: string) => FLAG[(c || "").toUpperCase()] ?? "🌐";
const SEV: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const COUNTRY: Record<string, string> = {
  AU: "Australia", NZ: "New Zealand", GB: "United Kingdom", UK: "United Kingdom",
  US: "United States", CA: "Canada", DE: "Germany", FR: "France", IT: "Italy",
  ES: "Spain", IE: "Ireland", CH: "Switzerland", NO: "Norway", SE: "Sweden",
  FI: "Finland", DK: "Denmark", NL: "Netherlands", JP: "Japan", KR: "South Korea", SG: "Singapore",
};
// National product-registry code system per market. ATC is the global molecule
// code; this is the LOCAL, manufacturer-specific registration number.
const CODE_LABEL: Record<string, string> = {
  AU: "ARTG", US: "NDC", GB: "PL", UK: "PL", FR: "CIP", IT: "AIC", ES: "CN",
  CA: "DIN", DE: "PZN", IE: "PA", CH: "Swissmedic", NL: "RVG", SG: "SIN",
};

function abbr(name?: string, a?: string | null) {
  if (a) return a;
  if (!name) return "";
  if (name.includes("Therapeutic Goods")) return "TGA";
  if (name.includes("Food and Drug")) return "FDA";
  if (name.includes("European Medicines")) return "EMA";
  if (name.includes("MHRA") || name.includes("Healthcare products")) return "MHRA";
  if (name.includes("Health Canada") || name.includes("Santé")) return "Health Canada";
  return name.length > 18 ? name.slice(0, 17) + "…" : name;
}
/** Whole days since an ISO timestamp; null when absent or unparseable. */
function daysSince(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 864e5) : null;
}
function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
// Combination names ("Amoxicillin/Clavulanate") have no natural break point
// and overflow narrow tiles; a zero-width space after each slash lets them wrap.
function breakAtSlash(name: string): string {
  return name.replace(/\//g, "/\u200B");
}

function monthYear(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}
function isFuture(iso?: string | null) {
  return !!iso && new Date(iso).getTime() > Date.now();
}
function dayMonthYear(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const CUR_SYM: Record<string, string> = { AUD: "A$", USD: "US$", GBP: "£", EUR: "€", NZD: "NZ$", CAD: "C$" };
const fmtPrice = (amt: number, cur: string) => `${CUR_SYM[cur] ?? cur + " "}${amt.toFixed(2)}`;

/** A brand of this molecule the page is scoped to (?brand_focus=<catalogueId>). */
export type BrandFocus = {
  brand: string;
  catId: string;
  regs: {
    product: string;
    country: string;
    source: string | null;
    regNo: string | null;
    status: string | null;
    sponsor: string | null;
  }[];
};
/** Whole-word match of a cleaned brand inside a regulator-published product name. */
function namesBrand(published: string | null | undefined, brand: string): boolean {
  if (!published) return false;
  const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(published);
}
/** The regulator whose shortage list covers a market (for plain-English copy). */
function expSourceFor(cc: string): string {
  return ({ AU: "TGA", CA: "Health Canada", US: "FDA", GB: "MHRA", NZ: "Medsafe" } as Record<string, string>)[cc] ?? "the regulator";
}
const brandHref = (id: string, catId: string) => `/drugs/${id}?brand_focus=${catId}`;

export default function V1DrugView({
  id, drug, shortages, statusLog, alternatives, userCountry, apiConcentration, supplyProfile = null, supplyInMarket: supplyAll = null, recalls, approvalFootprint, eligibility, pricing, concession, priceMarkets, altPricing, products, brandSkus, brandHint, brandFocus = null, freeViewsUsed = null, sourcedAlternatives = null, marketCovered = null, formSel = null, strengthSel = null,
}: {
  sourcedAlternatives?: SourcedAlternativesResult | null;
  /** Form picker: dose-form slug and normalised strength from the URL. */
  formSel?: string | null;
  strengthSel?: string | null;
  /** Anonymous free-tier views used (null = signed in). */
  freeViewsUsed?: number | null;
  id: string;
  drug: any;
  shortages: any[];
  statusLog: any[];
  alternatives: any[];
  userCountry: string;
  apiConcentration?: {
    count: number;
    band: "very_high" | "high" | "medium" | "low";
    makers: string[];
    countries: string[];
    whoPqCount?: number;
  } | null;
  // Molecule-level supply facts from inn_risk_scores (see lib/insights/dashboard-data.ts).
  supplyProfile?: {
    molecule: string;
    fragility: number | null;
    whoList: "core" | "complementary" | null;
    euCritical: boolean;
    nApiMakers: number | null;
    nFinishedFirms: number | null;
    topApiCountry: string | null;
    topApiShare: number | null;
    shortCountries: string[];
  } | null;
  // Registered products × open notices in the user's market (lib/supply-in-market.ts).
  supplyInMarket?: SupplyInMarket | null;
  recalls?: any[];
  approvalFootprint?: {
    total: number;
    generics: number;
    brands: number;
    latest: string | null;
  } | null;
  eligibility?: EligibilityEntry[] | null;
  pricing?: {
    ex_manufacturer: number;
    dispensed: number | null;
    currency: string;
    pack: string | null;
    price_date: string | null;
    source: string;
  } | null;
  // Active price-concession in the user's market (early supply-pressure signal).
  concession?: {
    country: string;
    price: number;
    tariff: number | null;
    currency: string;
    pack: string | null;
    effective_date: string;
    source: string;
  } | null;
  // Headline official price per market (NHS Drug Tariff, CMS NADAC, …).
  priceMarkets?: {
    country: string;
    label: string;
    value: number | null;
    per: string;
    currency: string;
    source: string | null;
    effective_date: string | null;
    concession: number | null;
  }[] | null;
  // Cost-vs-alternatives comparison for the user's market (like-for-like basis).
  altPricing?: CompareResult | null;
  // Registered products for this molecule (drug_products + joined sponsor / MA
  // holder). Already fetched in page.tsx; drives the "Full drug record" section.
  products?: any[] | null;
  // Brand SKUs that roll up to this molecule — makes the brand chips clickable
  // to the brand-distinct sourcing view (/drugs/{catId}?brand=1).
  brandSkus?: { brand: string; catId: string; country: string }[];
  // Set when the user arrived from a brand search (e.g. "Fresofol" → Propofol);
  // drives the "you searched X" provenance banner.
  brandHint?: { brand: string; country: string; catId: string } | null;
  // Set when a brand chip was clicked: scopes the page to that brand.
  brandFocus?: BrandFocus | null;
  /** False when Mederti holds no shortage notices at all for the user's market. */
  marketCovered?: boolean | null;
}) {
  // brand (lowercased) → SKU, for turning chips into links.
  const skuByBrand = new Map((brandSkus ?? []).map((s) => [s.brand.toLowerCase(), s]));
  // Supply concentration tier — same definition as the National Shortage
  // Dashboard (tierFor on the nightly molecule fragility). Falls back to the
  // API-maker count with matching cut-offs when the drug isn't in the scored
  // universe. Labelled as a description, not a risk: the backtest found
  // concentration predicts neither shortage onset nor duration.
  const supplyTier: ConcentrationTier = supplyProfile?.fragility != null
    ? tierFor(supplyProfile.fragility)
    : apiConcentration
      ? apiConcentration.count <= 4 ? "highly_concentrated" : apiConcentration.count <= 9 ? "concentrated" : "broad"
      : "unknown";
  const TIER_CLS: Record<ConcentrationTier, string> = {
    highly_concentrated: "sp-crit", concentrated: "sp-part", broad: "sp-ok", unknown: "sp-part",
  };
  const active = shortages.filter((s) => ["active", "anticipated"].includes((s.status || "").toLowerCase()));
  // Country-FIRST status: a shortage far away but fine in your market is NOT a
  // shortage for you. The headline reflects YOUR country only; shortages
  // elsewhere are surfaced as secondary context + the regulator breakdown.
  const cName = COUNTRY[userCountry] ?? userCountry;
  // Active notices whose regulator-published product name names the focused
  // brand. Ingredient-level sources publish no brand, so they never match.
  const brandNoticeSeen = new Set<string>();
  const regDigits = (x: string | null | undefined) => (x ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const brandRegSet = new Set((brandFocus?.regs ?? []).map((r) => regDigits(r.regNo)).filter(Boolean));
  const brandNotices = brandFocus
    ? active
        .filter((s) => namesBrand(s.brand_name, brandFocus.brand) || (!!s.reg_no && brandRegSet.has(regDigits(s.reg_no))))
        // Collapse notices that would render identically (same as mineAll).
        .filter((s) => {
          const k = [s.country_code, s.brand_name, s.sponsor, s.status, s.severity, s.estimated_resolution_date].join("|").toLowerCase();
          if (brandNoticeSeen.has(k)) return false;
          brandNoticeSeen.add(k);
          return true;
        })
        .sort((a, b) =>
          Number((b.country_code || "").toUpperCase() === userCountry) - Number((a.country_code || "").toUpperCase() === userCountry) ||
          (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0),
        )
    : [];
  // Headline notice for the user's market. Prefer an ongoing shortage over a
  // single product's discontinuation: one discontinued brand must not make
  // the whole molecule read as leaving the market.
  // Form/strength picker (URL ?form=&strength=): the banner, the three
  // answers and the table all read this scoped view. An unknown slug falls
  // back to all forms; an unknown strength to the whole form.
  const formSlugSel = supplyAll && formSel && supplyAll.forms.some((f) => f.slug === formSel) ? formSel : null;
  const scopedStrength = formSlugSel && strengthSel && supplyAll ? scopeSupply(supplyAll, formSlugSel, strengthSel) : null;
  const strengthOn = !!scopedStrength;
  const supplyInMarket = supplyAll ? (scopedStrength ?? scopeSupply(supplyAll, formSlugSel, null)) : null;
  const isDisc = (s: any) => (s.reason_category || "").toLowerCase() === "discontinuation";
  // Then an active shortage over an anticipated one, worst severity first:
  // the card said "Anticipated shortage" for propofol while five products
  // were short now (it took whichever notice came first).
  const isAnt = (s: any) => (s.status || "").toLowerCase() === "anticipated";
  const inMarket = active
    .filter((s) => (s.country_code || "").toUpperCase() === userCountry)
    .sort((a, b) =>
      Number(isDisc(a)) - Number(isDisc(b)) ||
      Number(isAnt(a)) - Number(isAnt(b)) ||
      (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0),
    );
  const mine = inMarket[0] || null;
  // ALL events in the user's market — one row per regulator-reported product,
  // so multi-brand shortages stop collapsing into a single ingredient line.
  // Events that would render identically (same product, sponsor, status,
  // severity, return date) are collapsed: they carry no extra information for
  // the reader, only noise.
  const mineSeen = new Set<string>();
  const mineAll = active
    .filter((s) => (s.country_code || "").toUpperCase() === userCountry)
    .sort((a, b) =>
      (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0) ||
      (a.estimated_resolution_date || "9999").localeCompare(b.estimated_resolution_date || "9999"),
    )
    .filter((s) => {
      const k = [s.brand_name, s.sponsor, s.status, s.severity, s.estimated_resolution_date]
        .map((v) => (v || "").toString().toLowerCase()).join("|");
      if (mineSeen.has(k)) return false;
      mineSeen.add(k);
      return true;
    });
  // Focused brand in the user's market: its products in the supply table
  // (matched by registration number), so the brand line and the table agree.
  const brandLocal = (() => {
    if (!brandFocus) return null;
    const regs = brandFocus.regs.filter((r) => r.country === userCountry);
    if (!regs.length) return null;
    const set = new Set(regs.map((r) => regDigits(r.regNo)).filter(Boolean));
    const prods = (supplyInMarket?.groups ?? []).flatMap((g) => g.products)
      .filter((p) => p.regNos.some((x) => set.has(regDigits(x))));
    const short = prods.filter((p) => p.status === "short");
    const ant = prods.filter((p) => p.status === "anticipated");
    const starts = new Map<string, number>();
    let last: string | null = null;
    for (const p of prods) {
      if (!p.history) continue;
      starts.set(p.name, p.history.count);
      if (p.history.last && (!last || p.history.last > last)) last = p.history.last;
    }
    const pastCount = [...starts.values()].reduce((a, b) => a + b, 0);
    const backs = short.map((p) => p.back).filter(Boolean) as string[];
    return { regCount: regs.length, prodCount: prods.length, short: short.length, ant: ant.length,
      back: backs.length === short.length && backs.length ? backs.sort()[backs.length - 1] : null,
      pastCount, last };
  })();
  const brandLine = (() => {
    if (!brandFocus || !brandLocal) return null;
    const b = brandFocus.brand;
    const hist = brandLocal.pastCount > 0
      ? `Short ${brandLocal.pastCount === 1 ? "once" : `${brandLocal.pastCount}×`} in the past 2 years${brandLocal.last ? `, last ${monthYear(brandLocal.last)}` : ""}.`
      : "";
    if (brandLocal.short > 0) {
      return `${b}: ${brandLocal.short} of ${brandLocal.prodCount} product${brandLocal.prodCount === 1 ? "" : "s"} short now${brandLocal.back ? `, back ~${monthYear(brandLocal.back)} (sponsor estimate)` : ""}. ${hist}`.trim();
    }
    if (brandLocal.ant > 0) return `${b}: shortage anticipated for ${brandLocal.ant} of ${brandLocal.prodCount} product${brandLocal.prodCount === 1 ? "" : "s"}. ${hist}`.trim();
    return `${b}: none of its ${brandLocal.regCount} registration${brandLocal.regCount === 1 ? "" : "s"} in ${cName} is on ${expSourceFor(userCountry)}'s shortage list today. ${hist}`.trim();
  })();
  const elsewhere = active.filter((s) => (s.country_code || "").toUpperCase() !== userCountry);
  const elsewhereCount = new Set(elsewhere.map((s) => (s.country_code || "").toUpperCase())).size;

  // Cross-border footprint — answers "is this a local or a global problem?" at a
  // glance. Distinct OTHER markets with an active/anticipated shortage, worst
  // severity per market, with major markets (US/EU/UK/…) surfaced first so a
  // global pattern is obvious from the hero card rather than buried in the
  // regulator table further down.
  const MAJOR_MARKETS = new Set(["US", "GB", "UK", "DE", "FR", "IT", "ES", "CA", "JP", "EU"]);
  const elsewhereSev = new Map<string, number>();
  for (const s of elsewhere) {
    const cc = (s.country_code || "").toUpperCase();
    if (!cc) continue;
    elsewhereSev.set(cc, Math.max(elsewhereSev.get(cc) ?? -1, SEV[(s.severity || "").toLowerCase()] ?? 0));
  }
  const footprint = [...elsewhereSev.entries()]
    .map(([cc, r]) => ({ cc, sev: r, major: MAJOR_MARKETS.has(cc) }))
    .sort((a, b) => Number(b.major) - Number(a.major) || b.sev - a.sev || a.cc.localeCompare(b.cc));

  // ── Scoped status (registered products × open notices) ───────────────────
  // The banner must not generalise: "Discontinued in Australia" when 2 of 44
  // Amoxicillin products were. Counts come from the supply table so the two
  // always agree; a form is "short" only when every product in it is.
  const scProducts: { p: SupplyProduct; form: string }[] = supplyInMarket
    ? supplyInMarket.groups.flatMap((g) => g.products.map((p) => ({ p, form: g.form })))
    : [];
  const scTotal = scProducts.length;
  const scHit = scProducts.filter((x) => x.p.status === "short");
  const scAnt = scProducts.filter((x) => x.p.status === "anticipated");
  const scUnmatched = supplyInMarket ? supplyInMarket.groups.flatMap((g) => g.notices).filter((n) => n.status === "short").length : 0;
  const scClear = scProducts.filter((x) => x.p.status === "none").length;
  const scDiscAll = scHit.length > 0 && scHit.every((x) => x.p.discontinued);
  const scExitFuture = scDiscAll && scHit.every((x) => !!x.p.exitDate && isFuture(x.p.exitDate));
  const scBrand = (() => {
    const words = new Set(scHit.map((x) => x.p.label.split(/\s+/)[0]));
    return words.size === 1 ? [...words][0] : null;
  })();
  const scPartial = scTotal > 0 && scHit.length > 0 && scHit.length < scTotal;
  const scopeName = formSlugSel && supplyInMarket?.groups[0]
    ? `${supplyInMarket.groups[0].form.toLowerCase()}${strengthOn && strengthSel ? ` ${strengthSel}` : ""}`
    : null;
  // With a form selected the banner speaks for that form only.
  const localShortage = formSlugSel && supplyInMarket ? scHit.length + scAnt.length + scUnmatched > 0 : !!mine;
  // No shortage source for this market: absence of notices proves nothing.
  const noData = !localShortage && marketCovered === false;
  // Days since the headline notice was last confirmed against its source.
  const staleDays = daysSince(mine?.last_verified_at ?? null);
  // The regulator's own impact rating, verbatim (TGA: Low / Medium / High /
  // Critical), highest across the market's open notices.
  const IMPACT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const impacts = inMarket.map((s) => String(s.regulator_impact ?? "")).filter((x) => x.toLowerCase() in IMPACT_RANK);
  const topImpact = impacts.sort((a, b) => IMPACT_RANK[b.toLowerCase()] - IMPACT_RANK[a.toLowerCase()])[0] ?? null;
  const impactCount = impacts.length;
  const sev = (mine?.severity || "").toLowerCase();
  const isCrit = sev === "critical" || sev === "high";
  // A discontinuation with a future cancellation date is stored "anticipated",
  // but it is a market exit, not an expected shortage: it must read "Leaving
  // the market" (Zabep showed "Anticipated shortage" while its ARTG
  // registration ends 17 Nov 2026).
  const anticipated = formSlugSel && supplyInMarket
    ? scHit.length === 0 && scAnt.length > 0
    : (mine?.status || "").toLowerCase() === "anticipated" && !(mine && isDisc(mine));

  // Discontinuation is a market exit, not a supply gap — it is never "back",
  // so it must not read as a "Critical shortage". The regulator-stated
  // withdrawal date (TGA ARTG cancellation) is the headline fact; TGA's own
  // impact rating, availability and guidance are quoted verbatim from the
  // notice, plus a link to any regulator statement it cites.
  const discontinued = formSlugSel && supplyInMarket ? scDiscAll : inMarket.length > 0 && inMarket.every(isDisc);
  const withdrawalDate: string | null = mine?.withdrawal_date ?? null;
  const withdrawalFuture = isFuture(withdrawalDate);
  const noticeNotes = String(mine?.notes || "");
  const availOf = (n: any) => /TGA availability:\s*(.+)/i.exec(String(n?.notes || ""))?.[1]?.trim() || null;
  // Quoted only when every open notice in the market says the same thing —
  // otherwise one product's wording would be read as the whole medicine's.
  const regAvailability = new Set(inMarket.map(availOf)).size === 1 ? availOf(mine) : null;
  const regGuidanceRaw = /TGA guidance:\s*([\s\S]+?)(?:\n\n|$)/i.exec(noticeNotes)?.[1]?.trim() || null;
  const regStatementUrl = regGuidanceRaw?.match(/https:\/\/www\.tga\.gov\.au\/\S+/)?.[0]?.replace(/[.,)]+$/, "") ?? null;
  const guidanceOf = (n: any) =>
    /TGA guidance:\s*([\s\S]+?)(?:\n\n|$)/i.exec(String(n?.notes || ""))?.[1]?.trim()
      ?.replace(/\s*A TGA web statement is available at:?\s*\S+/i, "").trim() || null;
  // Every distinct piece of advice across the market's open notices — one
  // notice's wording must not stand in for products it doesn't cover.
  const regGuidanceAll = [...new Set(inMarket.map(guidanceOf).filter(Boolean) as string[])];
  const regGuidance = regGuidanceAll.length > 0 ? regGuidanceAll.map((g) => `\u201c${g}\u201d`).join(" · ") : null;

  // ── Pricing: headline price per market + active-concession signal ──────────
  const mkts = priceMarkets ?? [];
  const myMarket = mkts.find((m) => m.country === userCountry) ?? null;
  const otherMarkets = mkts.filter((m) => m.country !== userCountry).slice(0, 4);
  // Distinct countries with an active/anticipated shortage — the footprint the
  // concession signal points at ("under price pressure here AND short in N").
  const shortCountries = Array.from(
    new Set(active.map((s) => (s.country_code || "").toUpperCase()).filter(Boolean)),
  );
  const concDelta =
    concession && concession.tariff && concession.tariff > 0
      ? Math.round(((concession.price - concession.tariff) / concession.tariff) * 100)
      : null;

  // Compact hero price line — the user-market headline price, kept above the
  // fold for every market we hold data for (AU PBS AEMP/DPMQ, GB Drug Tariff,
  // US NADAC, …). Suppressed when a concession banner already carries the
  // price, and never falls back to a (possibly stale) concession-only value.
  const heroPrice = pricing
    ? {
        label: "AEMP",
        value: pricing.ex_manufacturer,
        currency: pricing.currency,
        extra: pricing.dispensed != null ? `DPMQ ${fmtPrice(pricing.dispensed, pricing.currency)}` : null,
      }
    : myMarket && myMarket.value != null && myMarket.label !== "Concession"
    ? { label: myMarket.label, value: myMarket.value, currency: myMarket.currency, extra: null }
    : null;

  // Expected back — sponsor-declared only, else "No estimate provided" (never computed).
  // Earliest estimate still in the future across this market's notices. A
  // passed estimate is never shown as "expected back" (Propofol showed
  // "Apr 2026" in Nov 2026) — it's reported as passed instead.
  const todayIso = new Date().toISOString().slice(0, 10);
  const futureEst = mineAll
    .filter((s) => s.estimated_resolution_date && s.estimated_resolution_date.slice(0, 10) >= todayIso)
    .sort((a, b) => a.estimated_resolution_date!.localeCompare(b.estimated_resolution_date!))[0] ?? null;
  const estPassed = formSlugSel && supplyInMarket
    ? scHit.length > 0 && scHit.every((x) => !x.p.back) && scHit.some((x) => x.p.backPassed)
    : !futureEst && mineAll.some((s) => !!s.estimated_resolution_date);
  // With a form selected, the estimate comes from that form's short products.
  const scBacks = scHit.map((x) => x.p.back).filter(Boolean) as string[];
  const expected = formSlugSel && supplyInMarket
    ? monthYear(scBacks.sort()[0] ?? null)
    : monthYear(futureEst?.estimated_resolution_date);
  const expEvent = futureEst ?? mine;
  const expSource = abbr(expEvent?.data_sources?.name, expEvent?.data_sources?.abbreviation) || "regulator";

  // Substitution pathways — prefer the STRUCTURED regulatory_eligibility feed
  // (real approval references, expiry dates, verifiable source URLs). Filter to
  // the user's market so we only assert a pathway that applies where they
  // dispense. Fall back to string-matching the regulator notice for S19A only
  // when no structured entry is on file (e.g. before migration 040 is applied
  // or before the eligibility scraper has backfilled this drug).
  const eligActive = (eligibility ?? []).filter(
    (e) => (e.status || "").toLowerCase() === "active",
  );
  const eligMine = eligActive.filter(
    (e) => !e.country_code || e.country_code.toUpperCase() === userCountry,
  );
  const s19aStructured = eligMine.find((e) => e.scheme === "tga_s19a") ?? null;

  // Notes fallback (legacy path) — only consulted when no structured entry.
  const s19aEvt = active.find((s) => detectS19A(s.notes));
  const s19aNotesText = s19aEvt ? getS19AText(s19aEvt.notes) : null;

  // Short detail line for the "Can I substitute?" tile.
  const s19aTileDetail = s19aStructured
    // The product's name, not the scheme_reference (a URL slug such as
    // "diazepam-injection-10mg-2ml-ampoules-hameln-uk").
    ? s19aStructured.brand_name
      ? `${s19aStructured.brand_name}${(() => {
          const origin = /Origin:\s*([^.]+)\./.exec(s19aStructured.description ?? "")?.[1]?.trim();
          return origin ? ` (${origin})` : "";
        })()} · TGA s19A`
      : "TGA-approved overseas product (s19A)"
    : s19aNotesText
      ? "TGA-approved overseas product"
      : null;

  // Same-ATC-class drugs only — no clinical match, evidence or dose data exists.
  const alts = (alternatives || []).slice(0, 5).map((a) => ({
    id: a.alternative_drug_id ?? a.drugs?.id ?? null,
    name: a.drugs?.generic_name ?? "Therapeutic alternative",
    rel: relationshipLabel(a.relationship_type),
    pct: a.similarity_score != null ? Math.round(a.similarity_score * 100) : null,
    note: null as string | null,
  }));
  const topAlt = alts[0] ?? null;

  // Dosage form for the price card's 4th column (e.g. "Tablet", "Capsule").
  // Drug-level; filters out scraper/auto-created junk values.
  const drugForm: string | null =
    ((drug.dosage_forms as string[] | undefined) ?? []).filter(
      (f) => f && !/scraper|auto.created/i.test(f),
    )[0] ?? null;

  // Regulator status by country
  const byCountry = new Map<string, any>();
  for (const s of shortages) {
    const cc = (s.country_code || "").toUpperCase();
    if (!cc) continue;
    const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
    const ex = byCountry.get(cc);
    if (!ex || r > (SEV[(ex.severity || "").toLowerCase()] ?? -1)) byCountry.set(cc, s);
  }
  const regulators = [...byCountry.values()]
    .sort((a, b) => (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0))
    .slice(0, 8);

  // Sources
  const srcMap = new Map<string, any>();
  for (const s of shortages) {
    const a = abbr(s.data_sources?.name, s.data_sources?.abbreviation);
    if (a && !srcMap.has(a)) srcMap.set(a, { a, cc: s.data_sources?.country_code ?? s.country_code ?? "", url: s.source_url, ver: s.last_verified_at ?? s.updated_at });
  }
  const sources = [...srcMap.values()].slice(0, 8);

  // History — computed from resolved shortages (real durations, labelled as pattern).
  const durations = shortages
    .filter((s) => (s.status || "").toLowerCase() === "resolved" && s.start_date && s.end_date)
    .map((s) => (new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 2.628e9)
    .filter((m) => m > 0 && m < 60);
  const history = durations.length
    ? { n: durations.length, lo: Math.round(Math.min(...durations)), hi: Math.round(Math.max(...durations)) }
    : null;

  // Timeline
  const events = shortages
    .map((s) => ({ date: s.start_date ?? s.created_at, cc: s.country_code, txt: (s.status || "").toLowerCase() === "resolved" ? "Shortage resolved" : `${(s.severity || "shortage")} reported`, resolved: (s.status || "").toLowerCase() === "resolved" }))
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  const klass = drug.drug_class || drug.atc_description || null;

  // Recalls — most recent first; active Class I are the highest-signal.
  const recallList = (recalls || [])
    .slice()
    .sort((a, b) => new Date(b.announced_date || 0).getTime() - new Date(a.announced_date || 0).getTime())
    .slice(0, 6);

  // ── "Full drug record" (Phase 1) ─────────────────────────────────────────
  // Reference data we already hold but never surfaced on the V1 page. Pure
  // display — no new queries. Safety rule: only emit a field when real data
  // exists; never fabricate or show placeholders.
  const cleanList = (arr?: string[] | null) =>
    (arr ?? []).filter((x) => x && !/scraper|auto.created/i.test(x));
  const cleanName = (raw?: string | null): string | null => {
    if (!raw) return null;
    return cleanBrandNames([raw], drug.generic_name)[0] ?? raw;
  };
  const atcL5: string | null = drug.atc_code || null;
  const atcL4: string | null = atcL5 && atcL5.length >= 5 ? atcL5.slice(0, 5) : null;
  const strengths = cleanList(drug.strengths);
  const forms = cleanList(drug.dosage_forms);
  const routes = cleanList(drug.routes_of_administration);

  // Registration / MA-holder table from drug_products. Dedupe by
  // brand+strength+market so noisy substring matches collapse.
  const seenReg = new Set<string>();
  const regRows = (products ?? [])
    .map((p) => ({
      name: cleanName(p.trade_name || p.product_name),
      strength: p.strength && !/scraper|auto.created/i.test(p.strength) ? p.strength : null,
      form: p.dosage_form && !/scraper|auto.created/i.test(p.dosage_form) ? p.dosage_form : null,
      country: (p.country || "").toUpperCase() || null,
      sponsor: p.sponsors?.name || null,
      status: p.registry_status || null,
    }))
    .filter((p) => p.name)
    .filter((p) => {
      const k = `${(p.name || "").toLowerCase()}|${p.strength ?? ""}|${p.country ?? ""}`;
      if (seenReg.has(k)) return false;
      seenReg.add(k);
      return true;
    });
  const regShown = regRows.slice(0, 15);
  const regRest = regRows.length - regShown.length;
  // Distinct MA holders (sponsors) — a quick top-line even when the table is long.
  const maHolders = [...new Set(regRows.map((r) => r.sponsor).filter(Boolean))] as string[];

  // Header sub-line: the LOCAL registration in the user's own market — the
  // national product code (ARTG / NDC / CIP …) + manufacturer that sits beneath
  // the global ATC. Country-scoped on purpose: a molecule has many local codes,
  // so we only assert the one for the market this page is framed around.
  const localReg = (() => {
    if (brandFocus) {
      const regs = brandFocus.regs.filter((r) => r.country === userCountry && r.regNo);
      if (regs.length) {
        const code = String(regs[0].regNo);
        const label = /^[A-Za-z]/.test(code) ? null : CODE_LABEL[userCountry] ?? "Reg.";
        return { country: userCountry, label, code: regs.length > 1 ? `${code} +${regs.length - 1} more` : code, sponsor: regs[0].sponsor || null };
      }
    }
    // Molecule view: one product's code would single out an arbitrary
    // brand (propofol showed B Braun's AUST R 220082), so state the count.
    if (supplyAll && supplyAll.productCount > 0) {
      return { country: userCountry, label: null, code: `${supplyAll.productCount} registered product${supplyAll.productCount === 1 ? "" : "s"}`, sponsor: supplyAll.registerSource };
    }
    const p = (products ?? []).find(
      (x) => (x.country || "").toUpperCase() === userCountry && x.registry_id,
    );
    if (!p) return null;
    const code = String(p.registry_id);
    // Many national codes already self-identify with a text prefix ("AUST R",
    // "PL", "RVG"); only prepend the system label for bare numeric codes
    // (NDC, CIP, AIC, DIN, …) where it adds meaning.
    const label = /^[A-Za-z]/.test(code) ? null : CODE_LABEL[userCountry] ?? "Reg.";
    return { country: userCountry, label, code, sponsor: p.sponsors?.name || null };
  })();

  // Report identity (drives the export/print header).
  const generatedLabel = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const marketLabel = `${cName} market`;

  // Product-card top-line status pill.


  // Detailed product-attribute table (2-col label/value). Only emits rows with
  // real data; the PIL/SPC document rows are shown muted as "Not on file" so the
  // field is visible without fabricating a value.
  const attrBrands = cleanBrandNames(drug.brand_names, drug.generic_name);
  const attrBrandValue = attrBrands.length
    ? attrBrands.slice(0, 6).join(", ") + (attrBrands.length > 6 ? ` +${attrBrands.length - 6} more` : "")
    : null;
  type AttrRow = { label: string; value: string | null; muted?: boolean };
  const attrRows: AttrRow[] = (
    [
      { label: "Active ingredient (INN)", value: drug.generic_name },
      { label: "Brand names", value: attrBrandValue },
      { label: "ATC level 5", value: atcL5 },
      { label: "ATC level 4", value: atcL4 },
      { label: "Drug class", value: drug.drug_class || null },
      { label: "Therapeutic category", value: drug.therapeutic_category || null },
      { label: "Strength", value: strengths.join(" · ") || null },
      { label: "Dosage form", value: forms.join(" · ") || null },
      { label: "Route of administration", value: routes.join(" · ") || null },
      {
        label: "WHO Essential Medicine",
        value: drug.who_essential_medicine
          ? `Yes${drug.who_eml_section ? ` · ${drug.who_eml_section}` : ""}${drug.who_eml_year ? ` (${drug.who_eml_year})` : ""}`
          : null,
      },
      {
        label: "Controlled substance",
        value: drug.is_controlled_substance === true ? "Yes — scheduled" : drug.is_controlled_substance === false ? "No" : null,
      },
      {
        label: "Marketing-authorisation holders",
        value: maHolders.length ? maHolders.slice(0, 4).join(", ") + (maHolders.length > 4 ? ` +${maHolders.length - 4} more` : "") : null,
      },
      { label: "Registrations on file", value: regRows.length ? String(regRows.length) : null },
      { label: "Patient information leaflet (PIL)", value: "Not on file", muted: true },
      { label: "Summary of product characteristics (SPC)", value: "Not on file", muted: true },
    ] as AttrRow[]
  ).filter((r) => r.value);

  // ── Banner wording, scoped to what the register × notices show ───────────
  const inWhere = `in ${cName}`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const hqTitle = (() => {
    if (!localShortage) return noData ? `No shortage data for ${cName}` : scopeName ? `No shortage reported for ${scopeName} ${inWhere}` : `In supply ${inWhere}`;
    if (scTotal > 0 && (scHit.length > 0 || scAnt.length > 0)) {
      const n = scHit.length;
      if (n === 0) {
        return scAnt.length === scTotal ? `Anticipated shortage ${inWhere}` : `Shortage anticipated for ${scAnt.length} of ${plural(scTotal, "product")} ${inWhere}`;
      }
      if (n === scTotal) {
        if (scDiscAll) return scExitFuture ? `Leaving the market ${inWhere}` : `Discontinued ${inWhere}`;
        return scTotal === 1 ? `Short ${inWhere}` : `All ${scTotal} products short ${inWhere}`;
      }
      if (scDiscAll) {
        const verb = scExitFuture ? "leaving the market" : "discontinued";
        return scBrand ? `${plural(n, `${scBrand} product`)} ${verb} ${inWhere}` : `${n} of ${plural(scTotal, "product")} ${verb} ${inWhere}`;
      }
      return `${n} of ${plural(scTotal, "product")} ${scHit.some((x) => x.p.discontinued) ? "affected" : "short"} ${inWhere}`;
    }
    // No register to scope against (or only unmatched notices): notice wording.
    return anticipated ? `Anticipated shortage ${inWhere}`
      : discontinued ? (withdrawalFuture ? `Leaving the market ${inWhere}` : `Discontinued ${inWhere}`)
      : `Short ${inWhere}`;
  })();
  const formWord = (form: string) =>
    ({ Tablets: "tablet", Capsules: "capsule", "Oral liquid": "oral liquid", Injection: "injection", Inhaler: "inhaler", Topical: "topical", "Eye or ear": "eye/ear", Rectal: "rectal" } as Record<string, string>)[form] ?? form.toLowerCase();
  // Bold first line: which products, and whether the rest of each affected
  // form is clear. Shown whenever only part of the market is affected.
  const scopeLine = (() => {
    if (brandFocus || !scPartial) return null;
    const items = scHit.slice(0, 4).map(({ p, form }) => {
      const exit = p.discontinued
        ? p.exitDate ? `, registration ${isFuture(p.exitDate) ? "ends" : "ended"} ${dayMonthYear(p.exitDate)}` : ", discontinued"
        : "";
      return `${p.label} ${formWord(form)}${exit}`;
    });
    const more = scHit.length > 4 ? `; +${scHit.length - 4} more` : "";
    const hitForms = [...new Set(scHit.map((x) => x.form))];
    const lacking = hitForms.filter((f) => !scProducts.some((x) => x.form === f && x.p.status === "none"));
    const other = lacking.length === 0
      ? `Other products in ${hitForms.length === 1 ? "the same form" : "the same forms"}: no shortage reported.`
      : `No other ${lacking.map(formWord).join(" or ")} product without a notice.`;
    // The title already gives "N of M"; this line only names the products.
    return `${items.join("; ")}${more}. ${other}`;
  })();
  // Same medicine, same form and strength, no notice: the first answer to
  // "what can I use instead?". A different medicine comes after, as a
  // prescriber decision.
  const sameOpts = localShortage && supplyInMarket ? sameIngredientOptions(supplyInMarket) : [];
  const sameLabels = [...new Set(sameOpts.map((p) => p.label))];

  // Tab empty states — each tab says plainly when we hold nothing for it.
  const hasStatus = !!supplyInMarket || mineAll.length > 0 || regulators.length > 0 || shortages.length > 0 || events.length > 0;
  const hasAlts = userCountry === "AU" || !!sourcedAlternatives?.available || alts.length > 0;
  const hasOutlook = shortages.length > 0 || !!history || !!apiConcentration || !!approvalFootprint || recallList.length > 0;
  const hasInfo = attrRows.length > 0 || regRows.length > 0;

  return (
    // Shared 3-column AppShell: V1Sidebar → grounded chat (middle) → the drug
    // record (right). chat.css is scoped to the chat column only ("panel") —
    // the record's own class names (.badge, .country-row, …) collide with it.
    <AppShell
      className="v1home v1drug"
      chatScope="panel"
      chatTop={<V1DrugSearch initial={drug.generic_name} />}
      chatPanel={
              freeViewsUsed != null ? (
                <ChatSignupGate
                  next={`/drugs/${id}`}
                  headerLabel="Ask about this medicine"
                  lead={<>Ask about <b>{drug.generic_name}</b> — substitutes, who&apos;s affected, or how long it may last — answered from live regulator data.</>}
                />
              ) : (
              <ContextChat
                key={brandFocus ? `${drug.generic_name}:${brandFocus.brand}` : drug.generic_name}
                contextKey={brandFocus ? `${drug.generic_name}:${brandFocus.brand}` : drug.generic_name}
                title={brandFocus ? `${brandFocus.brand} (${drug.generic_name})` : drug.generic_name}
                category="Drug record"
                bodyText={
                  brandFocus
                    ? `The user is viewing the Mederti drug record for ${drug.generic_name}, focused on the brand ${brandFocus.brand} (${brandFocus.regs.length} registration${brandFocus.regs.length === 1 ? "" : "s"}; ${brandNotices.length} active regulator notice${brandNotices.length === 1 ? "" : "s"} name it). Answer about this brand first, then the molecule — its shortages, substitutes, suppliers, and regulatory status.`
                    : `The user is viewing the Mederti drug record for ${drug.generic_name}. Answer about this medicine — its shortages, substitutes, suppliers, and regulatory status.`
                }
                headerLabel="Ask about this medicine"
                placement="left"
                emptyLead={
                  <>
                    Ask me anything about{" "}
                    <span className="font-medium text-slate-700">{drug.generic_name}</span> —
                    substitutes, who&apos;s affected, or how long it may last.
                  </>
                }
                starters={[
                  `What can I substitute for ${drug.generic_name}?`,
                  "Which countries are affected?",
                  "How long did past shortages last?",
                ]}
              />
              )
      }
    >
      <style>{CSS}</style>
          {freeViewsUsed != null && (
            <>
              <FreeViewBeacon drugId={id} />
              <FreeViewBanner used={freeViewsUsed} next={`/drugs/${id}`} />
            </>
          )}
          {/* The search bar lives at the top of the chat column (chatTop); the
              column is hidden below 1080px, so this copy shows only there. */}
          <div className="dsearch-narrow"><V1DrugSearch initial={drug.generic_name} /></div>

          {brandHint && (
            <div
              className="d-brandhint"
              style={{
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
                padding: "10px 14px", marginBottom: 14, borderRadius: 10,
                background: "var(--ind-bg, rgba(99,102,241,0.08))",
                border: "1px solid var(--ind-b, rgba(99,102,241,0.25))",
                fontSize: 13, color: "var(--app-text-2)",
              }}
            >
              <span>
                You searched <strong>{brandHint.brand}</strong> — a brand of {drug.generic_name}
                {brandHint.country ? ` (${brandHint.country})` : ""}.
              </span>
              <a
                href={brandHref(id, brandHint.catId)}
                style={{ color: "var(--teal-l)", textDecoration: "none", fontWeight: 600 }}
              >
                View {brandHint.brand} registrations {"→"}
              </a>
            </div>
          )}

          <div className="product-card hero-card">
            <div className="pc-body">
              {/* Line 1: name alone. Line 2: EML tag + ATC + local register code
                  on one line. Line 3: brand tags left, actions right. */}
              <div className="d-name">{drug.generic_name}</div>
              <div className="d-meta">
                {drug.who_essential_medicine ? (
                  <a
                    className="d-eml"
                    href="https://list.essentialmeds.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      drug.who_eml_section
                        ? `WHO Model List of Essential Medicines${drug.who_eml_year ? ` (${drug.who_eml_year})` : ""} — ${drug.who_eml_section}`
                        : `On the WHO Model List of Essential Medicines${drug.who_eml_year ? ` (${drug.who_eml_year})` : ""}`
                    }
                  >
                    <span className="d-eml-dot" />
                    WHO Essential Medicine
                  </a>
                ) : null}
                {drug.is_controlled_substance === true ? (
                  <span className="d-ctrl">Controlled substance</span>
                ) : null}
                <span className="d-generic">
                  {[drug.atc_code ? `ATC ${drug.atc_code}` : null, klass].filter(Boolean).join(" · ") || "—"}
                </span>
                {localReg && (
                  <span className="d-localcode">
                    {flag(localReg.country)} {[localReg.label, localReg.code].filter(Boolean).join(" ")}
                    {localReg.sponsor ? <> · {localReg.sponsor}</> : null}
                  </span>
                )}
              </div>
              <div className="d-tagrow">
              {(() => {
                const base = cleanBrandNames(drug.brand_names, drug.generic_name);
                const brands = brandFocus
                  ? [brandFocus.brand, ...base.filter((b) => !b.toLowerCase().startsWith(brandFocus.brand.toLowerCase()))]
                  : base;
                if (brands.length === 0) return <div className="d-tags" />;
                const shown = brands.slice(0, 5);
                const rest = brands.length - shown.length;
                return (
                  <div className="d-tags">
                    {shown.map((b) => {
                      const sku = brandFocus && b === brandFocus.brand
                        ? { catId: brandFocus.catId }
                        : skuByBrand.get(b.toLowerCase());
                      return sku ? (
                        <a
                          key={b}
                          className="d-tag"
                          href={brandFocus?.catId === sku.catId ? `/drugs/${id}` : brandHref(id, sku.catId)}
                          title={brandFocus?.catId === sku.catId ? `Clear ${b} focus` : `Focus on ${b} — its registrations and shortage notices`}
                          aria-current={brandFocus?.catId === sku.catId ? "true" : undefined}
                          style={{
                            textDecoration: "none", cursor: "pointer",
                            ...(brandFocus?.catId === sku.catId
                              ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }
                              : null),
                          }}
                        >
                          {b}
                        </a>
                      ) : (
                        <span key={b} className="d-tag">{b}</span>
                      );
                    })}
                    {rest > 0 && <span className="d-tag" title={brands.slice(5).join(", ")}>+{rest} more</span>}
                  </div>
                );
              })()}
                <div className="sc-actions pc-actions">
                  <WatchButton drugId={id} />
                  <FindSupplier drugId={id} drugName={drug.generic_name} userCountry={userCountry} severity={sev} />
                </div>
              </div>
            </div>
          {/* Status — design 3: a one-line status headline, then the three
              questions a pharmacist asks (when's it back / what instead / what
              does it cost), then "is it just us?". "Yes" on substitution only
              when a real pathway is on file; absence is stated as absence. */}
          <div className={`hq ${localShortage ? (anticipated ? "med" : isCrit ? "crit" : "med") : noData ? "med" : "ok"}`}>
            <div className="hq-head">
              <span className="hq-ic" aria-hidden>
                {noData ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                ) : localShortage ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                )}
              </span>
              <div className="hq-head-t">
                <div className="hq-title">{hqTitle}</div>
                <div className="hq-sub">
                {scopeLine && <span className="hq-scope" style={{ display: "block", color: "var(--text)" }}>{scopeLine}</span>}
                  {localShortage && discontinued ? (
                    <span className="hq-reason">
                      {scopeLine
                        ? [regAvailability, topImpact ? `${expSource} impact rating: ${topImpact}${impactCount > 1 && !formSlugSel ? ` (highest of ${impactCount} notices)` : ""}` : null].filter(Boolean).join(" · ")
                        : <>
                            {withdrawalDate ? `Registration ${withdrawalFuture ? "ends" : "ended"} ${dayMonthYear(withdrawalDate)}` : "Product discontinued"}
                            {regAvailability ? ` · ${regAvailability}` : ""}
                            {mine?.regulator_impact ? ` · ${expSource} impact rating: ${mine.regulator_impact}` : ""}
                          </>}
                    </span>
                  ) : (
                    localShortage && (mine?.reason || topImpact) && (
                      <span className="hq-reason">
                        {mine?.reason ? String(mine.reason).replace(/^availability:\s*/i, "") : ""}
                        {topImpact ? `${mine?.reason ? " · " : ""}${expSource} impact rating: ${topImpact}${impactCount > 1 ? ` (highest of ${impactCount} notices)` : ""}` : ""}
                      </span>
                    )
                  )}
                {brandLine && <span className="hq-reason" style={{ display: "block", fontWeight: 600, color: "var(--text)" }}>{brandLine}</span>}
                {noData && <span className="hq-reason">Mederti has no shortage source for {cName}, so we can&apos;t say whether it&apos;s in supply there. Check with your supplier or the national regulator.</span>}
                {localShortage && staleDays !== null && staleDays > 7 && (
                  // The regulator feed hasn't been read for a week+: say so
                  // rather than present old notices as current (Health
                  // Canada's site has blocked our reader since 13 Sep 2026).
                  <span className="hq-reason" style={{ display: "block", color: "var(--crit, #b42318)", fontWeight: 600 }}>
                    Out of date: we last confirmed this with {expSource} {staleDays} days ago. Check the regulator before relying on it.
                  </span>
                )}
                <span className="hq-src">{localShortage ? `${expSource} notice · verified ${timeAgo(mine?.last_verified_at ?? mine?.updated_at) || "recently"}` : noData ? "Coverage gap, not a supply status" : "Source: official regulators"}</span>
                </div>
                {localShortage && discontinued && (regGuidance || regStatementUrl) && (
                  <div className="sc-guid">
                    {regGuidance && <span>{expSource} advice: {regGuidance}</span>}
                    {regStatementUrl && (
                      <a href={regStatementUrl} target="_blank" rel="noopener noreferrer">Read the {expSource} statement →</a>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="hq-qs">
              <div className="hq-q">
                {localShortage && discontinued ? (
                  <>
                    {/* Discontinuation is a market exit: it is never "back". */}
                    <div className="hq-q-l">When will it be back?</div>
                    <div className="hq-q-a">Not expected back</div>
                    <div className="hq-q-d">
                      {scPartial && scDiscAll
                        ? `Market exit for the ${plural(scHit.length, "discontinued product")}, via ${expSource}. ${plural(scClear, "other product")}: no shortage reported.`
                        : withdrawalDate ? `Market exit: registration ${withdrawalFuture ? "ends" : "ended"} ${dayMonthYear(withdrawalDate)}, via ${expSource}.` : "Discontinued by the sponsor."}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="hq-q-l">When will it be back?</div>
                    {brandFocus && brandLocal && brandLocal.short === 0 && brandLocal.ant === 0 ? (
                      // The brand in focus isn't short: the molecule's date
                      // belongs to another brand, so say so rather than quote it.
                      <>
                        <div className="hq-q-a">{brandFocus.brand} isn&apos;t short</div>
                        <div className="hq-q-d">
                          {localShortage && expected ? `Other brands of ${drug.generic_name}: around ${expected} (earliest sponsor estimate via ${expSource}).` : `None of its ${cName} registrations is on the list.`}
                        </div>
                      </>
                    ) : brandFocus && brandLocal && brandLocal.short > 0 ? (
                      <>
                        <div className="hq-q-a">{brandLocal.back ? `Around ${monthYear(brandLocal.back)}` : "No estimate"}</div>
                        <div className="hq-q-d">{brandLocal.back ? `${brandFocus.brand}: latest sponsor estimate via ${expSource} for its short products.` : `${brandFocus.brand}: the sponsor hasn't published a return date for every short product.`}</div>
                      </>
                    ) : (
                      <>
                        <div className="hq-q-a">{noData ? "No data" : !localShortage ? "Not short here" : expected ? `Around ${expected}` : estPassed ? "Estimate passed" : "No estimate"}</div>
                        <div className="hq-q-d">
                          {noData ? `No shortage source for ${cName}.` : !localShortage ? (scopeName ? `No active shortage for ${scopeName}.` : "No active shortage in this market.") : expected ? `Earliest sponsor estimate via ${expSource}. May differ by brand.` : estPassed ? "The sponsor's date has passed and hasn't been updated." : "The sponsor hasn't published a return date."}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="hq-q">
                <div className="hq-q-l">What can I use instead?</div>
                {sameLabels.length > 0 ? (
                  <>
                    <div className="hq-q-a">{plural(sameOpts.length, "other product")} not short</div>
                    <div className="hq-q-d">
                      Same medicine, same form and strength: {sameLabels.slice(0, 3).join(", ")}
                      {sameLabels.length > 3 ? ` +${sameLabels.length - 3} more` : ""}. No shortage notice on file; that isn&apos;t proof of stock.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="hq-q-a">{s19aTileDetail ? "Approved substitute available" : mine && localShortage ? "Ask the prescriber" : noData ? "Unknown" : "Not needed"}</div>
                    <div className="hq-q-d">
                      {s19aTileDetail ?? (mine && localShortage
                        ? supplyInMarket
                          ? "No other product of this medicine in the same form and strength is clear of a shortage notice. A different medicine is a prescriber decision."
                          : "We hold no registered substitute for this market. A different medicine is a prescriber decision."
                        : noData ? `We can't tell whether it's short in ${cName}.` : "No shortage substitution needed.")}
                      {topAlt && localShortage && (
                        <>
                          {" "}Same class (prescriber decision):{" "}
                          {topAlt.id != null ? <Link href={`/drugs/${topAlt.id}`}>{breakAtSlash(topAlt.name)}</Link> : breakAtSlash(topAlt.name)}
                          , a different medicine.
                        </>
                      )}
                    </div>
                  </>
                )}
                <a href="#alternatives" className="hq-more">See alternatives →</a>
              </div>
              <div className="hq-q">
                <div className="hq-q-l">What does it cost?</div>
                {concession ? (
                  <>
                    <div className="hq-q-a mono">{fmtPrice(concession.price, concession.currency)}</div>
                    <div className="hq-q-d">Price concession active{concession.pack ? ` · ${concession.pack}` : ""}, above the standard tariff.</div>
                  </>
                ) : heroPrice ? (
                  <>
                    <div className="hq-q-a mono">{fmtPrice(heroPrice.value, heroPrice.currency)}</div>
                    <div className="hq-q-d">{heroPrice.label === "AEMP" ? "PBS ex-manufacturer (AEMP)" : heroPrice.label}{heroPrice.extra ? ` · ${heroPrice.extra}` : ""}</div>
                  </>
                ) : (
                  <>
                    <div className="hq-q-a empty">Not on file</div>
                    <div className="hq-q-d empty">We don&apos;t hold an official price for {cName} yet.</div>
                  </>
                )}
                {formSlugSel && <div className="hq-q-d">Price is for the medicine, not the selected form.</div>}
                <a href="#trade-price" className="hq-more">Price details →</a>
              </div>
            </div>

            {(() => {
              const marketsShort = [
                ...(localShortage ? [{ cc: userCountry, sev: isCrit ? 2 : 1, mine: true }] : []),
                ...footprint.map((f) => ({ cc: f.cc, sev: f.sev, mine: false })),
              ];
              const n = marketsShort.length;
              return (
                <div className="hq-just">
                  {(() => {
                    // One line: the count, then the other markets by name.
                    // Full list on hover; per-market detail is in the Status tab.
                    const regionName = (cc: string) => {
                      if (COUNTRY[cc]) return COUNTRY[cc];
                      try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc; } catch { return cc; }
                    };
                    const others = marketsShort.filter((m) => !m.mine).map((m) => regionName(m.cc));
                    const shown = others.slice(0, 4);
                    return (
                      <div className="hq-just-l" title={others.length > shown.length ? others.join(", ") : undefined}>
                        Is it just us?{" "}
                        <strong>
                          {n === 0
                            ? "Not short in any market we track"
                            : localShortage
                              ? n === 1 ? `Only ${cName} so far` : `No, also short in ${n - 1} other countr${n - 1 === 1 ? "y" : "ies"}`
                              : noData
                                ? `No data for ${cName}; short in ${n} other market${n === 1 ? "" : "s"}`
                                : `Not short here, but short in ${n} other market${n === 1 ? "" : "s"}`}
                        </strong>
                        {shown.length > 0 && <>: {shown.join(", ")}{others.length > shown.length ? ` +${others.length - shown.length} more` : ""}</>}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* AI summary teaser: headline + first two lines, expandable in place */}
            <div className="hq-ai">
              <div className="hq-ai-l"><span className="hq-ai-badge" aria-hidden>AI</span>Mederti AI summary</div>
              <V1AiSummary id={id} embedded />
            </div>
          </div>
          </div>

          {brandFocus && (() => {
            const bf = brandFocus;
            const regsShown = bf.regs.slice(0, 8);
            const markets = [...new Set(bf.regs.map((r) => r.country).filter(Boolean))];
            const noticeMarkets = [...new Set(brandNotices.map((s) => (s.country_code || "").toUpperCase()))];
            return (
              <div className="brand-focus">
                <div className="bf-head">
                  <div>
                    <div className="bf-eyebrow">Brand of {drug.generic_name}</div>
                    <div className="bf-name">{bf.brand}</div>
                    <div className="alt-f">
                      {bf.regs.length} registration{bf.regs.length === 1 ? "" : "s"} on file
                      {markets.length ? ` · ${markets.map((c) => flag(c)).join(" ")}` : ""}
                    </div>
                  </div>
                  <a className="bf-clear" href={`/drugs/${id}`}>Show all brands ×</a>
                </div>

                <div className="bf-block">
                  <div className="bf-label">
                    Regulator notices naming {bf.brand}
                    {noticeMarkets.length > 0 && <span className="help"> · {noticeMarkets.map((c) => `${flag(c)} ${COUNTRY[c] ?? c}`).join(", ")}</span>}
                  </div>
                  {brandNotices.length === 0 ? (
                    <div className="bf-empty">
                      {brandLine && (userCountry === "AU" || userCountry === "CA")
                        ? <>{expSourceFor(userCountry)} lists shortages per registered product, and none of {bf.brand}&apos;s registrations is on its list today. Other brands of {drug.generic_name} may still be short; see the table below.</>
                        : <>No active notice names {bf.brand}. Many regulators publish at ingredient level, so a shortage of {drug.generic_name} below can still affect this brand.</>}
                    </div>
                  ) : (
                    <div className="country-list">
                      {brandNotices.slice(0, 6).map((s, i) => {
                        const anticip = (s.status || "").toLowerCase() === "anticipated";
                        const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
                        const back = monthYear(s.estimated_resolution_date);
                        return (
                          <div key={i} className="country-row">
                            <div style={{ minWidth: 0 }}>
                              <div className="cn">{flag(s.country_code)} {s.brand_name}</div>
                              <div className="alt-f">
                                {[s.sponsor, abbr(s.data_sources?.name, s.data_sources?.abbreviation), s.start_date ? `since ${monthYear(s.start_date)}` : null]
                                  .filter(Boolean).join(" · ")}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                              <span className={`status-pill ${anticip ? "sp-part" : r >= 2 ? "sp-crit" : "sp-part"}`}>
                                <span className="d" />
                                {anticip ? "Anticipated" : s.severity ? `${s.severity[0].toUpperCase()}${s.severity.slice(1)}` : "Shortage"}
                              </span>
                              <span className="alt-f">{back ? `back ~${back}` : "no return estimate"}</span>
                            </div>
                          </div>
                        );
                      })}
                      {brandNotices.length > 6 && <div className="alt-f">+{brandNotices.length - 6} more notices</div>}
                    </div>
                  )}
                </div>

                <div className="bf-block">
                  <div className="bf-label">Registrations</div>
                  <div className="bf-regs">
                    {regsShown.map((r, i) => (
                      <div key={i} className="bf-reg">
                        <span className="bf-reg-p">{flag(r.country)} {r.product}</span>
                        <span className="alt-f">
                          {[r.regNo, r.sponsor, r.source, r.status].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    ))}
                    {bf.regs.length > regsShown.length && (
                      <div className="alt-f">+{bf.regs.length - regsShown.length} more registrations</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {supplyAll && (supplyAll.forms.length > 1 || supplyAll.forms.some((f) => f.strengths.length > 1)) && (() => {
            // Form picker: links (server-rendered), so the choice lives in the
            // URL and can be bookmarked or shared. Dot: green none short, amber
            // some, red all.
            const base = `/drugs/${id}`;
            const qs = (form: string | null, strength: string | null) => {
              const q = new URLSearchParams();
              if (brandFocus) q.set("brand_focus", brandFocus.catId);
              // Keep the market the page is showing (#235): without it the
              // picker would fall back to the saved country cookie.
              q.set("market", userCountry);
              if (form) q.set("form", form);
              if (strength) q.set("strength", strength);
              const t = q.toString();
              return t ? `${base}?${t}` : base;
            };
            const tone = (affected: number, total: number, extra = 0) =>
              affected + extra === 0 ? "ok" : total > 0 && affected === total ? "crit" : "med";
            const allAffected = supplyAll.shortCount;
            const allUnmatched = supplyAll.forms.reduce((n, f) => n + f.unmatched, 0);
            const sel = supplyAll.forms.find((f) => f.slug === formSlugSel) ?? null;
            const count = (affected: number, total: number, disc = 0) =>
              // Quiet row: a count only where something is affected.
              affected === 0 ? ""
                : `${affected} of ${total} ${disc === affected ? "discontinued" : disc > 0 ? "affected" : "short"}`;
            return (
              <nav className="fpick" aria-label="Filter by form and strength">
                <div className="fpick-row">
                  <span className="fpick-l">Filter by form</span>
                  <Link href={qs(null, null)} className={`fpick-chip${!formSlugSel ? " on" : ""}`} aria-current={!formSlugSel ? "true" : undefined} scroll={false}>
                    <span className={`fpick-dot ${tone(allAffected, supplyAll.productCount, allUnmatched)}`} />All forms
                    <span className="fpick-n">{count(allAffected, supplyAll.productCount, supplyAll.discCount)}</span>
                  </Link>
                  {supplyAll.forms.map((f) => (
                    <Link key={f.slug} href={qs(f.slug, null)} className={`fpick-chip${formSlugSel === f.slug ? " on" : ""}`} aria-current={formSlugSel === f.slug ? "true" : undefined} scroll={false}>
                      <span className={`fpick-dot ${tone(f.affected, f.total, f.unmatched)}`} />{f.form}
                      <span className="fpick-n">{f.total > 0 ? count(f.affected, f.total, f.discontinued) : `${f.unmatched} notice${f.unmatched === 1 ? "" : "s"}`}</span>
                    </Link>
                  ))}
                </div>
                {sel && sel.strengths.length > 1 && (
                  <div className="fpick-row fpick-sub">
                    <span className="fpick-l">Strength</span>
                    <Link href={qs(sel.slug, null)} className={`fpick-chip${!strengthOn ? " on" : ""}`} scroll={false}>All strengths</Link>
                    {sel.strengths.map((st) => (
                      <Link key={st.strength} href={qs(sel.slug, st.strength)} className={`fpick-chip${strengthOn && strengthSel === st.strength ? " on" : ""}`} aria-current={strengthOn && strengthSel === st.strength ? "true" : undefined} scroll={false}>
                        <span className={`fpick-dot ${tone(st.affected, st.total)}`} />{st.strength}
                        <span className="fpick-n">{count(st.affected, st.total, st.discontinued)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </nav>
            );
          })()}
          <DrugTabs
            tabs={[
              {
                id: "status",
                label: "Status",
                badge: localShortage ? (anticipated ? "Anticipated" : discontinued ? "Market exit" : isCrit ? "Short" : "Limited") : noData ? "No data" : "In supply",
                badgeTone: localShortage ? (anticipated ? "med" : isCrit ? "crit" : "med") : noData ? "med" : "ok",
                content: (
            <>
          {/* Price-concession signal — promoted into the hero (Option B). A
              regulator reimbursing above tariff means pharmacies can't source
              at price: an early supply-pressure indicator that typically
              precedes a formal shortage. Only renders when a concession is
              live in the user's market, so non-concession drugs keep a clean
              hero. The detailed multi-market price panel stays further down. */}
          {concession && (
            <div className="conc-signal hero">
              <div className="conc-ic" aria-hidden>⚠</div>
              <div className="conc-body">
                <div className="conc-h">Price concession active — {flag(concession.country)} {COUNTRY[concession.country] ?? concession.country} · {monthYear(concession.effective_date)}</div>
                <div className="conc-d">
                  Reimbursement{concession.pack ? ` for ${concession.pack}` : ""} set at <b>{fmtPrice(concession.price, concession.currency)}</b>
                  {concession.tariff != null && concDelta != null ? (
                    <> — up from the {fmtPrice(concession.tariff, concession.currency)} Cat&nbsp;M tariff <span className="conc-delta">(+{concDelta}%)</span></>
                  ) : (
                    <> above the standard Drug Tariff price</>
                  )}
                  . Pharmacies can’t source at tariff price — an early supply-pressure signal that often precedes a formal shortage.
                </div>
                {shortCountries.length > 0 && (
                  <div className="conc-foot">
                    <span className="conc-foot-l">Already short in</span>
                    <span className="conc-foot-n">{shortCountries.length} {shortCountries.length === 1 ? "country" : "countries"}</span>
                    <span className="conc-foot-c">{shortCountries.slice(0, 12).map((c) => flag(c)).join(" ")}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Products affected — brand-level rows for the user's market.
              Pharmacists procure by brand: the exact product each notice
              covers, its sponsor, and its OWN return estimate. Events whose
              source reports at ingredient level only are labelled as such,
              never dressed up with the molecule's brand list. */}
          {/* Supply in the user's market — the job-first answer: which registered
              products are short here, which aren't, and when the short ones are
              expected back. Upstream (API makers) sits collapsed beneath it.
              Falls back to "Products affected" where we hold no register. */}
          {supplyInMarket && (
            <div className="sec" id="supply">
              <div className="sec-title">
                Supply in {cName}{" "}
                <span className="help">{supplyInMarket.productCount} registered product{supplyInMarket.productCount !== 1 ? "s" : ""} · {supplyInMarket.registerSource} × {supplyInMarket.noticeSource}</span>
              </div>
              <div className="sim">
                <div className="sim-ans">{supplyInMarket.answer}</div>
                <table className="sim-table">
                  <thead><tr><th>Product</th><th>Status</th><th className="sim-hide">Expected back</th></tr></thead>
                  <tbody>
                    {supplyInMarket.groups.map((g) => (
                      <Fragment key={g.form}>
                        <tr className="sim-form"><td colSpan={3}>{g.form}</td></tr>
                        {g.products.filter((p) => p.status !== "none").map((p) => (
                          // data-* lets the nightly scenario suite check every
                          // registration's status (the cell shows only two).
                          <tr key={p.name} data-regs={p.regNos.join("|")} data-status={p.status}>
                            <td>
                              <div className="sim-name">{p.name}</div>
                              <div className="alt-f">{[p.sponsor, p.regNos.slice(0, 2).join(", ") + (p.regNos.length > 2 ? ` +${p.regNos.length - 2}` : "")].filter(Boolean).join(" · ")}</div>
                            </td>
                            <td><SupplyPill status={p.status} since={p.since} history={p.history} discontinued={p.discontinued} /></td>
                            <td className="sim-hide"><BackCell status={p.status} back={p.back} passed={p.backPassed} url={p.sourceUrl} exitDate={p.discontinued ? p.exitDate : undefined} discontinued={p.discontinued} /></td>
                          </tr>
                        ))}
                        {g.notices.map((n, i) => (
                          <tr key={`n${i}`}>
                            <td>
                              <div className="sim-name">{n.label}</div>
                              <div className="alt-f">Notice not matched to a registered product</div>
                            </td>
                            <td><SupplyPill status={n.status} since={n.since} discontinued={n.discontinued} /></td>
                            <td className="sim-hide"><BackCell status={n.status} back={n.back} passed={n.backPassed} url={n.sourceUrl} discontinued={n.discontinued} /></td>
                          </tr>
                        ))}
                        {g.products.filter((p) => p.status === "none").map((p, pi) => (
                          <tr key={p.name} className={pi >= SIM_CLEAR_SHOWN ? "sim-extra" : undefined} data-regs={p.regNos.join("|")} data-status={p.status}>
                            <td>
                              <div className="sim-name">{p.name}</div>
                              <div className="alt-f">{[p.sponsor, p.regNos.slice(0, 2).join(", ") + (p.regNos.length > 2 ? ` +${p.regNos.length - 2}` : "")].filter(Boolean).join(" · ")}</div>
                            </td>
                            <td><SupplyPill status={p.status} since={p.since} history={p.history} discontinued={p.discontinued} /></td>
                            <td className="sim-hide"><BackCell status={p.status} back={p.back} passed={p.backPassed} url={p.sourceUrl} exitDate={p.discontinued ? p.exitDate : undefined} discontinued={p.discontinued} /></td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {(() => {
                  const extra = supplyInMarket.groups.reduce((n, g) => n + Math.max(0, g.products.filter((p) => p.status === "none").length - SIM_CLEAR_SHOWN), 0);
                  return extra > 0 || supplyInMarket.combosExcluded > 0 ? (
                    <>
                    {extra > 0 && <label className="sim-all">
                      <input type="checkbox" />
                      <span className="sim-show">Show {extra} more product{extra !== 1 ? "s" : ""} with no shortage reported</span>
                      <span className="sim-hidetxt">Show fewer</span>
                    </label>}
                    {supplyInMarket.combosExcluded > 0 && (
                      <div className="sim-note">{supplyInMarket.combosExcluded} combination product{supplyInMarket.combosExcluded !== 1 ? "s or notices" : " or notice"} (with another active ingredient) not shown here.</div>
                    )}
                    </>
                  ) : null;
                })()}
                <div className="sim-acts">
                  <a href="#alternatives" className="sim-btn primary">What to use instead</a>
                  <FindSupplier drugId={id} drugName={drug.generic_name} userCountry={userCountry} severity={sev} />
                  <WatchButton drugId={id} />
                </div>
                {supplyProfile && (() => {
                  const elsewhere = supplyProfile.shortCountries.filter((c) => c !== userCountry);
                  const peers = elsewhere.filter((c) => (PEER_GROUPS[userCountry] ?? []).includes(c));
                  return (
                    <div className="sim-ctx">
                      <span>{elsewhere.length ? `Also short in ${elsewhere.length} other countr${elsewhere.length === 1 ? "y" : "ies"}` : "Not short in other markets we track"}</span>
                      {peers.length > 0 && <span>Short in peer markets: {peers.join(", ")}</span>}
                      {(supplyProfile.whoList || supplyProfile.euCritical) && (
                        <span>{[supplyProfile.whoList ? "WHO essential" : null, supplyProfile.euCritical ? "EU critical" : null].filter(Boolean).join(" · ")}</span>
                      )}
                    </div>
                  );
                })()}
                {apiConcentration && (
                  <details className="sim-up">
                    <summary>
                      <span>Upstream supply base: <span className={`status-pill ${TIER_CLS[supplyTier]}`}><span className="d" />{TIER_LABEL[supplyTier]}</span> {apiConcentration.count} API maker{apiConcentration.count !== 1 ? "s" : ""}{apiConcentration.countries.length ? ` in ${apiConcentration.countries.slice(0, 4).join(", ")}` : ""}</span>
                      <span className="sim-more"><span className="sim-show">Show</span><span className="sim-hidetxt">Hide</span></span>
                    </summary>
                    <table className="attr-table sim-uptable"><tbody>
                      <tr><th scope="row">API makers</th><td>{apiConcentration.makers.join(", ")}{apiConcentration.count > apiConcentration.makers.length ? ` +${apiConcentration.count - apiConcentration.makers.length} more` : ""}</td></tr>
                      {supplyProfile?.nFinishedFirms != null && <tr><th scope="row">US finished-dose firms</th><td>{supplyProfile.nFinishedFirms}</td></tr>}
                      {supplyProfile?.topApiCountry && supplyProfile.topApiShare != null && <tr><th scope="row">Largest API country</th><td>{supplyProfile.topApiCountry}: {Math.round(supplyProfile.topApiShare * 100)}% of makers with a known country</td></tr>}
                      {(apiConcentration.whoPqCount ?? 0) > 0 && <tr><th scope="row">WHO-prequalified</th><td>{apiConcentration.whoPqCount}</td></tr>}
                      <tr><th scope="row">Sources</th><td className="attr-muted">FDA Drug Master Files, FDA DECRS, Drugs@FDA. US-centric; describes the supply base, doesn&apos;t forecast shortages.</td></tr>
                    </tbody></table>
                  </details>
                )}
              </div>
            </div>
          )}

          {!supplyInMarket && mineAll.length > 0 && (
            <div className="sec">
              <div className="sec-title">
                Products affected in {cName}{" "}
                <span className="help">one row per regulator notice</span>
              </div>
              <div className="country-list">
                {mineAll.slice(0, 12).map((s, i) => {
                  const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
                  const anticip = (s.status || "").toLowerCase() === "anticipated";
                  const cls = anticip ? "sp-part" : r >= 2 ? "sp-crit" : "sp-part";
                  const lbl = anticip
                    ? "Anticipated"
                    : `${(s.severity || "shortage")[0].toUpperCase()}${(s.severity || "hortage").slice(1)}`;
                  const back = monthYear(s.estimated_resolution_date);
                  const sku = s.brand_name ? skuByBrand.get(s.brand_name.toLowerCase()) : undefined;
                  return (
                    <div key={i} className="country-row">
                      <div className="cl">
                        <div>
                          <div className="cn">
                            {s.brand_name
                              ? sku
                                ? <a href={brandHref(id, sku.catId)}>{s.brand_name}</a>
                                : s.brand_name
                              : "Ingredient-level notice — brand not published"}
                          </div>
                          <div className="alt-f">
                            {[s.sponsor, abbr(s.data_sources?.name, s.data_sources?.abbreviation)]
                              .filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`status-pill ${cls}`}><span className="d" />{lbl}</span>
                        <span className="alt-f">
                          {back
                            ? `back ~${back}${s.brand_name ? "" : " (ingredient-level)"}`
                            : "no return estimate"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {mineAll.length > 12 && (
                  <div className="alt-f" style={{ padding: "6px 2px" }}>
                    +{mineAll.length - 12} more notices in {cName}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Regulator status */}
          {regulators.length > 0 && (
            <div className="sec">
              <div className="sec-title">Shortage status by regulator <span className="help">official notices</span></div>
              <div className="country-list">
                {regulators.map((s, i) => {
                  const cc = (s.country_code || "").toUpperCase();
                  const r = SEV[(s.severity || "").toLowerCase()] ?? 0;
                  const cls = (s.status || "").toLowerCase() === "resolved" ? "sp-ok" : r >= 2 ? "sp-crit" : "sp-part";
                  const lbl = (s.status || "").toLowerCase() === "resolved" ? "Resolved" : `${(s.severity || "shortage")[0].toUpperCase()}${(s.severity || "hortage").slice(1)}`;
                  return (
                    <div key={i} className="country-row">
                      <div className="cl"><span className="flag">{flag(cc)}</span><div><div className="cn">{COUNTRY[cc] ?? cc}</div><div className="alt-f">{abbr(s.data_sources?.name, s.data_sources?.abbreviation)} · {timeAgo(s.last_verified_at ?? s.updated_at)}</div></div></div>
                      <span className={`status-pill ${cls}`}><span className="d" />{lbl}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Where & when: one row per market, one bar per notice, by dose form */}
          {shortages.length > 0 && (
            <div className="sec">
              <div className="sec-title">Where and when <span className="help">each regulator notice, by market and dose form</span></div>
              <ShortageEpisodeTimeline drugId={id} />
            </div>
          )}

          {/* Timeline */}
          {events.length > 0 && (
            <div className="sec">
              <div className="sec-title">Verified timeline <span className="help">regulator events</span></div>
              <div className="timeline">
                {events.map((e, i) => (
                  <div key={i} className="tl-row">
                    <span className={`tl-d ${e.resolved ? "filled" : ""}`} />
                    <div><div className="tl-dt">{flag(e.cc)} {new Date(e.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div><div className="tl-ev">{e.txt}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!hasStatus && <div className="sec"><div className="alt-note">No regulator shortage notices on file for {drug.generic_name} in any market we track.</div></div>}
            </>
                ),
              },
              {
                id: "alternatives",
                label: "Alternatives",
                badge: sourcedAlternatives?.available && sourcedAlternatives.alternatives.length > 0 ? String(sourcedAlternatives.alternatives.length) : undefined,
                content: (
            <>
          {/* Substitution pathways (AU only) */}
          {userCountry === "AU" && (
            <div className="sec">
              <div className="sec-title">Substitution pathways <span className="help">🇦🇺 Australia · TGA</span></div>
              <div className="subpath">
                {eligMine.length > 0 ? (
                  eligMine.map((e, i) => {
                    const exp = monthYear(e.expires_at);
                    return (
                      <div className="subpath-row" key={e.scheme_reference ?? `${e.scheme}-${i}`}>
                        <div className="subpath-l">
                          <span className="subpath-ic ok">✓</span>
                          <div>
                            <div className="subpath-n">
                              {SCHEME_LABEL[e.scheme] ?? "Substitution instrument in force"}
                              {e.scheme_reference ? ` · ${e.scheme_reference}` : ""}
                            </div>
                            <div className="subpath-d">
                              {e.description || "TGA-approved overseas-registered product may be supplied during this shortage."}
                              {exp ? ` Expires ${exp}.` : ""}
                              {e.source_url ? (
                                <>
                                  {" "}
                                  <a href={e.source_url} target="_blank" rel="noopener noreferrer">
                                    Verify on {e.source_name || "TGA"} ↗
                                  </a>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="subpath-row">
                    <div className="subpath-l">
                      <span className={`subpath-ic ${s19aNotesText ? "ok" : "neutral"}`}>{s19aNotesText ? "✓" : "—"}</span>
                      <div>
                        <div className="subpath-n">{s19aNotesText ? "Section 19A approval in force" : "No substitution instrument in force"}</div>
                        <div className="subpath-d">{s19aNotesText || "Dispense per normal rules, or refer to the prescriber. No active SSSI/S19A instrument detected for this medicine."}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Source-backed alternatives — hidden entirely when the data isn't loaded */}
          {sourcedAlternatives?.available && <SourcedAlternativesSection alts={sourcedAlternatives.alternatives} country={userCountry} />}

          {/* Alternatives */}
          {alts.length > 0 && (
            <div className="sec">
              <div className="sec-title">Same-class drugs <span className="help">WHO ATC classification</span></div>
              <div className="alt-note" style={{ marginBottom: 8 }}>{ALTERNATIVES_CAVEAT}</div>
              <div className="alt-list">
                {alts.map((a, i) => {
                  const inner = (
                    <>
                      <div className="alt-main">
                        <div className="alt-n">{a.name}</div>
                        <div className="alt-f">{a.rel}</div>
                        {a.note && <div className="alt-note">{a.note}</div>}
                      </div>
                      {affinity(a.pct) && (
                        <div className="alt-match">
                          <div className="alt-pct">{affinity(a.pct)}</div>
                        </div>
                      )}
                    </>
                  );
                  return a.id != null ? (
                    <Link key={i} href={`/drugs/${a.id}`} className="alt-card alt-rich alt-link">
                      {inner}
                    </Link>
                  ) : (
                    <div key={i} className="alt-card alt-rich">{inner}</div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cost vs alternatives — like-for-like, to answer "which alternative
              is close in price and which is dramatically more expensive". Only
              rows priced on the SAME basis + currency + price_type are compared;
              anything else is listed as "no comparable price". */}
          {altPricing && altPricing.alternatives.some((a) => a.comparable) && (() => {
            const cur = altPricing.currency;
            const money = (v: number) => fmtPrice(v, cur);
            // Real prices may be a range across strengths/packs → show both ends.
            const priceText = (r: { value: number | null; min: number | null; max: number | null }) =>
              r.value == null ? "—"
                : r.min != null && r.max != null && r.max - r.min > 0.005
                  ? `${money(r.min)}–${money(r.max)}`
                  : money(r.value);
            const multiple = (ratio: number) =>
              ratio >= 1.25 ? `~${ratio >= 9.5 ? Math.round(ratio) : ratio.toFixed(1)}×`
                : ratio <= 0.8 ? `−${Math.round((1 - ratio) * 100)}%` : "≈";
            return (
              <div className="sec">
                <div className="sec-title">
                  Cost vs alternatives{" "}
                  <span className="help">{altPricing.priceTypeLabel} · {altPricing.basisLabel} · {cName}</span>
                </div>
                <div className="cmp-list">
                  {/* Anchor row = this medicine, the baseline everything compares to. */}
                  <div className="cmp-row cmp-anchor">
                    <div className="cmp-name">{truncateDrugName(altPricing.anchor.name)} <span className="cmp-tag">this medicine</span></div>
                    <div className="cmp-price">{priceText(altPricing.anchor)}</div>
                    <div className="cmp-band"><span className="cmp-pill cmp-base">baseline</span></div>
                  </div>
                  {altPricing.alternatives.map((a, i) => (
                    <div key={i} className="cmp-row">
                      <div className="cmp-name">
                        {a.drug_id !== altPricing.anchor.drug_id
                          ? <a href={`/drugs/${a.drug_id}`}>{truncateDrugName(a.name)}</a>
                          : truncateDrugName(a.name)}
                        {a.relationship && <span className="cmp-rel">{relationshipLabel(a.relationship)}</span>}
                      </div>
                      {a.comparable ? (
                        <>
                          <div className="cmp-price">{priceText(a)}</div>
                          <div className="cmp-band">
                            {a.ratio != null && <span className="cmp-mult">{multiple(a.ratio)}</span>}
                            <span className={`cmp-pill band-${a.band}`}>{a.band ? BAND_LABEL[a.band] : ""}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="cmp-price cmp-muted">—</div>
                          <div className="cmp-band"><span className="cmp-pill cmp-na">no comparable price</span></div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="stat-foot">
                  Like-for-like {altPricing.basisLabel} prices in {cName}; a specific brand or pack may differ. Not a clinical equivalence claim — confirm suitability before substituting.
                </div>
              </div>
            );
          })()}

          <ParallelTradeSourcing drugId={id} userCountry={userCountry} />
          {!hasAlts && <div className="sec"><div className="alt-note">No substitution instruments, source-backed alternatives or same-class drugs on file for this medicine. Refer to the prescriber.</div></div>}
            </>
                ),
              },
              {
                id: "prices",
                label: "Prices",
                content: (
            <>
          {/* Trade price — adaptive panel. AU shows the PBS tiers (AEMP/DPMQ);
              other markets show their headline official price from
              drug_pricing_history. Cross-references other markets we hold.
              Degrades to a visible "awaiting ingest" note. Never fabricates. */}
          <div className="sec" id="trade-price">
            <div className="sec-title">Trade price <span className="help">{pricing ? `${flag(userCountry)} ${pricing.source}${pricing.price_date ? ` · ${monthYear(pricing.price_date)}` : ""}` : myMarket && myMarket.value != null ? `${flag(userCountry)} ${myMarket.source ?? cName}${myMarket.effective_date ? ` · ${monthYear(myMarket.effective_date)}` : ""}` : `${flag(userCountry)} ${cName} · awaiting price ingest`}</span></div>
            <div className="price-panel">
              <div className="price-top">
                <div className="market-tabs"><span className="mtab on">{flag(userCountry)} {userCountry}</span></div>
                {(pricing || (myMarket && myMarket.value != null)) && <span className="reimb">● Official price on file</span>}
              </div>
              {pricing ? (
                <>
                  <div className="price-tiles">
                    <div className="ptile"><div className="ptile-l">Ex-manufacturer</div><div className="ptile-v">{fmtPrice(pricing.ex_manufacturer, pricing.currency)}</div><div className="ptile-sub">AEMP</div></div>
                    <div className="ptile"><div className="ptile-l">Dispensed (DPMQ)</div><div className="ptile-v">{pricing.dispensed != null ? fmtPrice(pricing.dispensed, pricing.currency) : "—"}</div><div className="ptile-sub">incl. fees</div></div>
                    <div className="ptile"><div className="ptile-l">Pack</div><div className="ptile-v sm">{pricing.pack ?? "—"}</div>{drugForm ? <div className="ptile-sub">{drugForm}</div> : null}</div>
                  </div>
                  <div className="price-foot"><span>Source: {pricing.source}</span><span>{[monthYear(pricing.price_date) ? `Effective ${monthYear(pricing.price_date)}` : null, pricing.currency].filter(Boolean).join(" · ")}</span></div>
                </>
              ) : myMarket && myMarket.value != null ? (
                <>
                  <div className="price-tiles two">
                    <div className="ptile"><div className="ptile-l">{myMarket.label}</div><div className="ptile-v">{fmtPrice(myMarket.value, myMarket.currency)}</div><div className="ptile-sub">{myMarket.per}</div></div>
                    <div className="ptile"><div className="ptile-l">{myMarket.concession != null ? "Concession" : "Pack"}</div>{myMarket.concession != null ? (<><div className="ptile-v" style={{ color: "var(--med)" }}>{fmtPrice(myMarket.concession, myMarket.currency)}</div><div className="ptile-sub">live uplift</div></>) : (<><div className="ptile-v sm">{myMarket.per}</div>{drugForm ? <div className="ptile-sub">{drugForm}</div> : null}</>)}</div>
                  </div>
                  <div className="price-foot"><span>Source: {myMarket.source ?? "official"}</span><span>{[monthYear(myMarket.effective_date) ? `Effective ${monthYear(myMarket.effective_date)}` : null, myMarket.currency].filter(Boolean).join(" · ")}</span></div>
                </>
              ) : (
                <>
                  <div className="price-tiles">
                    <div className="ptile"><div className="ptile-l">Ex-manufacturer</div><div className="ptile-v empty">—</div></div>
                    <div className="ptile"><div className="ptile-l">Dispensed (DPMQ)</div><div className="ptile-v empty">—</div></div>
                    <div className="ptile"><div className="ptile-l">Pack</div><div className="ptile-v empty">—</div></div>
                  </div>
                  <div className="price-empty-note">
                    <div className="pe-ic" aria-hidden>$</div>
                    <div>
                      <div className="pe-t">Not yet captured for {cName}</div>
                      <div className="pe-d">Official pricing isn’t on file for this market yet. PBS (Australia), NHS Drug Tariff (United Kingdom) and CMS NADAC (United States) feeds are prioritised; this panel populates automatically once the data lands.</div>
                    </div>
                  </div>
                </>
              )}
              {otherMarkets.length > 0 && (
                <div className="xmkt-strip">
                  <div className="xmkt-lbl">Other markets</div>
                  <div className="xmkt-row">
                    {otherMarkets.map((m) => (
                      <div className="xmkt" key={m.country}>
                        <div className="xmkt-c">{flag(m.country)} {m.country}</div>
                        <div className="xmkt-v">{m.concession != null ? fmtPrice(m.concession, m.currency) : m.value != null ? fmtPrice(m.value, m.currency) : "—"}</div>
                        <div className="xmkt-t">{m.concession != null ? "concession" : m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Price trend + forecast — self-gating: renders nothing when the
              market has no price history, history-only when the series can't
              be forecast, and a Holt projection only when it clears a backtest.
              (concession + drug_tariff history from drug_pricing_history.) */}
          {(myMarket || otherMarkets.length > 0) && (
            <div className="sec">
              <div className="price-panel" style={{ padding: "18px 20px" }}>
                <PriceTrendChart drugId={id} country={userCountry} />
              </div>
            </div>
          )}

          <ParallelTradeArbitrage drugId={id} destination={userCountry} />
            </>
                ),
              },
              {
                id: "outlook",
                label: "Supply outlook",
                content: (
            <>
          <div className="sec tab-intro">
            <div className="subpath"><div className="subpath-row"><div className="subpath-l"><span className="subpath-ic neutral">i</span><div>
              <div className="subpath-n">Evidence, not a forecast</div>
              <div className="subpath-d">How past shortages of {drug.generic_name} played out, how concentrated its manufacturing base is, and recent recalls. Mederti doesn&apos;t publish a shortage probability: when we backtested one, it didn&apos;t beat a simple baseline.</div>
            </div></div></div></div>
          </div>
          {/* Shortage trend for this molecule, every market (range-selectable) */}
          {shortages.length > 0 && (
            <div className="sec">
              <div className="sec-title">Shortage history <span className="help">new &amp; open notices across all markets we track</span></div>
              <ShortageTrendChart drugId={id} defaultRange="MAX" />
            </div>
          )}

          {/* History */}
          {history && (
            <div className="sec">
              <div className="sec-title">How long have past shortages lasted? <span className="help">from {history.n} resolved event{history.n > 1 ? "s" : ""}</span></div>
              <div className="subpath"><div className="subpath-row"><div className="subpath-l"><span className="subpath-ic neutral">◷</span><div>
                <div className="subpath-n">{history.lo === history.hi ? `~${history.lo} month${history.lo > 1 ? "s" : ""}` : `${history.lo}–${history.hi} months`}</div>
                <div className="subpath-d">Historical pattern from resolved shortage records — not a prediction of this event.</div>
              </div></div></div></div>
            </div>
          )}

          {/* API supply-base concentration (FDA Drug Master Files) */}
          {apiConcentration && (
            <div className="sec">
              <div className="sec-title">Global API supply base <span className="help">🇺🇸 FDA Drug Master Files · active Type II</span></div>
              <div className="conc">
                <div className="conc-head">
                  <div>
                    <div className="conc-n">{apiConcentration.count} API manufacturer{apiConcentration.count !== 1 ? "s" : ""}</div>
                    <div className="conc-d">Manufacturers with an active Type II Drug Master File — i.e. cleared to supply this active ingredient into the US market. A proxy for how concentrated the global manufacturing base is.</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span className={`status-pill ${TIER_CLS[supplyTier]}`}><span className="d" />{TIER_LABEL[supplyTier]} supply</span>
                    {(apiConcentration.whoPqCount ?? 0) > 0 && (
                      <span className="who-pq-badge">✓ {apiConcentration.whoPqCount} WHO-prequalified</span>
                    )}
                  </div>
                </div>
                {apiConcentration.makers.length > 0 && (
                  <div className="conc-makers">
                    {apiConcentration.makers.map((m) => <span key={m} className="d-tag">{m}</span>)}
                    {apiConcentration.count > apiConcentration.makers.length && (
                      <span className="d-tag">+{apiConcentration.count - apiConcentration.makers.length} more</span>
                    )}
                  </div>
                )}
                {supplyProfile && (
                  <div className="conc-d" style={{ marginTop: 10 }}>
                    {[
                      supplyProfile.whoList ? `WHO Model List (${supplyProfile.whoList})` : null,
                      supplyProfile.euCritical ? "EU Union list of critical medicines" : null,
                      supplyProfile.nFinishedFirms != null ? `${supplyProfile.nFinishedFirms} US finished-dose firm${supplyProfile.nFinishedFirms !== 1 ? "s" : ""}` : null,
                      supplyProfile.topApiCountry && supplyProfile.topApiShare != null
                        ? `${Math.round(supplyProfile.topApiShare * 100)}% of API makers in ${supplyProfile.topApiCountry}`
                        : null,
                      `all ${supplyProfile.molecule.toLowerCase()} products short in ${supplyProfile.shortCountries.length} countr${supplyProfile.shortCountries.length === 1 ? "y" : "ies"} now`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="conc-foot">
                  {apiConcentration.countries.length > 0
                    ? `Manufacturing countries: ${apiConcentration.countries.join(", ")} · `
                    : "Country of manufacture not yet mapped · "}
                  Source: FDA List of Drug Master Files
                </div>
              </div>
            </div>
          )}

          {/* FDA approval footprint — market depth (generic competition) */}
          {approvalFootprint && (
            <div className="sec">
              <div className="sec-title">FDA-approved products <span className="help">🇺🇸 Drugs@FDA</span></div>
              <div className="stat-row">
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.total}</div>
                  <div className="stat-l">Approved applications</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.generics}</div>
                  <div className="stat-l">Generic (ANDA)</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{approvalFootprint.brands}</div>
                  <div className="stat-l">Brand (NDA/BLA)</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-v">{monthYear(approvalFootprint.latest) ?? "—"}</div>
                  <div className="stat-l">Latest approval</div>
                </div>
              </div>
              {approvalFootprint.generics > 0 && (
                <div className="stat-foot">{approvalFootprint.generics} approved generic{approvalFootprint.generics !== 1 ? "s" : ""} — more competitors generally means a more resilient supply.</div>
              )}
            </div>
          )}

          {/* Recalls */}
          {recallList.length > 0 && (
            <div className="sec">
              <div className="sec-title">Recalls <span className="help">official enforcement reports</span></div>
              <div className="country-list">
                {recallList.map((r, i) => {
                  const cc = (r.country_code || "").toUpperCase();
                  const isClassI = (r.recall_class || "").toString().replace(/class\s*/i, "").trim() === "I";
                  const active = (r.status || "").toLowerCase() !== "terminated" && (r.status || "").toLowerCase() !== "completed";
                  const cls = isClassI && active ? "sp-crit" : "sp-part";
                  return (
                    <div key={i} className="country-row">
                      <div className="cl">
                        <span className="flag">{flag(cc)}</span>
                        <div>
                          <div className="cn">{r.brand_name || r.generic_name || "Recall"}</div>
                          <div className="alt-f">{[r.manufacturer, monthYear(r.announced_date)].filter(Boolean).join(" · ") || "—"}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`status-pill ${cls}`}><span className="d" />Class {(r.recall_class || "?").toString().replace(/class\s*/i, "").trim() || "?"}</span>
                        {r.press_release_url && <a className="src-link" href={r.press_release_url} target="_blank" rel="noopener noreferrer">details ↗</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!hasOutlook && <div className="sec"><div className="alt-note">No shortage history, supply-base or recall records on file for this medicine yet.</div></div>}
            </>
                ),
              },
              {
                id: "info",
                label: "Product info",
                content: (
            <>
          {/* Product attributes — detailed 2-column reference table */}
          {attrRows.length > 0 && (
            <div className="sec">
              <div className="sec-title">Product attributes <span className="help">reference data we hold</span></div>
              <div className="attr-wrap">
                <table className="attr-table">
                  <tbody>
                    {attrRows.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        <td className={r.muted ? "attr-muted" : undefined}>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Registration record — drug_products + MA holders */}
          {regRows.length > 0 && (
            <details className="record" open>
              <summary className="record-sum">
                <span className="record-title">Registration record</span>
                <span className="record-meta">marketing-authorisation holders</span>
                <span className="record-chev" aria-hidden>▾</span>
              </summary>

              {regRows.length > 0 && (
                <div className="record-block">
                  <div className="record-h">
                    Registrations &amp; marketing-authorisation holders
                    <span className="help">
                      {regRows.length} registration{regRows.length !== 1 ? "s" : ""}
                      {maHolders.length > 0 ? ` · ${maHolders.length} MA holder${maHolders.length !== 1 ? "s" : ""}` : ""}
                    </span>
                  </div>
                  <div className="reg-wrap">
                    <table className="reg-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Strength</th>
                          <th>Form</th>
                          <th>Market</th>
                          <th>MA holder</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regShown.map((p, i) => (
                          <tr key={i}>
                            <td className="reg-name">{p.name}</td>
                            <td>{p.strength ?? "—"}</td>
                            <td>{p.form ?? "—"}</td>
                            <td>{p.country ? `${flag(p.country)} ${p.country}` : "—"}</td>
                            <td>{p.sponsor ?? "—"}</td>
                            <td>{p.status ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {regRest > 0 && <div className="reg-foot">+{regRest} more registration{regRest !== 1 ? "s" : ""} on file</div>}
                </div>
              )}
            </details>
          )}

          <ParallelTradePanel drugId={id} />
          {!hasInfo && <div className="sec"><div className="alt-note">No product attributes or registrations on file for this medicine yet.</div></div>}
            </>
                ),
              },
              {
                id: "community",
                label: "Community",
                badge: "Soon",
                content: (
            <div className="sec">
              <div className="sec-title">Community <span className="help">field reports from pharmacists</span></div>
              <div className="subpath"><div className="subpath-row"><div className="subpath-l"><span className="subpath-ic neutral">◷</span><div>
                <div className="subpath-n">Coming soon: is it just you?</div>
                <div className="subpath-d">Verified pharmacists will be able to report what they&apos;re seeing at the counter and with wholesalers, kept separate from official regulator data. Until then, official notices are on the Status tab. Seeing a shortage we haven&apos;t listed? <a href="/contact">Tell us</a>.</div>
              </div></div></div></div>
            </div>
                ),
              },
            ]}
          />

          {/* Sources */}
          {sources.length > 0 && (
            <div className="sec">
              <div className="sec-title">Sources <span className="help">official regulators</span></div>
              <div className="src-list">
                {sources.map((s, i) => (
                  <div key={i} className="src-item">
                    <div className="src-l"><span className="flag">{flag(s.cc)}</span><div><div className="src-n">{s.a}</div><div className="alt-f">verified {timeAgo(s.ver) || "recently"}</div></div></div>
                    {s.url && <a className="src-link" href={s.url} target="_blank" rel="noopener noreferrer">verify ↗</a>}
                  </div>
                ))}
              </div>
            </div>
          )}


          <V1ReportActions generatedLabel={generatedLabel} marketLabel={marketLabel} sourceCount={sources.length} />

          <div className="sec"><ClinicalDisclaimer /></div>
    </AppShell>
  );
}

// The same verbatim statement can back several listings (e.g. one WHO
// Committee sentence under two indications): quote it once, list each source.
// Order: the viewer's own jurisdiction first (that's where a legal instrument
// actually applies), then other legal instruments, then guidance/references.
const AUTH_RANK: Record<string, number> = { regulator_legal: 0, regulator_guidance: 1, clinical_reference: 2 };
function rankCitations(cites: AlternativeCitation[], country: string): AlternativeCitation[] {
  return [...cites].sort((a, b) =>
    Number(b.country_code === country) - Number(a.country_code === country) ||
    (AUTH_RANK[a.authority_type] ?? 9) - (AUTH_RANK[b.authority_type] ?? 9));
}

function groupByStatement(cites: AlternativeCitation[]): { statement: string; refs: AlternativeCitation[] }[] {
  const groups = new Map<string, AlternativeCitation[]>();
  for (const c of cites) {
    const k = `${c.publisher}|${c.statement}|${c.dose_statement ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.values()].map((refs) => ({ statement: refs[0].statement, refs }));
}

// Source-backed alternatives: status first, then every supporting statement,
// verbatim and linked. single_source is labelled as exactly that.
function SourcedAlternativesSection({ alts, country }: { alts: SourcedAlternative[]; country: string }) {
  return (
    <div className="sec" id="alternatives">
      <div className="sec-title">Alternatives with sources <span className="help">regulator instruments &amp; published lists</span></div>
      {alts.length === 0 ? (
        <div className="alt-note">No source-backed alternatives on file for this medicine.</div>
      ) : (
        <div className="alt-list">
          {alts.map((a) => (
            <div key={`${a.alternative_drug_id}-${a.kind}`} className="alt-card alt-rich sa-card">
              <div className="alt-main">
                <div className="sa-head">
                  {a.same_drug
                    ? <span className="alt-n sa-name">Other products of {a.name}</span>
                    : <Link href={`/drugs/${a.alternative_drug_id}`} className="alt-n sa-name">{a.name}</Link>}
                  <span className={`sa-badge sa-${a.status}`}>{a.status_label}</span>
                </div>
                <div className="alt-f">{a.kind === "same_molecule" ? "Same medicine — another product" : "Different medicine — prescriber decision"}</div>
                <ul className="sa-cites">
                  {groupByStatement(rankCitations(a.citations, country)).slice(0, 4).map((g, i) => (
                    <li key={i}>
                      {g.refs.map((c, j) => (
                        <div key={j}>
                          <a href={c.source_url} target="_blank" rel="noopener noreferrer">{SOURCE_LABELS[c.source_code] ?? c.publisher}</a>
                          {c.country_code ? ` · ${c.country_code}` : ""}
                          {c.indication ? ` · ${c.indication}` : ""}
                          {c.valid_until ? ` · valid until ${c.valid_until}` : ""}
                          {c.alternative_product ? <div className="sa-prod">{c.alternative_product}</div> : null}
                        </div>
                      ))}
                      <blockquote className="sa-quote">{g.statement}</blockquote>
                      {g.refs[0].dose_statement ? <div className="sa-prod">Dose per source: {g.refs[0].dose_statement}</div> : null}
                    </li>
                  ))}
                </ul>
                {groupByStatement(a.citations).length > 4 ? (
                  <div className="alt-note">+ {groupByStatement(a.citations).length - 4} more source statements</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CSS = `
.sa-card{display:block}
.sa-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:2px}
.sa-name{text-decoration:none;color:var(--ink)}
.sa-name:hover{text-decoration:underline}
.sa-badge{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid var(--border);color:var(--text-3);background:var(--bg-3)}
.sa-regulator_authorised,.sa-verified{color:var(--green);border-color:var(--green)}
.sa-cites{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-3)}
.sa-cites a{color:var(--green)}
.sa-quote{margin:4px 0 0;padding-left:10px;border-left:2px solid var(--border);font-size:11.5px;line-height:1.45;color:var(--text-3)}
.sa-prod{font-size:11.5px;color:var(--text-2);margin-top:2px}
/* Tuned design system: this surface's scoped token block now mirrors the
   global tuned palette (globals.css :root) and uses Geist. Kept component-
   local because V1DrugView was authored as a self-contained surface. */
.v1home .d-name,.v1home .sc-title,.v1home .sec-title,.v1home .chat-title{font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;font-weight:600;letter-spacing:-.03em}
.v1home{--ink:var(--navy);--green:var(--teal);--green-d:var(--teal-l);--green-bg:var(--acc-soft);--green-b:#C6F3E6;--grad-soft:linear-gradient(135deg,#34d399,#0fa676 45%,#0c1118 120%);--grad-brand:linear-gradient(135deg,#0c1118,#0c3a30 48%,#34d399);
  --violet:#6366f1;--violet-b:#c7d2fe;--bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:var(--navy);--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;--crit:#dc2647;--crit-b:#f8cdd6;--med:#b46708;--med-b:#f3dcae;--ok:#0fa676;--ok-bg:#e8f6f0;--ok-b:#bce4d4;--crit-bg:#fdeef1;--med-bg:#fdf6e9;
  --hi-inset:inset 0 1px 0 rgba(255,255,255,.7);--sh-card:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06);--sh-pop:0 2px 4px rgba(12,17,24,.05),0 12px 28px -10px rgba(12,17,24,.16);
  background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:31px;width:auto;display:block}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none}
.home-nav{position:sticky;top:0;z-index:50;height:58px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.nav-actions{display:flex;gap:10px;align-items:center}
.shell{display:flex;align-items:flex-start;min-height:100vh}
.shell-main{flex:1;min-width:0}
.v1app.v1drug .dg-main{flex:1;min-width:0;max-width:none;padding:18px 48px 80px;width:100%;background:#eef1f5}
.dsearch{display:flex;align-items:center;gap:8px;margin:18px 0 0;background:var(--bg);border:1.5px solid var(--border-2);border-radius:12px;padding:5px 6px 5px 14px;transition:.15s}
.dsearch:focus-within{border-color:var(--green);box-shadow:0 8px 24px -16px rgba(15,166,118,.4)}
.dsearch-ic{color:var(--text-4);font-size:16px}
.dsearch input{flex:1;border:none;outline:none;background:transparent;font-size:15px;font-family:inherit;color:var(--text);padding:9px 0}
.dsearch input::placeholder{color:var(--text-4)}
.dsearch button{background:var(--green);color:#fff;border:none;padding:9px 16px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}
.dsearch button:hover{background:var(--green-d)}
.d-head-row{display:flex;align-items:flex-start;gap:20px;padding:16px 0 0}
.d-identity{flex:1;min-width:0}
/* Product identity card */
.product-card{display:flex;align-items:flex-start;gap:22px;margin-top:16px;padding:22px;border:1px solid var(--border);border-radius:18px;background:linear-gradient(150deg,var(--bg),var(--bg-2) 130%);box-shadow:var(--sh-card),var(--hi-inset)}
.pc-body{flex:1;min-width:0}
.pc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.pc-titles{min-width:0}
.pc-head .status-pill{flex-shrink:0;margin-top:4px}
.pc-badges{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pc-badges:empty{display:none}
.product-card .d-eml{margin-top:12px}
.d-ctrl{display:inline-flex;align-items:center;margin-top:12px;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--med-bg);color:var(--med);border:1px solid var(--med-b)}
.product-card .d-tags{margin-top:13px}
.pc-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--border)}
.pc-fact{background:var(--bg);padding:11px 14px}
.pc-fact-l{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-4);margin-bottom:4px}
.pc-fact-v{font-size:13px;font-weight:600;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace;line-height:1.3;word-break:break-word}
@media(max-width:680px){.product-card{flex-direction:column;align-items:stretch;gap:16px}.pc-facts{grid-template-columns:repeat(2,1fr)}.pc-head{flex-direction:column}.pc-head .status-pill{margin-top:0}}
.d-img{position:relative;flex-shrink:0;width:128px;height:128px;border-radius:16px;overflow:hidden;border:1px solid var(--border);background:#fff;padding:0;cursor:zoom-in;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px -10px rgba(12,17,24,.25);transition:.15s}
.d-img:hover{border-color:var(--green);box-shadow:0 10px 28px -14px rgba(15,166,118,.4)}
.d-img img{width:100%;height:100%;object-fit:contain;display:block;transition:opacity .3s}
.d-img-src{position:absolute;bottom:0;left:0;right:0;font-size:8px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-4);background:rgba(255,255,255,.86);backdrop-filter:blur(2px);padding:3px 0;text-align:center;border-top:1px solid var(--border)}
.d-img-skeleton{cursor:default;background:linear-gradient(100deg,var(--bg-3) 30%,var(--bg) 50%,var(--bg-3) 70%);background-size:200% 100%;animation:d-img-shimmer 1.3s ease-in-out infinite}
@keyframes d-img-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media(max-width:640px){.d-img{width:96px;height:96px;border-radius:13px}}
.d-name{font-size:30px;font-weight:700;letter-spacing:-.032em;line-height:1.1}
.d-generic{font-size:13px;color:var(--text-3);margin-top:5px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.d-localcode{font-size:12px;color:var(--text-3);margin-top:3px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.d-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.d-tag{font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.d-eml{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b);text-decoration:none;width:fit-content}
.d-eml:hover{background:#dcfce7}
.d-eml-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.status-card{margin:18px 0 0;border-radius:18px;padding:20px;box-shadow:var(--sh-card),var(--hi-inset);}
/* Trade-price panel — adaptive: tiers + market chip + footer, degrades to empty */
.price-panel{border:1px solid var(--border);border-radius:16px;background:var(--bg);box-shadow:var(--sh-card),var(--hi-inset);overflow:hidden}
.price-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;border-bottom:1px solid var(--border);background:var(--bg-2)}
.market-tabs{display:flex;gap:6px}
.mtab{font-size:12px;font-weight:600;padding:5px 11px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text-3)}
.mtab.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.reimb{font-size:10.5px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 9px;border-radius:99px}
.price-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border)}
.ptile{background:var(--bg);padding:16px 18px}
.ptile-l{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4);margin-bottom:6px}
.ptile-v{font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace;line-height:1.1}
.ptile-v.sm{font-size:15px;font-weight:600;color:var(--text-2)}
.ptile-v.empty{color:var(--border-2);font-weight:600}
.ptile-sub{font-size:10.5px;color:var(--text-4);margin-top:4px}
.price-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 18px;border-top:1px solid var(--border);font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
.price-empty-note{display:flex;gap:13px;align-items:flex-start;padding:14px 18px;background:var(--bg-2);border-top:1px dashed var(--border-2)}
.pe-ic{width:30px;height:30px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;background:var(--bg-3);color:var(--text-4);border:1px solid var(--border);font-family:var(--font-geist-mono),ui-monospace,monospace}
.pe-t{font-size:13px;font-weight:600;color:var(--text-2)}
.pe-d{font-size:11.5px;color:var(--text-4);line-height:1.5;margin-top:3px;max-width:560px}
.price-tiles.two{grid-template-columns:repeat(2,1fr)}
@media(max-width:560px){.price-tiles{grid-template-columns:repeat(2,1fr)}}
/* Price-concession signal — amber supply-pressure banner above the price card */
.conc-signal{display:flex;gap:12px;align-items:flex-start;margin:18px 0 0;padding:14px 16px;border:1px solid var(--med-b);border-radius:14px;background:var(--med-bg)}
.conc-signal.hero{margin-top:12px}
/* Compact hero price line */
.price-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 0;padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2)}
.ps-mkt{font-size:12px;font-weight:600;color:var(--text-3)}
.ps-label{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-4)}
.ps-val{font-size:18px;font-weight:700;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace;letter-spacing:-.02em}
.ps-extra{font-size:12px;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace}
.ps-more{margin-left:auto;font-size:11.5px;font-weight:600;color:var(--green-d);text-decoration:none}
.ps-more:hover{text-decoration:underline}
.conc-ic{flex-shrink:0;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:var(--med);background:#fff;border:1px solid var(--med-b)}
.conc-h{font-size:13.5px;font-weight:700;color:var(--med);letter-spacing:-.01em}
.conc-d{font-size:12.5px;color:var(--text-2);line-height:1.55;margin-top:4px}
.conc-d b{font-weight:700;color:var(--ink)}
.conc-delta{font-weight:700;color:var(--med)}
.conc-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px}
.conc-foot-l{font-size:11px;color:var(--text-3)}
.conc-foot-n{font-size:11px;font-weight:700;color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b);padding:2px 8px;border-radius:99px}
.conc-foot-c{font-size:12px;letter-spacing:1px}
/* Cross-border footprint — affected OTHER markets inline on the status eyebrow */
.sc-label{flex-wrap:wrap;row-gap:7px}
.sc-label-t{display:inline-flex;align-items:center;gap:6px}
.sc-foot-flags{display:inline-flex;gap:5px;flex-wrap:wrap;align-items:center;margin-left:2px}
.scs-c{font-size:11px;font-weight:700;color:var(--text-3);background:var(--bg);border:1px solid var(--border);padding:2px 7px;border-radius:7px;white-space:nowrap;text-transform:none;letter-spacing:0}
.scs-c.major{color:var(--text);border-color:var(--border-2)}
.scs-c.crit{color:var(--crit);border-color:var(--crit-b);background:var(--crit-bg)}
.scs-more{font-size:11px;font-weight:700;color:var(--text-4);text-transform:none;letter-spacing:0}
/* Cross-reference markets strip inside the price panel */
.xmkt-strip{border-top:1px solid var(--border);padding:11px 18px;background:var(--bg-2)}
.xmkt-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4);margin-bottom:8px}
.xmkt-row{display:flex;gap:8px;flex-wrap:wrap}
.xmkt{flex:1;min-width:96px;border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:8px 11px}
.xmkt-c{font-size:11px;font-weight:600;color:var(--text-3)}
.xmkt-v{font-size:15px;font-weight:700;color:var(--ink);font-family:var(--font-geist-mono),ui-monospace,monospace;letter-spacing:-.02em;margin-top:2px}
.xmkt-t{font-size:10px;color:var(--text-4);margin-top:1px}
.status-card.crit{background:linear-gradient(135deg,#fff5f6,#fff1f3);border:1px solid var(--crit-b)}
.status-card.med{background:linear-gradient(135deg,#fffdf5,#fffbeb);border:1px solid var(--med-b)}
.status-card.ok{background:linear-gradient(135deg,#f0fdf8,#ecfdf5);border:1px solid var(--ok-b)}
.sc-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;margin-bottom:7px;display:flex;align-items:center;gap:7px}
.status-card.crit .sc-label{color:var(--crit)}.status-card.med .sc-label{color:var(--med)}.status-card.ok .sc-label{color:var(--ok)}
.sc-label .d{width:7px;height:7px;border-radius:50%;background:currentColor}
.sc-title{font-size:24px;font-weight:700;letter-spacing:-.028em;margin-bottom:5px}
.sc-sub{font-size:13px;color:var(--text-3)}
.sc-guid{font-size:13px;color:var(--text-2);margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 10px}
.sc-guid a{color:var(--green-d);font-weight:500;text-decoration:none;white-space:nowrap}
.sc-guid a:hover{text-decoration:underline}
.sc-asof{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:12px}
.sc-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid rgba(12,17,24,.07)}
.sc-footer .sc-asof{margin-top:0}
.sc-footer .find-supplier-row{margin-top:0;justify-content:flex-end}
.sc-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.sc-actions .find-supplier-row{margin-top:0}
.watch-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--text-2);font-family:inherit;transition:border-color .15s,background .15s,color .15s;box-shadow:var(--sh-card)}
.watch-btn:hover:not(:disabled){border-color:var(--green);background:var(--green-bg);color:var(--green-d)}
.watch-btn.on{border-color:var(--green-b);background:var(--green-bg);color:var(--green-d)}
.watch-btn:disabled{opacity:.55;cursor:not-allowed}
.find-supplier-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}
.find-supplier-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--ink);background:var(--ink);color:#fff;font-family:inherit;transition:filter .15s,transform .15s;box-shadow:var(--sh-card)}
.find-supplier-btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.find-supplier-hint{font-size:12px;color:var(--text-4)}
.hero-card{flex-direction:column;align-items:stretch;gap:0;padding:0;overflow:hidden;container-type:inline-size;container-name:hero}
.hero-card .pc-body{padding:20px 22px}
.hero-card .pc-head{align-items:flex-start}
.pc-name-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pc-name-row .status-pill{margin-top:0}
.pc-actions{flex-shrink:0}
.hero-band{border-top:1px solid var(--border)}
.hero-band.crit{background:linear-gradient(135deg,#fff5f6,#fff1f3);border-top-color:var(--crit-b)}
.hero-band.med{background:linear-gradient(135deg,#fffdf5,#fffbeb);border-top-color:var(--med-b)}
.hero-band.ok{background:linear-gradient(135deg,#f0fdf8,#ecfdf5);border-top-color:var(--ok-b)}
.hb-cols{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:22px;padding:20px 22px 6px}
.hb-left{display:flex;flex-direction:column;gap:12px;min-width:0}
.hb-answer{font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1.35;color:var(--ink)}
.hb-markets{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.hb-markets-l{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-right:3px}
.hero-band.crit .hb-markets-l{color:var(--crit)}.hero-band.med .hb-markets-l{color:var(--med)}
.hb-left .ai-sum.embedded{margin-top:0;padding-top:12px;border-top:1px solid rgba(12,17,24,.07)}
.sc-facts.hb-tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:0;border-top:0;align-content:start}
.hb-tiles .sc-fact,.hb-tiles .sc-fact + .sc-fact{background:var(--bg);border:1px solid rgba(12,17,24,.07);border-radius:12px;padding:12px 14px}
.hb-tiles .sc-fact-link:hover{border-color:var(--green)}
.hb-asof{padding:8px 22px 14px;margin-top:0}
.hero-card .pc-head{flex-wrap:wrap}
.hero-card .pc-titles{flex:1 1 auto;min-width:min(100%,280px)}
.pc-actions .find-supplier-hint{display:none}
@container hero (max-width:820px){.hb-cols{grid-template-columns:1fr}.sc-facts.hb-tiles{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}}
@container hero (max-width:560px){.pc-actions{justify-content:flex-start;width:100%}}
.hq{border-top:1px solid var(--border)}
.hq-head{display:flex;align-items:flex-start;gap:14px;padding:18px 22px}
.hq-ic{width:44px;height:44px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;border:1px solid}
.hq.crit .hq-ic{background:var(--crit-bg);border-color:var(--crit-b);color:var(--crit)}
.hq.med .hq-ic{background:var(--med-bg);border-color:var(--med-b);color:var(--med)}
.hq.ok .hq-ic{background:var(--ok-bg);border-color:var(--ok-b);color:var(--green-d)}
.hq-head-t{min-width:0}
.hq.crit .hq-head{background:linear-gradient(135deg,#fff5f6,#fff1f3)}
.hq.med .hq-head{background:linear-gradient(135deg,#fffdf5,#fffbeb)}
.hq.ok .hq-head{background:linear-gradient(135deg,#f0fdf8,#ecfdf5)}
.hq.crit{border-top-color:var(--crit-b)}.hq.med{border-top-color:var(--med-b)}.hq.ok{border-top-color:var(--ok-b)}
.hq.crit .hq-qs{border-top-color:var(--crit-b)}.hq.med .hq-qs{border-top-color:var(--med-b)}.hq.ok .hq-qs{border-top-color:var(--ok-b)}
.hq .hq-ic{background:var(--bg) !important}
.hq.crit .hq-title{color:#a8102e}.hq.med .hq-title{color:#8a4e05}
.hq-title{font-size:22px;font-weight:700;letter-spacing:-.028em;color:var(--ink);line-height:1.2}
.hq-reason{font-size:13px;color:var(--text-2);margin-top:3px}
.hq-src{font-size:11.5px;color:var(--text-3);margin-top:3px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.hq-qs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--border)}
.hq-q{padding:16px 22px;min-width:0;display:flex;flex-direction:column}
.hq-q + .hq-q{border-left:1px solid var(--border)}
.hq-q-l{font-size:13px;font-weight:600;color:var(--text-3)}
.hq-q-a{font-size:19px;font-weight:700;letter-spacing:-.025em;color:var(--ink);margin-top:6px;line-height:1.2;overflow-wrap:anywhere}
.hq-q-a.mono{font-family:var(--font-geist-mono),ui-monospace,monospace;font-weight:600}
.hq-q-d{font-size:12.5px;color:var(--text-3);margin-top:5px;line-height:1.45;overflow-wrap:anywhere}
.hq-q-d a{color:var(--green-d);font-weight:600;text-decoration:none}
.hq-more{margin-top:auto;padding-top:10px;font-size:12.5px;font-weight:600;color:var(--green-d);text-decoration:none;align-self:flex-start;min-height:24px}
.hq-more:hover,.hq-q-d a:hover{text-decoration:underline}
.hq-just{padding:14px 22px;border-top:1px solid var(--border);background:var(--bg-2)}
.hq-just-l{font-size:13px;color:var(--text-3)}
.hq-just-l strong{color:var(--ink);font-weight:600}
.hq-mkts{display:flex;flex-wrap:wrap;gap:6px}
.hq-mk{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 9px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text-2)}
.hq-mk.mine{border-color:var(--border-2);color:var(--ink)}
.hq-dot{width:7px;height:7px;border-radius:50%;background:var(--med)}
.hq-dot.crit{background:var(--crit)}
.hq-ai{border-top:1px solid var(--border);padding:14px 22px 12px}
.hq-ai-l{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)}
.hq-ai-badge{font-size:9.5px;font-weight:700;letter-spacing:.02em;color:#fff;background:var(--grad-brand);border-radius:5px;padding:2px 5px}
.hq-ai .ai-sum.embedded{border-top:0;padding-top:8px;margin-top:0}
.hq-ai .ai-sum-hl{font-size:14.5px;margin-bottom:3px}
@container hero (max-width:700px){.hq-qs{grid-template-columns:1fr}.hq-q + .hq-q{border-left:0;border-top:1px solid var(--border)}}
.hero-card .pc-body{padding:18px 22px 16px}
.pc-name-row .d-eml,.pc-name-row .d-ctrl{margin-top:0}
.hero-card .d-generic,.hero-card .d-localcode{display:inline}
.hero-card .d-localcode::before{content:" · "}
.hero-card .d-tags{margin-top:10px}
.hq-head{padding:14px 22px;gap:12px;align-items:center}
.hq-ic{width:36px;height:36px;border-radius:10px}
.hq-ic svg{width:18px;height:18px}
.hq-title{font-size:19px}
.hq-reason,.hq-src{display:inline;margin-top:0}
.hq-sub{margin-top:3px;font-size:13px;color:var(--text-2);line-height:1.4}
.hq-reason + .hq-src::before{content:" · "}
.sc-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:14px;border-top:1px solid rgba(12,17,24,.07)}
.sc-fact{padding:12px 14px 2px 0;min-width:0;text-decoration:none;color:inherit;display:block}
.sc-fact + .sc-fact{padding-left:14px;border-left:1px solid rgba(12,17,24,.07)}
.sc-fact-l{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)}
.sc-fact-v{font-size:15px;font-weight:700;letter-spacing:-.02em;color:var(--ink);margin-top:4px;line-height:1.25}
.sc-fact-v.mono{font-family:var(--font-geist-mono),ui-monospace,monospace}
.sc-fact-d{font-size:11.5px;color:var(--text-3);margin-top:3px;line-height:1.35}
.sc-fact-link:hover .sc-fact-v{color:var(--green-d)}
.sc-fact{min-width:0}
.sc-fact-v,.sc-fact-d{overflow-wrap:anywhere}
@media(max-width:680px){.sc-fact + .sc-fact{padding-left:0;border-left:0;border-top:1px solid rgba(12,17,24,.07)}}
.ai-sum-body.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ai-sum-more{font:inherit;font-size:12px;font-weight:600;color:var(--green-d);background:none;border:0;padding:4px 0;margin-top:2px;cursor:pointer;min-height:32px}
.ai-sum-more:hover{text-decoration:underline}
.sw-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.sw-card{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px 16px;text-decoration:none;color:inherit;display:block;box-shadow:var(--sh-card),var(--hi-inset);}
.sw-card.emph{background:linear-gradient(150deg,var(--green-bg),var(--bg) 80%);border-color:var(--green-b)}
.sw-card-link{transition:border-color .15s,box-shadow .15s,transform .15s}
.sw-card-link:hover{border-color:var(--green);box-shadow:0 1px 8px rgba(0,0,0,.06);box-shadow:var(--sh-pop),var(--hi-inset);transform:translateY(-2px);}
.sw-h{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-4)}
.sw-ic{width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.sw-ic.ok{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.sw-ic.neutral{background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.sw-ic.grad{background:var(--grad-brand);color:#fff}
.sw-v{font-size:17px;font-weight:700;letter-spacing:-.02em;color:var(--ink);margin-top:9px;line-height:1.2}
.sw-d{font-size:11.5px;color:var(--text-3);margin-top:5px}
.sec{margin-top:30px}
.dtabs{margin-top:26px}
.dtabs-bar{position:sticky;top:0;z-index:5;background:var(--bg-2);border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;padding:8px 12px 0}
.dtabs-bar::-webkit-scrollbar{display:none}
.dtabs-list{display:flex;gap:2px;min-width:max-content}
.dtab{font:inherit;font-size:13.5px;font-weight:600;letter-spacing:-.01em;color:var(--text-3);background:none;border:1px solid transparent;border-bottom:0;border-radius:10px 10px 0 0;margin-bottom:-1px;padding:10px 16px 11px;min-height:44px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;transition:background .12s,color .12s}
.dtab:hover{color:var(--ink);background:rgba(12,17,24,.04)}
.dtab.on{background:var(--bg);color:var(--ink);border-color:var(--border);box-shadow:inset 0 2px 0 var(--green)}
.dtab:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.dtab-badge{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;border:1px solid var(--border);color:var(--text-3);background:var(--bg)}
.dtab-badge.crit{color:var(--crit);background:var(--crit-bg);border-color:var(--crit-b)}
.dtab-badge.med{color:var(--med);background:var(--med-bg);border-color:var(--med-b)}
.dtab-badge.ok{color:var(--green-d);background:var(--ok-bg);border-color:var(--ok-b)}
.dtabs-panel > .sec:first-of-type{margin-top:20px}
.dtabs-panel > .status-card:first-of-type{margin-top:20px}
.dtabs{margin-top:18px;background:var(--bg);border:1px solid var(--border);border-radius:18px;overflow:clip;box-shadow:var(--sh-card),var(--hi-inset)}
.dtabs-panel{padding:2px 22px 24px}
@media(max-width:620px){.dtabs-panel{padding:2px 14px 18px}}
.dtabs-print-h{display:none}
.dtabs-panel [id]{scroll-margin-top:64px}
.ai-sum{margin:14px 0 0;border:1px solid var(--border);border-radius:16px;background:linear-gradient(135deg,var(--bg),var(--bg-2));padding:16px 18px}
.ai-sum.embedded{margin:14px 0 0;border:0;border-top:1px solid var(--border);border-radius:0;background:none;padding:14px 0 0}
.ai-sum-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.ai-sum-spark{width:18px;height:18px;border-radius:6px;background:var(--grad-brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0}
.ai-sum-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)}
.ai-sum-sig{margin-left:auto;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;letter-spacing:.02em}
.ai-sum-sig.crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.ai-sum-sig.med{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.ai-sum-sig.ok{color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b)}
.ai-sum-sig.neutral{color:var(--text-3);background:var(--bg-3);border:1px solid var(--border)}
.ai-sum-hl{font-size:15px;font-weight:700;letter-spacing:-.02em;color:var(--ink);margin-bottom:6px;line-height:1.3}
.ai-sum-body{font-size:13px;color:var(--text-2);line-height:1.62}
.ai-sum-foot{font-size:10.5px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:12px}
.ai-sum-skel{font-size:12.5px;color:var(--text-4);font-style:italic}
.sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;color:var(--ink);margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sec-title .help{color:var(--text-4);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px}
.subpath{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--bg);box-shadow:var(--sh-card),var(--hi-inset);}
.subpath-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px}
.subpath-l{display:flex;gap:12px;align-items:flex-start;min-width:0}
.subpath-ic{width:22px;height:22px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-top:1px}
.subpath-ic.ok{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.subpath-ic.neutral{background:var(--bg-3);color:var(--text-4);border:1px solid var(--border)}
.subpath-n{font-size:13.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.subpath-d{font-size:12px;color:var(--text-3);line-height:1.5;margin-top:3px}
.alt-list{display:flex;flex-direction:column;gap:9px}
.alt-card{background:var(--bg);border:1px solid var(--border);border-radius:13px;padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;box-shadow:var(--sh-card),var(--hi-inset);}
.alt-link{text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s}
.alt-link:hover{border-color:var(--green);box-shadow:0 1px 8px rgba(0,0,0,.06);box-shadow:var(--sh-pop),var(--hi-inset);transform:translateY(-2px);}
.alt-main{min-width:0}
.alt-n{font-size:14px;font-weight:600;margin-bottom:3px}
.alt-f{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
.alt-note{font-size:11.5px;color:var(--text-3);margin-top:6px;line-height:1.45}
.alt-match{display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:110px}
.alt-bar{width:96px;height:5px;border-radius:99px;background:var(--bg-3);overflow:hidden}
.alt-bar span{display:block;height:100%;border-radius:99px;background:var(--grad-soft)}
.alt-pct{font-size:10.5px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
.cmp-list{display:flex;flex-direction:column;gap:6px}
.cmp-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:11px 14px;border-radius:11px;background:var(--bg);border:1px solid var(--border);box-shadow:var(--sh-card),var(--hi-inset)}
.cmp-anchor{background:var(--bg-2);border-color:var(--border-2)}
.cmp-name{min-width:0;font-size:13.5px;font-weight:600;display:flex;flex-wrap:wrap;align-items:baseline;gap:7px}
.cmp-name a{color:inherit;text-decoration:none}
.cmp-name a:hover{color:var(--green-d);text-decoration:underline}
.cmp-tag{font-size:10px;font-weight:600;color:var(--text-4);text-transform:uppercase;letter-spacing:.04em}
.cmp-rel{font-size:10.5px;font-weight:500;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;flex-basis:100%}
.cmp-price{font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.cmp-muted{color:var(--text-4);font-weight:400}
.cmp-band{display:flex;align-items:center;gap:7px;justify-content:flex-end;min-width:132px}
.cmp-mult{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-3)}
.cmp-pill{font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap}
.cmp-base{color:var(--text-3);background:var(--bg-3);border:1px solid var(--border)}
.cmp-na{color:var(--text-4);background:var(--bg-3);border:1px solid var(--border)}
.band-lower{color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b)}
.band-similar{color:var(--text-2);background:var(--bg-3);border:1px solid var(--border-2)}
.band-higher{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.band-much_higher,.band-far_higher{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
@media(max-width:620px){.cmp-row{grid-template-columns:1fr auto;gap:6px}.cmp-band{grid-column:1/-1;justify-content:flex-start;min-width:0}}
.country-list{display:flex;flex-direction:column;gap:9px}
.brand-focus{margin-top:14px;padding:18px 20px;border:1px solid var(--border);border-radius:18px;background:var(--bg);box-shadow:var(--sh-card),var(--hi-inset)}
.bf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.bf-eyebrow{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-4);margin-bottom:2px}
.bf-name{font-size:20px;font-weight:600;letter-spacing:-.02em;color:var(--ink);margin-bottom:2px}
.bf-clear{font-size:12px;color:var(--text-3);text-decoration:none;white-space:nowrap;padding:4px 10px;border:1px solid var(--border);border-radius:8px}
.bf-clear:hover{color:var(--ink);border-color:var(--text-4)}
.bf-block{margin-top:16px}
.bf-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;color:var(--ink);margin-bottom:9px}
.bf-label .help{color:var(--text-4);font-weight:400;text-transform:none;letter-spacing:0}
.bf-empty{font-size:13px;color:var(--text-3);line-height:1.55;padding:11px 14px;border-radius:12px;background:var(--bg-2);border:1px dashed var(--border)}
.bf-regs{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.bf-reg{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 14px;border-top:1px solid var(--border)}
.bf-reg:first-child{border-top:0}
.bf-reg-p{font-size:13px;font-weight:500;color:var(--ink)}
@media(max-width:680px){.bf-reg{flex-direction:column;gap:2px}.brand-focus .country-row{flex-direction:column;align-items:flex-start;gap:8px}}
.country-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-radius:13px;background:var(--bg);border:1px solid var(--border);box-shadow:var(--sh-card),var(--hi-inset);}
.cl{display:flex;align-items:center;gap:11px}
.cn{font-size:14px;font-weight:600}
.flag{font-size:18px}
.timeline{display:flex;flex-direction:column;gap:14px;padding-left:2px}
.tl-row{display:flex;gap:11px;align-items:flex-start}
.tl-d{width:9px;height:9px;border-radius:50%;border:2px solid var(--border-2);background:var(--bg);margin-top:3px;flex-shrink:0}
.tl-d.filled{background:var(--green);border-color:var(--green)}
.tl-dt{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace}
.tl-ev{font-size:12.5px;color:var(--text-2);margin-top:1px}
.src-list{display:flex;flex-direction:column;gap:7px}
.src-item{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-radius:11px;background:var(--bg);border:1px solid var(--border);box-shadow:var(--sh-card),var(--hi-inset);}
.src-l{display:flex;align-items:center;gap:9px}
.src-n{font-size:12px;font-weight:600}
.src-link{font-size:11px;color:var(--green-d);font-family:var(--font-geist-mono),ui-monospace,monospace;font-weight:500;text-decoration:none}
.conc{border:1px solid var(--border);border-radius:14px;background:var(--bg);padding:16px;box-shadow:var(--sh-card),var(--hi-inset);}
.conc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.conc-n{font-size:18px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.conc-d{font-size:12px;color:var(--text-3);line-height:1.5;margin-top:4px;max-width:520px}
.who-pq-badge{font-size:10.5px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 9px;border-radius:99px;white-space:nowrap}
.conc-makers{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.conc-foot{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:13px;border-top:1px solid var(--border);padding-top:11px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.stat-cell{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 13px;box-shadow:var(--sh-card),var(--hi-inset);}
.stat-v{font-size:20px;font-weight:700;letter-spacing:-.02em;color:var(--ink);line-height:1.1}
.stat-l{font-size:10.5px;color:var(--text-3);margin-top:5px;text-transform:uppercase;letter-spacing:.04em}
.stat-foot{font-size:11.5px;color:var(--text-3);margin-top:11px;line-height:1.5}
@media(max-width:620px){.stat-row{grid-template-columns:repeat(2,1fr)}}
.sim{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card,#fff)}
.sim-ans{font-size:15px;font-weight:600;color:var(--ink);padding:14px 16px;border-bottom:1px solid var(--border);line-height:1.4}
.sim-table{width:100%;border-collapse:collapse;font-size:13px}
.sim-table th{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);text-align:left;padding:8px 16px;background:var(--bg-2)}
.sim-table td{padding:10px 16px;border-top:1px solid var(--border);vertical-align:top}
.sim-form td{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);background:var(--bg-2);padding:6px 16px}
.sim-name{font-weight:600;color:var(--ink)}
.sim-back{font-weight:500;color:var(--ink)}
.sim-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 16px;border-top:1px solid var(--border)}
.sim-btn{font-size:12.5px;font-weight:600;padding:8px 13px;border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--ink)}
.sim-btn.primary{background:var(--bg);border-color:#D1D5DB;color:var(--navy)}
.sim-ctx{display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px;font-size:12px;color:var(--text-3);border-top:1px solid var(--border);background:var(--bg-2)}
.sim-up{border-top:1px solid var(--border)}
.sim-up summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 16px;font-size:12.5px;color:var(--text-3);cursor:pointer;list-style:none}
.sim-up summary::-webkit-details-marker{display:none}
.sim-hidetxt{display:none}
.sim-note{padding:8px 16px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-4)}
.sim-extra{display:none}.sim:has(.sim-all input:checked) .sim-extra{display:table-row}
.sim-all{display:block;position:relative;padding:9px 16px;border-top:1px solid var(--border);font-size:12.5px;font-weight:600;color:var(--teal);cursor:pointer}
.sim-all input{position:absolute;opacity:0;pointer-events:none}
.sim-all:has(input:checked) .sim-show{display:none}.sim-all:has(input:checked) .sim-hidetxt{display:inline}.sim-up[open] .sim-show{display:none}.sim-up[open] .sim-hidetxt{display:inline}
.sim-more{font-size:12px;font-weight:600;color:var(--teal);white-space:nowrap}
.sim-uptable{border-top:1px solid var(--border)}
@media(max-width:560px){.sim-hide{display:none}.sim-table td,.sim-table th{padding-left:12px;padding-right:12px}}
.status-pill{font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}
.chat-panel{display:flex;flex-direction:column;height:100%}
.chat-head{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#fbfcfe,var(--bg))}
.chat-h-l{display:flex;align-items:center;gap:11px}
.chat-ic{width:30px;height:30px;border-radius:9px;background:var(--grad-brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;box-shadow:0 5px 14px -5px rgba(15,166,118,.55)}
.chat-title{font-size:14px;font-weight:700;letter-spacing:-.01em}
.chat-sub{font-size:11px;color:var(--text-4);display:flex;align-items:center;gap:5px;margin-top:2px}
.chat-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0;animation:chat-pulse 2.2s infinite}
@keyframes chat-pulse{0%{box-shadow:0 0 0 0 rgba(15,166,118,.5)}70%{box-shadow:0 0 0 5px rgba(15,166,118,0)}100%{box-shadow:0 0 0 0 rgba(15,166,118,0)}}
.chat-free-tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 8px;border-radius:99px;align-self:flex-start}
.chat-stream{padding:16px;flex:1;overflow-y:auto}
.chat-bubble{background:var(--bg-2);border:1px solid var(--border);border-radius:4px 13px 13px 13px;padding:11px 13px;font-size:12.5px;color:var(--text-2);line-height:1.5}
.chat-bubble>*:last-child{margin-bottom:0}
.chat-bubble strong{font-weight:700;color:var(--text)}
.chat-bubble .cb-p{margin:0 0 9px}
.chat-bubble .cb-list{margin:0 0 9px;padding-left:17px;display:flex;flex-direction:column;gap:3px}
.chat-bubble .cb-list li{line-height:1.45;padding-left:2px}
.chat-bubble .cb-quote{margin:0 0 9px;padding:9px 11px;background:var(--med-bg);border-left:3px solid var(--med-b);border-radius:0 9px 9px 0;color:var(--text-2)}
.chat-bubble .cb-table-wrap{margin:0 0 9px;overflow-x:auto;border:1px solid var(--border);border-radius:9px;background:var(--bg)}
.chat-bubble .cb-table{border-collapse:collapse;width:100%;font-size:11px}
.chat-bubble .cb-table th{text-align:left;font-weight:700;color:var(--text-3);background:var(--bg-3);padding:6px 9px;white-space:nowrap;border-bottom:1px solid var(--border)}
.chat-bubble .cb-table td{padding:6px 9px;border-bottom:1px solid var(--border);color:var(--text-2);vertical-align:top}
.chat-bubble .cb-table tr:last-child td{border-bottom:none}
.chat-suggest{display:flex;flex-direction:column;gap:7px;padding:0 16px 14px}
.chat-q{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-size:12px;font-weight:500;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:11px;padding:10px 13px;text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s,background .15s,color .15s}
.chat-q-t{min-width:0}
.chat-q:hover{border-color:var(--violet-b);background:#f6f6ff;color:var(--violet);box-shadow:0 6px 16px -10px rgba(99,102,241,.6);transform:translateY(-1px)}
.chat-q-arrow{color:var(--text-4);font-size:13px;flex-shrink:0;opacity:0;transform:translateX(-5px);transition:.15s}
.chat-q:hover .chat-q-arrow{color:var(--violet);opacity:1;transform:translateX(0)}
.chat-input{display:flex;align-items:center;gap:8px;margin:0 16px 16px;padding:9px 9px 9px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg);text-decoration:none}
.chat-input input{flex:1;border:none;background:transparent;outline:none;font-size:13px;font-family:inherit;color:var(--text)}
.chat-input input::placeholder{color:var(--text-4)}
.chat-send{width:30px;height:30px;border-radius:8px;background:var(--ink);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.chat-send:disabled{opacity:.5;cursor:default}
/* Report identity bar */
.report-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:30px;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:linear-gradient(135deg,var(--bg),var(--bg-2));box-shadow:var(--sh-card),var(--hi-inset)}
.report-kicker{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--green-d)}
.report-meta{font-size:11.5px;color:var(--text-4);margin-top:3px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.report-export{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;border:1px solid var(--border-2);background:var(--bg);color:var(--text-2);font-family:inherit;font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:10px;cursor:pointer;transition:.15s}
.report-export:hover{border-color:var(--green);color:var(--green-d);background:var(--green-bg);box-shadow:var(--sh-pop)}
/* Full drug record (Phase 1) */
.v1home .record{margin-top:30px;border:1px solid var(--border);border-radius:16px;background:var(--bg);box-shadow:var(--sh-card),var(--hi-inset);overflow:hidden}
.v1home .record-sum{display:flex;align-items:center;gap:10px;padding:15px 18px;cursor:pointer;list-style:none;user-select:none}
.v1home .record-sum::-webkit-details-marker{display:none}
.v1home .record-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;color:var(--text-3)}
.v1home .record-meta{font-size:11px;color:var(--text-4)}
.v1home .record-chev{margin-left:auto;color:var(--text-4);font-size:12px;transition:transform .18s}
.v1home .record[open] .record-chev{transform:rotate(180deg)}
.v1home .record-block{padding:0 18px 18px;border-top:1px solid var(--border)}
.v1home .record-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-4);margin:16px 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.v1home .record-h .help{color:var(--text-4);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px}
.spec-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px 28px}
.spec-row{min-width:0}
.spec-l{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);margin-bottom:3px}
.spec-v{font-size:13.5px;color:var(--ink);font-weight:500;line-height:1.4}
/* Product-attributes table (2-col label/value) */
.attr-wrap{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--bg);box-shadow:var(--sh-card),var(--hi-inset)}
.attr-table{width:100%;border-collapse:collapse;font-size:13px}
.attr-table tr{border-bottom:1px solid var(--border)}
.attr-table tr:last-child{border-bottom:none}
.attr-table th{text-align:left;vertical-align:top;width:42%;padding:12px 16px;font-size:11.5px;font-weight:600;color:var(--text-3);background:var(--bg-2);border-right:1px solid var(--border)}
.attr-table td{padding:12px 16px;color:var(--ink);font-weight:500;line-height:1.45;word-break:break-word}
.attr-table .attr-muted{color:var(--text-4);font-weight:400;font-style:italic}
@media(max-width:560px){.attr-table th{width:46%;font-size:11px}.attr-table td{font-size:12.5px}}
.reg-wrap{border:1px solid var(--border);border-radius:12px;overflow:hidden;overflow-x:auto}
.reg-table{border-collapse:collapse;width:100%;font-size:12.5px}
.reg-table th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);background:var(--bg-2);padding:9px 10px;white-space:nowrap;border-bottom:1px solid var(--border)}
.reg-table td{padding:10px 10px;border-bottom:1px solid var(--border);color:var(--text-2);vertical-align:top}
.reg-table td:nth-child(2),.reg-table td:nth-child(3),.reg-table td:nth-child(4),.reg-table td:nth-child(6){white-space:nowrap}
.reg-table tr:last-child td{border-bottom:none}
.reg-table .reg-name{font-weight:600;color:var(--ink);white-space:normal;min-width:96px}
.reg-foot{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:10px}
@media(max-width:620px){.spec-grid{grid-template-columns:1fr}}
@media(max-width:1080px){.v1app.v1drug .dg-main{margin:0 auto}}
/* Mobile/tablet: collapse to a single full-width content column. The bare
   .sb hide was being out-specified, so scope + force it; stack the grid. */
@media(max-width:1023px){.v1drug .sb{display:none!important}.v1app.v1drug .dg-main{width:100%}}
@media(max-width:620px){.sw-cards{grid-template-columns:repeat(2,1fr)}.d-name{font-size:24px}}
@media(max-width:480px){.sw-cards{grid-template-columns:1fr}.v1app.v1drug .dg-main{padding:16px 16px 64px}}
/* Print / Export PDF — strip the app chrome and lay the report out as a clean
   document. Sections avoid breaking mid-block; the collapsible record is forced
   open so nothing is hidden in the exported file. */
/* ── Navy/aqua redesign (2026-11) ─────────────────────────────────────────
   Flat, edge-to-edge product area. Sections run full width; their content
   sits on one inset line (--gut: 48px desktop, narrower on small screens).
   Status colours (crit/med/ok) are unchanged. */
.v1drug{--gut:48px}
@media(max-width:820px){.v1drug{--gut:24px}}
@media(max-width:620px){.v1drug{--gut:16px}}
.v1app.v1drug{background:#fff}
.v1app.v1drug .dg-main{padding:0 0 80px;margin:0;max-width:none;background:#fff}
.v1app.v1drug .dg-main > *{margin-left:var(--gut);margin-right:var(--gut)}
.v1app.v1drug .dg-main > .product-card,.v1app.v1drug .dg-main > .dtabs{margin-left:0;margin-right:0}
.v1drug .d-brandhint{margin-top:16px}
/* Search bar: chat-column strip on desktop; inline fallback below 1080px,
   where the chat column is hidden. */
.v1drug .dsearch-narrow{display:none}
@media(max-width:1079px){.v1drug .dsearch-narrow{display:block;padding-top:16px}}
.v1drug .dsearch{width:100%;min-width:0;margin:0;gap:8px;padding:4px 4px 4px 12px;background:#F4F5F7;border:1px solid #E5E7EB;border-radius:10px;box-shadow:none}
.v1drug .dsearch:focus-within{border-color:var(--teal);box-shadow:0 0 0 3px rgba(18,122,99,.15)}
.v1drug .dsearch-ic{flex:none}
.v1drug .dsearch input{flex:1;min-width:0;padding:7px 0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border:none;outline:none;color:var(--navy)}
.v1drug .dsearch button{flex:none;height:32px;padding:0 14px;border-radius:8px;background:#fff;border:1px solid #D1D5DB;color:var(--navy);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.v1drug .dsearch button:hover{background:#F9FAFB;border-color:#9CA3AF}
/* Medicine header (~136px): name / meta line / tags + actions */
.v1drug .product-card.hero-card{margin-top:0;padding:0;border:0;border-radius:0;box-shadow:none;background:#fff;overflow:visible}
.v1drug .hero-card .pc-body{padding:20px var(--gut) 16px}
.v1drug .d-name{font-size:28px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:var(--navy);overflow-wrap:anywhere}
.v1drug .d-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin-top:6px;min-width:0;font-size:12.5px;color:#6B7280}
.v1drug .d-meta .d-eml,.v1drug .d-meta .d-ctrl{margin-top:0;font-size:11px;padding:2px 8px}
.v1drug .hero-card .d-generic,.v1drug .hero-card .d-localcode{display:inline;margin-top:0;font-size:12.5px;color:#6B7280}
.v1drug .hero-card .d-localcode::before{content:"·";margin-right:10px}
.v1drug .d-tagrow{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:10px 20px;margin-top:10px}
.v1drug .d-tagrow .d-tags{flex:1 1 240px;min-width:0;margin-top:0}
.v1drug .d-tagrow .pc-actions{margin-left:auto;flex-wrap:nowrap}
/* One primary action: "Find a supplier" is the only filled button. */
.v1drug .watch-btn,.v1drug .find-supplier-btn{height:36px;padding:0 14px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:none;transform:none}
.v1drug .watch-btn{background:#fff;border:1px solid #D1D5DB;color:var(--navy)}
.v1drug .watch-btn:hover:not(:disabled){background:#F9FAFB;border-color:#9CA3AF;color:var(--navy)}
.v1drug .watch-btn.on{background:var(--acc-soft);border-color:var(--teal);color:var(--teal-l)}
.v1drug .find-supplier-btn{background:var(--navy);border:1px solid var(--navy);color:#fff}
.v1drug .find-supplier-btn:hover{background:#141A3A;filter:none;transform:none}
.v1drug .watch-btn:focus-visible,.v1drug .find-supplier-btn:focus-visible,.v1drug .sim-btn:focus-visible,.v1drug .dsearch button:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
/* Status banner */
.v1drug .hq{border-top:1px solid #E5E7EB}
.v1drug .hq-head{padding:18px var(--gut);gap:12px;align-items:flex-start}
.v1drug .hq-title{font-size:20px;line-height:1.3}
.v1drug .hq-sub{margin-top:4px;font-size:13.5px;line-height:1.5;color:var(--text-2)}
.v1drug .hq-reason,.v1drug .hq-scope{font-size:13.5px;line-height:1.5}
.v1drug .hq-src{font-family:inherit;font-size:13.5px;line-height:1.5;color:#6B7280}
.v1drug .sc-guid{margin-top:4px;font-size:13.5px;line-height:1.5}
/* Answer boxes: first text on the content line; empty answers stay quiet. */
.v1drug .hq-q{padding:16px 24px}
.v1drug .hq-q:first-child{padding-left:var(--gut)}
.v1drug .hq-q:last-child{padding-right:var(--gut)}
@container hero (max-width:700px){.v1drug .hq-q{padding-left:var(--gut);padding-right:var(--gut)}}
.v1drug .hq-q-a.empty{font-size:15px;font-weight:500;letter-spacing:-.01em;color:#6B7280}
.v1drug .hq-q-d.empty{display:none}
.v1drug .hq-just,.v1drug .hq-ai{padding-left:var(--gut);padding-right:var(--gut)}
/* Tabs: flat row, 2px link-teal underline on the active tab. */
.v1drug .dtabs{margin-top:0;border:0;border-radius:0;box-shadow:none;background:#fff;overflow:visible}
.v1drug .dtabs-bar{padding:6px var(--gut) 0;background:#fff;border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB}
.v1drug .dtabs-list{gap:28px}
.v1drug .dtab{margin-bottom:-1px;padding:14px 0 12px;border:0;border-bottom:3px solid transparent;border-radius:0;background:none;box-shadow:none;font-size:15px;letter-spacing:-.012em;color:#4B5563}
.v1drug .dtab:hover{background:none;color:var(--navy)}
.v1drug .dtab:hover{border-bottom-color:#D1D5DB}
.v1drug .dtab.on,.v1drug .dtab.on:hover{background:none;color:var(--navy);font-weight:700;border-bottom-color:#127A63;box-shadow:none}
.v1drug .dtab:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.v1drug .dtabs-panel{padding:0 var(--gut) 24px}
/* Flat panels: no floating-card shadows inside any tab. */
.v1drug .dtabs-panel .subpath,.v1drug .dtabs-panel .alt-card,.v1drug .dtabs-panel .cmp-row,.v1drug .dtabs-panel .price-panel,.v1drug .dtabs-panel .sw-card,.v1drug .dtabs-panel .status-card{box-shadow:none}
/* Product table: full width, rows edge to edge, text on the content line. */
.v1drug .dtabs-panel .sim{margin:0 calc(-1 * var(--gut));border:0;border-radius:0;background:#fff}
.v1drug .sim-ans{padding:14px var(--gut);border-bottom:1px solid #E5E7EB}
.v1drug .sim-table th:first-child,.v1drug .sim-table td:first-child,.v1drug .sim-form td{padding-left:var(--gut)}
.v1drug .sim-table th:last-child,.v1drug .sim-table td:last-child{padding-right:var(--gut)}
.v1drug .sim-all,.v1drug .sim-note,.v1drug .sim-ctx,.v1drug .sim-up summary{padding-left:var(--gut);padding-right:var(--gut)}
/* Action row under the table: equal 40px buttons on one line; helper text
   moves to the far right. */
.v1drug .sim-acts{padding:14px var(--gut);gap:10px;align-items:center}
.v1drug .sim-acts .find-supplier-row{display:contents}
.v1drug .sim-acts .find-supplier-hint{order:99;margin-left:auto;font-size:12.5px;color:#6B7280}
.v1drug .sim-acts .sim-btn,.v1drug .sim-acts .watch-btn,.v1drug .sim-acts .find-supplier-btn{height:40px;display:inline-flex;align-items:center;gap:7px;padding:0 16px;border-radius:10px;font-size:13px;font-weight:600;line-height:1}
.v1drug .sim-btn.primary{background:#fff;border:1px solid #D1D5DB;color:var(--navy)}
.v1drug .sim-btn.primary:hover{background:#F9FAFB;border-color:#9CA3AF}
/* Form / strength filter: a labelled row of pill buttons just above the tabs. */
.fpick{display:flex;flex-direction:column;gap:8px;padding:14px 0 12px;border-top:1px solid var(--border);font-size:13px}
.fpick-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.fpick-l{color:var(--ink);font-weight:600;min-width:104px}
.fpick-chip{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border-radius:999px;border:1px solid #D1D5DB;background:#fff;color:var(--ink);font-weight:600;text-decoration:none;white-space:nowrap}
.fpick-chip:hover{border-color:#9CA3AF;background:#F9FAFB}
.fpick-chip.on,.fpick-chip.on:hover{background:var(--ink);border-color:var(--ink);color:#fff}
.fpick-chip.on .fpick-n{color:rgba(255,255,255,.78)}
.fpick-n{font-weight:500;color:var(--text-3);font-size:12px}
.fpick-n:empty{display:none}
@media(max-width:620px){.fpick-l{min-width:100%}}
.fpick-dot{width:7px;height:7px;border-radius:50%;flex:none}
.fpick-dot.ok{background:var(--ok)}.fpick-dot.med{background:var(--med)}.fpick-dot.crit{background:var(--crit)}
/* Picker on the redesign's content line. */
.v1drug .fpick{border-top:1px solid #E5E7EB}
@media print{
  .v1home{background:#fff;font-size:11px}
  .sb,.chat-col,.dsearch,.report-export,.sb-profile,.home-nav{display:none !important}
  .shell{display:block}
  .v1app.v1drug .dg-main{max-width:100%;padding:0 4px}
  .report-bar{box-shadow:none;border-color:#ccc}
  .sec,.status-card,.price-panel,.subpath,.conc,.record,.record-block,.country-row,.alt-card,.stat-row,.reg-wrap,.attr-wrap{break-inside:avoid;page-break-inside:avoid}
  .sec{margin-top:18px}
  .dtabs-bar{display:none}
  .dtabs-panel[hidden]{display:block !important}
  .dtabs-print-h{display:block;font-size:14px;font-weight:700;margin:22px 0 0}
  .record[open] .record-chev,.record-chev{display:none}
  .record .record-block{display:block !important}
  .status-card,.sw-card,.price-panel,.conc,.subpath,.alt-card,.country-row,.src-item,.record{box-shadow:none !important}
  a[href]{text-decoration:none;color:inherit}
}
`;

// Unaffected products shown per dose form before "Show all" — a market can
// register ~100 presentations of a common molecule (GB amoxicillin).
const SIM_CLEAR_SHOWN = 4;

function SupplyPill({ status, since, history, discontinued = false }: {
  status: SupplyStatus; since: string | null;
  history?: { count: number; last: string | null } | null;
  discontinued?: boolean;
}) {
  // A discontinuation is a permanent market exit, not a temporary shortage.
  if (status === "short" && discontinued) {
    return <span className="status-pill sp-crit"><span className="d" />Discontinued</span>;
  }
  if (status === "none") {
    // A clean pill alone hid a product that had been short on and off — say
    // when the regulator last listed it (past notices, last 2 years).
    const last = history?.last
      ? new Date(history.last + "T00:00:00Z").toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" })
      : null;
    return (
      <>
        <span className="status-pill sp-ok"><span className="d" />No current shortage</span>
        {history && last && (
          <div style={{ fontSize: 10.5, marginTop: 4, color: "var(--med)" }}>
            Short {history.count === 1 ? "once" : `${history.count}×`} in past 2 yrs · last {last}
          </div>
        )}
      </>
    );
  }
  // Year shown unless it's the current one: "since 15 Dec" alone could be either.
  const d = since ? new Date(since + "T00:00:00Z") : null;
  const when = d
    ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" } : {}) })
    : null;
  return status === "short"
    ? <span className="status-pill sp-crit"><span className="d" />Short{when ? ` since ${when}` : ""}</span>
    : <span className="status-pill sp-part"><span className="d" />Anticipated{when ? ` from ${when}` : ""}</span>;
}

function BackCell({ status, back, passed, url, discontinued = false, exitDate }: { status: SupplyStatus; back: string | null; passed: boolean; url: string | null; discontinued?: boolean; exitDate?: string | null }) {
  if (status === "none") return <span className="alt-f">—</span>;
  if (discontinued) {
    const d = exitDate ? new Date(exitDate + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
    return (
      <div>
        <div className="sim-back">Not coming back</div>
        <div className="alt-f">
          {d ? `registration ${isFuture(exitDate ?? null) ? "ends" : "ended"} ${d}` : "market exit"}
          {url ? <> · <a href={url} target="_blank" rel="noopener noreferrer">notice ↗</a></> : null}
        </div>
      </div>
    );
  }
  const label = back
    ? new Date(back + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : passed ? "Estimate passed, not updated" : "No estimate";
  return (
    <div>
      <div className="sim-back">{label}</div>
      <div className="alt-f">
        {back ? "sponsor estimate" : ""}
        {url && <>{back ? " · " : ""}<a href={url} target="_blank" rel="noopener noreferrer">notice ↗</a></>}
      </div>
    </div>
  );
}
