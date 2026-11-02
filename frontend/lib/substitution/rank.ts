// Substitution Agent engine — the pure part. Given everything Mederti holds
// about one medicine in one market, rank what a pharmacist can do instead.
// No I/O here (resolve.ts loads the inputs), so the ranking is unit-tested
// with `node --test lib/substitution/rank.test.mts`.
//
// The job: "X is out — what can I dispense instead, today, legally, at what
// dose?" Ranking is decided here, in code; the chat model only words it.
//
// Tiers, best first (docs/substitution-agent-scope.md):
//   1 authorised_swap      a current legal instrument in this market permits
//                          the swap (TGA SSSI, UK SSP, BfArM-cited, TFDA…)
//   2 same_medicine        another registered product of the same medicine,
//                          backed by the regulator's own guidance on the
//                          shortage notice ("Alternative brands are
//                          available.") and/or the register × notices view
//   3 import_pathway       an overseas product approved for supply (s19A…)
//   4 therapeutic          a different medicine — prescriber decision, no dose
//   else refusal           names the gap and the reference to use instead
//
// Hard rules, enforced here so no caller can get them wrong:
//   • a dose is only ever a source's own verbatim statement
//   • legal claims are scoped to the instrument's country and validity dates
//   • "registered, no shortage notice" is never "available" or "in stock"
//   • single-source therapeutic alternatives are labelled as single source

import type { SupplyInMarket } from "../supply-in-market";

export type Tier = "authorised_swap" | "same_medicine" | "import_pathway" | "therapeutic";
export const TIER_ORDER: Tier[] = ["authorised_swap", "same_medicine", "import_pathway", "therapeutic"];

export interface EvidenceRow {
  drug_id: string | null;
  alternative_drug_id: string | null;
  alternative_name: string | null;   // drugs.generic_name of alternative_drug_id
  kind: "same_molecule" | "therapeutic";
  publisher: string;
  source_code: string;
  authority_type: "regulator_legal" | "regulator_guidance" | "clinical_reference";
  source_ref: string;
  source_url: string;
  statement: string;
  indication: string | null;
  country_code: string | null;
  drug_name_raw: string;
  alternative_name_raw: string;
  alternative_product: string | null;
  dose_statement: string | null;
  valid_from: string | null;
  valid_until: string | null;
  retrieved_at: string;
}

export interface EligibilityRow {
  scheme: string;
  country_code: string;
  brand_name: string | null;
  generic_name: string | null;
  scheme_reference: string | null;
  description: string | null;
  listed_at: string | null;
  expires_at: string | null;
  source_url: string | null;
  last_verified_at: string | null;
  matched_by_name?: boolean;         // not linked by drug id; the regulator's title names the molecule
}

export interface NoticeRow {
  product: string | null;            // product named on the notice
  status: "active" | "anticipated";
  start_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
  guidance: string | null;           // regulator's verbatim management advice
  publisher: string;                 // e.g. "TGA"
  last_verified_at: string | null;
}

export interface RecallRow {
  recall_class: string | null;
  brand_name: string | null;
  generic_name: string | null;
  reason: string | null;
  announced_date: string | null;
  press_release_url: string | null;
}

export interface RankInput {
  drug: { id: string; name: string };
  moleculeIds: string[];
  country: string;
  today: string;                     // ISO date
  supply: SupplyInMarket | null;
  notices: NoticeRow[];
  evidence: EvidenceRow[];
  eligibility: EligibilityRow[];
  recalls: RecallRow[];
  // Other strengths / forms need the prescriber in most markets unless an
  // instrument covers them. Off until the CEO decides how to show them.
  includeOtherPresentations?: boolean;
}

export interface Source {
  publisher: string;
  label: string;                     // instrument / scheme / dataset name
  ref: string | null;
  url: string | null;
  valid_until: string | null;
  as_of: string | null;              // when Mederti last read it
}

export interface SubstitutionOption {
  tier: Tier;
  headline: string;                  // what to dispense / do, one line
  product: string | null;            // verbatim product line where the source gives one
  applies_to: string | null;         // the short product the source scopes it to
  legal_basis: string;               // jurisdiction-scoped, plain language
  needs_prescriber: "no" | "yes" | "check";
  dose_statement: string | null;     // verbatim from the source, or null
  quote: string | null;              // the source's own words
  source: Source;
}

export interface SubstitutionAnswer {
  drug: { id: string; name: string };
  country: string;
  situation: {
    open_notices: number;
    summary: string;                 // e.g. "Tablets are short until about 3 Mar 2027."
    notices: NoticeRow[];
  };
  recommendation: SubstitutionOption | null;
  options: SubstitutionOption[];
  dose: { statement: string | null; note: string };
  recalls: RecallRow[];
  refusal: { reason: string; references: { name: string; url: string | null }[] } | null;
  coverage_note: string | null;
}

// ── Regulator guidance on a shortage notice ─────────────────────────────────

export type GuidanceTag =
  | "alternative_brand" | "alternative_strength" | "alternative_presentation"
  | "s19a" | "sssi" | "consult_prescriber" | "controlled_supply" | "expedited_supply";

const GUIDANCE_TAGS: [GuidanceTag, RegExp][] = [
  // TGA writes "availabile" on some records; match the stem.
  ["alternative_brand", /alternative (brands?|generic products?|generics?) (is|are) availab/i],
  ["alternative_strength", /(alternative|other) strengths? (is|are) availab/i],
  ["alternative_presentation", /(alternative|other) (presentations?|pack sizes?|forms?) (is|are) availab/i],
  ["s19a", /section 19a|\bs19a\b/i],
  ["sssi", /substitution instrument|\bSSSI\b/i],
  ["consult_prescriber", /consult (their|your|a) (healthcare|doctor|prescriber)|consider alternative treatment/i],
  ["controlled_supply", /closely controlling|controlled supply/i],
  ["expedited_supply", /expedite/i],
];

export function classifyGuidance(text: string | null): GuidanceTag[] {
  if (!text) return [];
  return GUIDANCE_TAGS.filter(([, re]) => re.test(text)).map(([t]) => t);
}

// ── helpers ─────────────────────────────────────────────────────────────────

const PERMISSION_SCHEMES: Record<string, string> = {
  tga_s19a: "TGA Section 19A approval",
  fda_503b: "FDA 503B outsourcing",
  eu_art_5_2: "EU Article 5(2) national exemption",
};

const REFERENCES: Record<string, { name: string; url: string | null }[]> = {
  AU: [
    { name: "Australian Medicines Handbook", url: "https://amhonline.amh.net.au" },
    { name: "TGA medicine shortage reports", url: "https://www.tga.gov.au/safety/shortages-and-supply-disruptions/medicine-shortages/medicine-shortage-reports-database" },
  ],
  GB: [
    { name: "BNF", url: "https://bnf.nice.org.uk" },
    { name: "SPS Medicines Supply Tool", url: "https://www.sps.nhs.uk" },
  ],
  US: [
    { name: "ASHP drug shortages", url: "https://www.ashp.org/drug-shortages" },
    { name: "FDA drug shortages", url: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  ],
};
const DEFAULT_REFERENCES = [{ name: "Your national formulary or hospital guideline", url: null }];

function isCurrent(from: string | null, until: string | null, today: string): boolean {
  return (!from || from <= today) && (!until || until >= today);
}

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function until(iso: string | null): string {
  const d = fmt(iso);
  return d ? ` until ${d}` : "";
}

// ── tiers ───────────────────────────────────────────────────────────────────

// What each legal source actually permits. Only a substitution instrument
// (TGA SSSI, UK SSP) lets the pharmacist swap without the prescriber; an
// Orange Book AB rating is an equivalence finding that state law acts on.
function legalWording(e: EvidenceRow): { legal_basis: string; needs_prescriber: SubstitutionOption["needs_prescriber"] } {
  const end = until(e.valid_until);
  if (e.source_code === "tga_sssi" || e.source_code === "uk_ssp") {
    return { legal_basis: `Permitted in ${e.country_code} by ${e.publisher} ${e.source_ref}${end}, without a new prescription; the instrument's conditions apply.`, needs_prescriber: "no" };
  }
  if (e.source_code === "fda_orange_book") {
    return { legal_basis: `Rated therapeutically equivalent by FDA in the Orange Book (${e.source_ref}); substitution follows your state's generic-substitution law.`, needs_prescriber: "check" };
  }
  return { legal_basis: `Listed by ${e.publisher} for ${e.country_code} (${e.source_ref})${end}; check the source for what it permits.`, needs_prescriber: "check" };
}

function authorisedSwaps(inp: RankInput): SubstitutionOption[] {
  const out: SubstitutionOption[] = [];
  for (const e of inp.evidence) {
    if (e.authority_type !== "regulator_legal" || e.kind !== "same_molecule") continue;
    // Legal authority stops at the border: only this market's instruments.
    if (e.country_code !== inp.country || !isCurrent(e.valid_from, e.valid_until, inp.today)) continue;
    out.push({
      tier: "authorised_swap",
      headline: e.alternative_product ?? e.alternative_name_raw,
      product: e.alternative_product ?? e.alternative_name_raw,
      applies_to: e.drug_name_raw,
      ...legalWording(e),
      dose_statement: e.dose_statement,
      quote: e.statement,
      source: { publisher: e.publisher, label: e.source_code, ref: e.source_ref, url: e.source_url, valid_until: e.valid_until, as_of: e.retrieved_at },
    });
  }
  // An MHRA SSP on the eligibility table is the same kind of permission; the
  // alternative_evidence import usually holds it already, so only add it
  // when no evidence row cites the same SSP.
  const cited = new Set(out.map((o) => o.source.ref));
  for (const r of inp.eligibility) {
    if (r.scheme !== "mhra_ssp" || r.country_code !== inp.country) continue;
    if (!isCurrent(r.listed_at, r.expires_at, inp.today) || (r.scheme_reference && cited.has(r.scheme_reference))) continue;
    out.push({
      tier: "authorised_swap",
      headline: r.description ?? `Serious Shortage Protocol ${r.scheme_reference ?? ""}`.trim(),
      product: null,
      applies_to: r.brand_name ?? r.generic_name,
      legal_basis: `Permitted in GB by NHSBSA Serious Shortage Protocol ${r.scheme_reference ?? ""}${until(r.expires_at)}; the protocol's conditions apply.`,
      needs_prescriber: "no",
      dose_statement: null,
      quote: r.description,
      source: { publisher: "NHSBSA", label: "mhra_ssp", ref: r.scheme_reference, url: r.source_url, valid_until: r.expires_at, as_of: r.last_verified_at },
    });
  }
  // One option per substitutable product under one instrument; the scarce
  // products it covers are listed together.
  const merged = new Map<string, SubstitutionOption>();
  for (const o of out) {
    const key = `${o.source.ref}|${o.product}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, o);
    else if (o.applies_to && !prev.applies_to?.includes(o.applies_to)) prev.applies_to = `${prev.applies_to}; ${o.applies_to}`;
  }
  return [...merged.values()];
}

// Strength as written on the register line ("500 mg", "25 microgram/24 hours"),
// normalised for equality only. Never used to compute a dose.
function strengthKey(name: string): string | null {
  const m = name.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mg|mcg|microgram|micrograms|g|ml|%|iu|units?)\b(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|hours?|dose|g))?/);
  if (!m) return null;
  const unit = m[2].startsWith("microgram") ? "mcg" : m[2].replace(/s$/, "");
  return `${m[1]}${unit}${m[4] ? `/${m[3] ?? ""}${m[4].replace(/s$/, "")}` : ""}`;
}

function sameMedicine(inp: RankInput): SubstitutionOption[] {
  const out: SubstitutionOption[] = [];
  const supply = inp.supply;
  const registerLabel = supply?.registerSource ?? "national register";

  // (a) The regulator's own guidance on the notice, quoted verbatim. One
  // option per distinct statement, listing the short products it covers.
  // Grouped by what the guidance says (another brand vs another strength or
  // presentation); each distinct wording is still quoted verbatim.
  const byKind = new Map<"brand" | "other", NoticeRow[]>();
  for (const n of inp.notices) {
    const tags = classifyGuidance(n.guidance);
    const kind = tags.includes("alternative_brand") ? "brand"
      : tags.includes("alternative_strength") || tags.includes("alternative_presentation") ? "other" : null;
    if (!kind || (kind === "other" && !inp.includeOtherPresentations)) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), n]);
  }
  for (const [kind, ns] of byKind) {
    const brand = kind === "brand";
    const n = ns[0];
    const guidance = [...new Set(ns.map((x) => x.guidance as string))].join(" | ");
    const products = [...new Set(ns.map((x) => x.product).filter(Boolean) as string[])];
    out.push({
      tier: "same_medicine",
      headline: brand ? "Another brand of the same medicine" : "Another strength or presentation of the same medicine",
      product: null,
      applies_to: products.length > 3 ? `${products.slice(0, 3).join("; ")} and ${products.length - 3} more` : products.join("; ") || null,
      legal_basis: brand
        ? `${n.publisher} states on its shortage notice that an alternative is available. Brand substitution follows your usual ${inp.country} dispensing rules.`
        : `${n.publisher} states on its shortage notice that another strength or presentation is available. A different strength or form needs the prescriber unless an instrument covers it.`,
      needs_prescriber: brand ? "check" : "yes",
      dose_statement: null,
      quote: guidance,
      source: { publisher: n.publisher, label: "shortage notice", ref: null, url: n.source_url, valid_until: null, as_of: n.last_verified_at },
    });
  }

  // (b) Register × notices: same form, no shortage notice on file.
  if (supply) {
    for (const g of supply.groups) {
      const short = g.products.filter((p) => p.status === "short");
      const shortStrengths = new Set(short.map((p) => strengthKey(p.name)).filter(Boolean) as string[]);
      const hasShort = short.length > 0 || g.notices.some((n) => n.status === "short");
      if (!hasShort && !inp.includeOtherPresentations) continue;
      for (const p of g.products) {
        if (p.status !== "none") continue;
        const sk = strengthKey(p.name);
        const sameStrength = !!sk && shortStrengths.has(sk);
        // Default view: only the same strength as a product we know is short.
        // Anything else is a different presentation → behind the flag.
        if (!sameStrength && !inp.includeOtherPresentations) continue;
        out.push({
          tier: "same_medicine",
          headline: p.name,
          product: p.name + (p.sponsor ? ` (${p.sponsor})` : ""),
          applies_to: short.find((s) => strengthKey(s.name) === sk)?.name ?? null,
          legal_basis: sameStrength
            ? `Registered in ${inp.country} at the same strength and form, with no shortage notice on file. We can see notices, not stock.`
            : `Registered in ${inp.country}, no shortage notice on file, but a different strength or form: needs the prescriber unless an instrument covers it. We can see notices, not stock.`,
          needs_prescriber: sameStrength ? "check" : "yes",
          dose_statement: null,
          quote: null,
          source: { publisher: registerLabel, label: "register × shortage notices", ref: p.regNos[0] ?? null, url: p.sourceUrl, valid_until: null, as_of: null },
        });
      }
    }
  }
  return out;
}

function importPathways(inp: RankInput): SubstitutionOption[] {
  const out: SubstitutionOption[] = [];
  for (const r of inp.eligibility) {
    const label = PERMISSION_SCHEMES[r.scheme];
    if (!label || r.country_code !== inp.country || !isCurrent(r.listed_at, r.expires_at, inp.today)) continue;
    out.push({
      tier: "import_pathway",
      headline: r.brand_name ?? r.generic_name ?? label,
      product: r.brand_name,
      applies_to: null,
      legal_basis: `${label}${r.scheme_reference ? ` (${r.scheme_reference})` : ""}${until(r.expires_at)}. Supplied through the approval holder.` +
        (r.matched_by_name ? " Matched by the medicine's name in the regulator's listing, not by product id." : ""),
      needs_prescriber: "check",
      dose_statement: null,
      quote: r.description,
      source: { publisher: r.scheme.split("_")[0].toUpperCase(), label, ref: r.scheme_reference, url: r.source_url, valid_until: r.expires_at, as_of: r.last_verified_at },
    });
  }
  // The notice itself may say an s19A approval exists even when the s19A
  // register row isn't linked to this drug (or the register is unreadable).
  if (!out.length) {
    const n = inp.notices.find((x) => classifyGuidance(x.guidance).includes("s19a"));
    if (n) {
      out.push({
        tier: "import_pathway",
        headline: "An overseas product approved under Section 19A",
        product: null,
        applies_to: n.product,
        legal_basis: `${n.publisher} states on its shortage notice that a Section 19A approval exists; check the s19A register for the product and approval holder.`,
        needs_prescriber: "check",
        dose_statement: null,
        quote: n.guidance,
        source: { publisher: n.publisher, label: "shortage notice", ref: null, url: "https://www.tga.gov.au/resources/section-19a-approvals", valid_until: null, as_of: n.last_verified_at },
      });
    }
  }
  return out;
}

function therapeutic(inp: RankInput): SubstitutionOption[] {
  const byAlt = new Map<string, EvidenceRow[]>();
  for (const e of inp.evidence) {
    if (e.kind !== "therapeutic" || !e.alternative_drug_id || !isCurrent(e.valid_from, e.valid_until, inp.today)) continue;
    // A legal instrument from another country says nothing here.
    if (e.country_code && e.country_code !== inp.country) continue;
    byAlt.set(e.alternative_drug_id, [...(byAlt.get(e.alternative_drug_id) ?? []), e]);
  }
  const out: SubstitutionOption[] = [];
  for (const rows of byAlt.values()) {
    const publishers = [...new Set(rows.map((r) => r.publisher))].sort();
    const legal = rows.find((r) => r.authority_type === "regulator_legal");
    const first = legal ?? rows[0];
    const status = legal
      ? `Named by ${legal.publisher} for ${inp.country}`
      : publishers.length >= 2 ? `Named by ${publishers.join(" and ")}` : `Single source (${publishers[0]}) — not independently confirmed`;
    out.push({
      tier: "therapeutic",
      headline: first.alternative_name ?? first.alternative_name_raw,
      product: first.alternative_product,
      applies_to: first.indication || null,
      legal_basis: `${status}. A different medicine: the prescriber decides, including the dose.`,
      needs_prescriber: "yes",
      dose_statement: null,       // never for a different medicine
      quote: first.statement,
      source: { publisher: first.publisher, label: first.source_code, ref: first.source_ref, url: first.source_url, valid_until: first.valid_until, as_of: first.retrieved_at },
    });
  }
  // Confirmed before single-source.
  return out.sort((a, b) => Number(a.legal_basis.startsWith("Single")) - Number(b.legal_basis.startsWith("Single")));
}

// ── entry point ─────────────────────────────────────────────────────────────

export function rankSubstitution(inp: RankInput): SubstitutionAnswer {
  const options = [...authorisedSwaps(inp), ...sameMedicine(inp), ...importPathways(inp), ...therapeutic(inp)];
  const recommendation = options[0] ?? null;
  const refs = REFERENCES[inp.country] ?? DEFAULT_REFERENCES;
  const openNotices = inp.notices.length;

  const summary = inp.supply?.answer
    ?? (openNotices ? `${openNotices} open shortage notice${openNotices === 1 ? "" : "s"} for ${inp.drug.name} in ${inp.country}.`
      : `No open shortage notice for ${inp.drug.name} in ${inp.country}.`);

  const refList = refs.map((r) => r.name).join(" / ");
  const dose = recommendation?.dose_statement
    ? { statement: recommendation.dose_statement, note: `Quoted from ${recommendation.source.publisher} ${recommendation.source.ref ?? ""}`.trim() + "." }
    : { statement: null, note: `No sourced dose conversion on file. Check ${refList}.` };

  const refusal = options.length ? null : {
    reason: `Mederti has no authorised swap, regulator guidance, registered alternative or import approval on file for ${inp.drug.name} in ${inp.country}.`,
    references: refs,
  };

  const hasLegalSource = inp.evidence.some((e) => e.country_code === inp.country && e.authority_type === "regulator_legal");
  const coverage_note = !hasLegalSource && !inp.notices.some((n) => n.guidance) && !inp.supply
    ? `Mederti holds no substitution instruments, notice guidance or register data for ${inp.country}; only cross-border references apply.`
    : null;

  return {
    drug: inp.drug,
    country: inp.country,
    situation: { open_notices: openNotices, summary, notices: inp.notices },
    recommendation,
    options,
    dose,
    recalls: inp.recalls,
    refusal,
    coverage_note,
  };
}
