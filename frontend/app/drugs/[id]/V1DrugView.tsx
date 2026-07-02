import Link from "next/link";
import ClinicalDisclaimer from "@/app/components/ClinicalDisclaimer";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import MobileTabBar from "@/app/components/v1/MobileTabBar";
import { ContextChat } from "@/app/chat/components/ContextChat";
import "@/app/chat/chat.css";
import V1DrugSearch from "@/app/components/v1/V1DrugSearch";
import V1AiSummary from "./V1AiSummary";
import V1ReportActions from "./V1ReportActions";
import { FindSupplier } from "./find-supplier";
import { WatchButton } from "./watch-button";
import { ParallelTradeSourcing } from "./parallel-trade-sourcing";
import { ParallelTradeArbitrage } from "./parallel-trade-arbitrage";
import { ParallelTradePanel } from "./parallel-trade-panel";
import { PriceTrendChart } from "./PriceTrendChart";
import { detectS19A, getS19AText } from "@/lib/shortage-utils";
import { affinity } from "@/lib/alternatives";
import { cleanBrandNames } from "@/lib/brand";

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
function monthYear(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}
const CUR_SYM: Record<string, string> = { AUD: "A$", USD: "US$", GBP: "£", EUR: "€", NZD: "NZ$", CAD: "C$" };
const fmtPrice = (amt: number, cur: string) => `${CUR_SYM[cur] ?? cur + " "}${amt.toFixed(2)}`;

export default function V1DrugView({
  id, drug, shortages, statusLog, alternatives, userCountry, apiConcentration, recalls, approvalFootprint, eligibility, pricing, concession, priceMarkets, products, brandSkus, brandHint,
}: {
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
  // Registered products for this molecule (drug_products + joined sponsor / MA
  // holder). Already fetched in page.tsx; drives the "Full drug record" section.
  products?: any[] | null;
  // Brand SKUs that roll up to this molecule — makes the brand chips clickable
  // to the brand-distinct sourcing view (/drugs/{catId}?brand=1).
  brandSkus?: { brand: string; catId: string; country: string }[];
  // Set when the user arrived from a brand search (e.g. "Fresofol" → Propofol);
  // drives the "you searched X" provenance banner.
  brandHint?: { brand: string; country: string; catId: string } | null;
}) {
  // brand (lowercased) → SKU, for turning chips into links.
  const skuByBrand = new Map((brandSkus ?? []).map((s) => [s.brand.toLowerCase(), s]));
  const CONC_LABEL: Record<string, string> = {
    very_high: "Very high", high: "High", medium: "Moderate", low: "Low",
  };
  const CONC_CLS: Record<string, string> = {
    very_high: "sp-crit", high: "sp-crit", medium: "sp-part", low: "sp-ok",
  };
  const active = shortages.filter((s) => ["active", "anticipated"].includes((s.status || "").toLowerCase()));
  // Country-FIRST status: a shortage far away but fine in your market is NOT a
  // shortage for you. The headline reflects YOUR country only; shortages
  // elsewhere are surfaced as secondary context + the regulator breakdown.
  const cName = COUNTRY[userCountry] ?? userCountry;
  const mine = active.find((s) => (s.country_code || "").toUpperCase() === userCountry) || null;
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

  const localShortage = !!mine;
  const sev = (mine?.severity || "").toLowerCase();
  const isCrit = sev === "critical" || sev === "high";
  const anticipated = (mine?.status || "").toLowerCase() === "anticipated";

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
  const expected = monthYear(mine?.estimated_resolution_date);
  const expSource = abbr(mine?.data_sources?.name, mine?.data_sources?.abbreviation) || "regulator";

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
    ? s19aStructured.scheme_reference
      ? `TGA s19A · ${s19aStructured.scheme_reference}`
      : "TGA-approved overseas product"
    : s19aNotesText
      ? "TGA-approved overseas product"
      : null;

  // Alternatives — real similarity only; null hides the %.
  const alts = (alternatives || []).slice(0, 5).map((a) => ({
    id: a.alternative_drug_id ?? a.drugs?.id ?? null,
    name: a.drugs?.generic_name ?? "Therapeutic alternative",
    rel: a.relationship_type ? String(a.relationship_type).replace(/_/g, " ") : "same class",
    pct: a.similarity_score != null ? Math.round(a.similarity_score * 100) : null,
    note: a.dose_conversion_notes ?? a.availability_note ?? null,
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
  const statusPill = localShortage
    ? anticipated
      ? { cls: "sp-part", txt: `Anticipated · ${cName}` }
      : isCrit
        ? { cls: "sp-crit", txt: `In shortage · ${cName}` }
        : { cls: "sp-part", txt: `Limited supply · ${cName}` }
    : { cls: "sp-ok", txt: `In supply · ${cName}` };

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

  return (
    <div className="v1home v1drug">
      <style>{CSS}</style>
      <div className="shell">
        {/* ── Left sidebar (app nav) — shared with the search page ── */}
        <V1Sidebar />

        {/* ── Center + right ── */}
        <div className="shell-main">
          <div className="drug-grid">
            {/* ── Middle column: grounded chat (new template). ContextChat is
                 the standard chat surface — clicking a product in an answer
                 opens its detail. ── */}
            <aside className="chat-col mederti-chat-root">
              <ContextChat
                key={drug.generic_name}
                contextKey={drug.generic_name}
                title={drug.generic_name}
                category="Drug record"
                bodyText={`The user is viewing the Mederti drug record for ${drug.generic_name}. Answer about this medicine — its shortages, substitutes, suppliers, and regulatory status.`}
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
            </aside>

            {/* ── Right column: the drug record, full-width detail panel ── */}
            <div className="dg-main">
          <V1DrugSearch initial={drug.generic_name} />

          {brandHint && (
            <div
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
                href={`/drugs/${brandHint.catId}?brand=1`}
                style={{ color: "var(--teal-l)", textDecoration: "none", fontWeight: 600 }}
              >
                View {brandHint.brand} registrations {"→"}
              </a>
            </div>
          )}

          <div className="product-card">
            <div className="pc-body">
              <div className="pc-head">
                <div className="pc-titles">
                  <div className="d-name">{drug.generic_name}</div>
                  <div className="d-generic">
                    {[drug.atc_code ? `ATC ${drug.atc_code}` : null, klass].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {localReg && (
                    <div className="d-localcode">
                      {flag(localReg.country)} {[localReg.label, localReg.code].filter(Boolean).join(" ")}
                      {localReg.sponsor ? <> · {localReg.sponsor}</> : null}
                    </div>
                  )}
                </div>
                <span className={`status-pill ${statusPill.cls}`}><span className="d" />{statusPill.txt}</span>
              </div>

              <div className="pc-badges">
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
              </div>

              {(() => {
                const brands = cleanBrandNames(drug.brand_names, drug.generic_name);
                if (brands.length === 0) return null;
                const shown = brands.slice(0, 5);
                const rest = brands.length - shown.length;
                return (
                  <div className="d-tags">
                    {shown.map((b) => {
                      const sku = skuByBrand.get(b.toLowerCase());
                      return sku ? (
                        <a
                          key={b}
                          className="d-tag"
                          href={`/drugs/${sku.catId}?brand=1`}
                          title={`View ${b}${sku.country ? ` (${sku.country})` : ""} — registrations & sourcing`}
                          style={{ textDecoration: "none", cursor: "pointer" }}
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
            </div>
          </div>

          {/* Status card */}
          <div className={`status-card ${localShortage ? (isCrit ? "crit" : "med") : "ok"}`}>
            {/* Status eyebrow: user-market status, then the OTHER markets that
                are also short, inline as flag chips — "Australia & 🇨🇦 🇩🇪 …".
                Lets a user tell global-from-local at a glance. Critical/high
                markets render red; major markets (US/EU/UK) sort first. */}
            <div className="sc-label">
              <span className="d" />
              <span className="sc-label-t">
                {localShortage ? (anticipated ? "Anticipated · " : "In declared shortage · ") : "In supply · "}
                {flag(userCountry)} {cName}
                {elsewhereCount > 0 ? (localShortage ? " & also short in" : " · short in") : ""}
              </span>
              {elsewhereCount > 0 && (
                <span className="sc-foot-flags">
                  {footprint.slice(0, 8).map((f) => (
                    <span
                      key={f.cc}
                      className={`scs-c${f.major ? " major" : ""}${f.sev >= 2 ? " crit" : ""}`}
                      title={`${COUNTRY[f.cc] ?? f.cc}${f.sev >= 2 ? " · critical/high severity" : ""}`}
                    >
                      {flag(f.cc)} {f.cc}
                    </span>
                  ))}
                  {footprint.length > 8 && <span className="scs-more">+{footprint.length - 8}</span>}
                </span>
              )}
            </div>
            <div className="sc-title">{localShortage ? (anticipated ? "Anticipated shortage" : isCrit ? "Critical shortage" : "Limited supply") : `In supply in ${cName}`}</div>
            {localShortage && mine?.reason && <div className="sc-sub">{String(mine.reason).replace(/^availability:\s*/i, "")}</div>}
            {!localShortage && elsewhereCount === 0 && <div className="sc-sub">No active shortage reported.</div>}

            {/* AI commentary — embedded under the heading, above the as-of line */}
            <V1AiSummary id={id} embedded />

            {/* Card footer: source line anchored bottom-left, the universal
                "Find a supplier" CTA anchored bottom-right. */}
            <div className="sc-footer">
              <div className="sc-asof">{localShortage ? `Based on ${expSource} notice · verified ${timeAgo(mine?.last_verified_at ?? mine?.updated_at) || "recently"}` : "Source: official regulators"}</div>
              <div className="sc-actions">
                <WatchButton drugId={id} />
                <FindSupplier drugId={id} drugName={drug.generic_name} userCountry={userCountry} severity={sev} />
              </div>
            </div>
          </div>


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

          {/* Compact hero price — always-visible market price when no concession
              banner already carries it. Full multi-market panel stays below. */}
          {!concession && heroPrice && (
            <div className="price-strip">
              <span className="ps-mkt">{flag(userCountry)} {userCountry}</span>
              <span className="ps-label">{heroPrice.label}</span>
              <span className="ps-val">{fmtPrice(heroPrice.value, heroPrice.currency)}</span>
              {heroPrice.extra && <span className="ps-extra">{heroPrice.extra}</span>}
              <a href="#trade-price" className="ps-more">details →</a>
            </div>
          )}

          {/* So-what tiles */}
          <div className="sw-cards">
            <div className="sw-card">
              <div className="sw-h"><span className="sw-ic ok">✓</span> Can I substitute?</div>
              <div className="sw-v">{s19aTileDetail ? "Yes — under S19A" : "Per normal rules"}</div>
              <div className="sw-d">{s19aTileDetail ?? "Confirm with prescriber"}</div>
            </div>
            {topAlt?.id != null ? (
              <Link href={`/drugs/${topAlt.id}`} className="sw-card sw-card-link">
                <div className="sw-h"><span className="sw-ic ok">⇄</span> Best alternative</div>
                <div className="sw-v">{topAlt.name}</div>
                <div className="sw-d">{`${affinity(topAlt.pct) ? `${affinity(topAlt.pct)} · ` : ""}${topAlt.rel}`}</div>
              </Link>
            ) : (
              <div className="sw-card">
                <div className="sw-h"><span className="sw-ic ok">⇄</span> Best alternative</div>
                <div className="sw-v">{topAlt ? topAlt.name : "None listed"}</div>
                <div className="sw-d">{topAlt ? `${affinity(topAlt.pct) ? `${affinity(topAlt.pct)} · ` : ""}${topAlt.rel}` : "refer to prescriber"}</div>
              </div>
            )}
            <div className="sw-card">
              <div className="sw-h"><span className="sw-ic neutral">◷</span> Expected back</div>
              <div className="sw-v">{expected ?? "No estimate"}</div>
              <div className="sw-d">{expected ? `Sponsor est. via ${expSource}` : "No estimate provided"}</div>
            </div>
          </div>

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

          {/* Parallel Trade Intelligence — three self-gating surfaces, in
              value order. Each renders nothing until it has real data
              (migration 060 + matches), so most drug pages show none.
              1. Sourcing routes — appears when the drug is short in the user's
                 market and import lanes can supply it (procurement value).
              2. Arbitrage map — appears when price spreads are computable
                 (importer value).
              3. Raw licence list — reference fallback (all matched licences). */}
          <ParallelTradeSourcing drugId={id} userCountry={userCountry} />
          <ParallelTradeArbitrage drugId={id} destination={userCountry} />
          <ParallelTradePanel drugId={id} />

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
                    <span className={`status-pill ${CONC_CLS[apiConcentration.band]}`}><span className="d" />{CONC_LABEL[apiConcentration.band]} concentration risk</span>
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

          {/* Alternatives */}
          {alts.length > 0 && (
            <div className="sec">
              <div className="sec-title">Related alternatives <span className="help">same class</span></div>
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
                          <div className="alt-bar"><span style={{ width: `${a.pct}%` }} /></div>
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

          <V1ReportActions generatedLabel={generatedLabel} marketLabel={marketLabel} sourceCount={sources.length} />

          <div className="sec"><ClinicalDisclaimer /></div>
        </div>
          </div>
        </div>
      </div>
      <MobileTabBar />
    </div>
  );
}

const CSS = `
/* Tuned design system: this surface's scoped token block now mirrors the
   global tuned palette (globals.css :root) and uses Geist. Kept component-
   local because V1DrugView was authored as a self-contained surface. */
.v1home .d-name,.v1home .sc-title,.v1home .sec-title,.v1home .chat-title{font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;font-weight:600;letter-spacing:-.03em}
.v1home{--ink:#0c1118;--green:#0fa676;--green-d:#0c8a62;--green-bg:#e8f6f0;--green-b:#dcebe6;--grad-soft:linear-gradient(135deg,#34d399,#0fa676 45%,#0c1118 120%);--grad-brand:linear-gradient(135deg,#0c1118,#0c3a30 48%,#34d399);
  --violet:#6366f1;--violet-b:#c7d2fe;--bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;--crit:#dc2647;--crit-b:#f8cdd6;--med:#b46708;--med-b:#f3dcae;--ok:#0fa676;--ok-bg:#e8f6f0;--ok-b:#bce4d4;--crit-bg:#fdeef1;--med-bg:#fdf6e9;
  --hi-inset:inset 0 1px 0 rgba(255,255,255,.7);--sh-card:0 1px 1px rgba(12,17,24,.04),0 2px 6px -2px rgba(12,17,24,.06);--sh-pop:0 2px 4px rgba(12,17,24,.05),0 12px 28px -10px rgba(12,17,24,.16);
  background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:31px;width:auto;display:block}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none}
.home-nav{position:sticky;top:0;z-index:50;height:58px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.nav-actions{display:flex;gap:10px;align-items:center}
.shell{display:flex;align-items:flex-start;min-height:100vh}
.sb{width:262px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.sb-top{height:64px;padding:0 28px;display:flex;align-items:center}
.sb-new{margin:0 14px 10px;display:flex;align-items:center;gap:8px;justify-content:center;padding:11px;border:1px solid var(--border);border-radius:12px;font-size:13px;font-weight:600;color:var(--text-2);background:var(--bg);text-decoration:none}
.sb-new:hover{border-color:var(--green);color:var(--green-d);background:var(--green-bg)}
.sb-scroll{flex:1;overflow-y:auto;padding:8px 14px 8px 19px}
.sb-group{margin-top:14px}
.sb-glabel{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);padding:6px 9px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px;border-radius:10px;font-size:13px;font-weight:500;color:var(--text-2);text-decoration:none}
.sb-item:hover{background:var(--bg-2)}
.sb-empty{color:var(--text-4);font-style:italic}
.sb-sub{padding-left:18px;color:var(--text-3);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.sb-sub:hover{color:var(--text);background:var(--bg-2)}
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.sb-dot.green{background:var(--ok)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.shell-main{flex:1;min-width:0}
.drug-grid{display:flex;align-items:flex-start}
.dg-main{flex:1;min-width:0;padding:18px 48px 80px;width:100%;background:#eef1f5}
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
.country-list{display:flex;flex-direction:column;gap:9px}
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
.status-pill{font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.status-pill .d{width:6px;height:6px;border-radius:50%;background:currentColor}
.sp-crit{color:var(--crit);background:var(--crit-bg);border:1px solid var(--crit-b)}
.sp-part{color:var(--med);background:var(--med-bg);border:1px solid var(--med-b)}
.sp-ok{color:var(--ok);background:var(--ok-bg);border:1px solid var(--ok-b)}
.chat-col{width:380px;flex-shrink:0;display:flex;background:var(--bg);position:sticky;top:0;height:100vh}
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
@media(max-width:1080px){.chat-col{display:none}.dg-main{margin:0 auto}}
/* Mobile/tablet: collapse to a single full-width content column. The bare
   .sb hide was being out-specified, so scope + force it; stack the grid. */
@media(max-width:1023px){.v1drug .sb{display:none!important}.v1drug .drug-grid{display:block}.v1drug .dg-main{width:100%}}
@media(max-width:620px){.sw-cards{grid-template-columns:repeat(2,1fr)}.d-name{font-size:24px}}
@media(max-width:480px){.sw-cards{grid-template-columns:1fr}.dg-main{padding:16px 16px 64px}}
/* Print / Export PDF — strip the app chrome and lay the report out as a clean
   document. Sections avoid breaking mid-block; the collapsible record is forced
   open so nothing is hidden in the exported file. */
@media print{
  .v1home{background:#fff;font-size:11px}
  .sb,.chat-col,.dsearch,.report-export,.sb-profile,.home-nav{display:none !important}
  .shell,.drug-grid{display:block}
  .dg-main{max-width:100%;padding:0 4px}
  .report-bar{box-shadow:none;border-color:#ccc}
  .sec,.status-card,.price-panel,.subpath,.conc,.record,.record-block,.country-row,.alt-card,.stat-row,.reg-wrap,.attr-wrap{break-inside:avoid;page-break-inside:avoid}
  .sec{margin-top:18px}
  .record[open] .record-chev,.record-chev{display:none}
  .record .record-block{display:block !important}
  .status-card,.sw-card,.price-panel,.conc,.subpath,.alt-card,.country-row,.src-item,.record{box-shadow:none !important}
  a[href]{text-decoration:none;color:inherit}
}
`;
