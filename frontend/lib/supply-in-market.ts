// "Supply in <market>" — the job-first answer for the drug page: which
// registered products of this medicine are short in the user's market, which
// aren't, and when the short ones are expected back.
//
// Inputs (server-side only; raw regulator records never reach the client):
//   • drug_catalogue rows for the molecule in the market — the national
//     register (AU ARTG, CA DPD, US, GB, JP, EU). Its has_active_shortage flag
//     is stale (DBL Diazepam showed false while TGA had it short), so status
//     never comes from it.
//   • open shortage_events for the molecule in the market, with the product
//     identifier the regulator publishes.
//
// Matching a notice to a product, strictest first — nothing fuzzy:
//   1. registration number: TGA artg_numb ↔ "AUST R <n>", Health Canada din ↔ DIN
//   2. the notice's product name equals the register name (pack words removed)
// A notice that names no product, or none we hold, is kept as its own row
// ("not matched to a registered product") — never spread across products.
//
// Wording: a product with no notice is "No shortage reported", never
// "Available": we can see notices, not stock.

export type SupplyStatus = "short" | "anticipated" | "none";

export interface SupplyProduct {
  name: string;
  sponsor: string | null;
  regNos: string[];
  status: SupplyStatus;
  since: string | null;        // ISO date the shortage started (short) / is expected (anticipated)
  back: string | null;         // ISO estimated return, only when still in the future
  backPassed: boolean;         // the regulator's estimate has passed without an update
  sourceUrl: string | null;
}

export interface SupplyNotice {
  label: string;               // product named on the notice, or "Ingredient-level notice"
  status: Exclude<SupplyStatus, "none">;
  since: string | null;
  back: string | null;
  backPassed: boolean;
  sourceUrl: string | null;
}

export interface SupplyGroup {
  form: string;                // "Injection", "Tablets", …
  products: SupplyProduct[];
  notices: SupplyNotice[];     // notices in this form we couldn't tie to a product
}

export interface SupplyInMarket {
  market: string;
  registerSource: string;      // e.g. "TGA register (ARTG)"
  noticeSource: string;        // e.g. "TGA shortage notices"
  groups: SupplyGroup[];
  answer: string;              // one-sentence answer, by dose form
  productCount: number;
  shortCount: number;
  combosExcluded: number;      // combination products / notices left out
}

export interface CatalogueRow {
  brand_name: string | null;
  active_ingredients?: unknown;
  strength: string | null;
  dosage_form: string | null;
  sponsor: string | null;
  registration_number: string | null;
}

export interface MarketNotice {
  status: string;
  start_date: string | null;
  anticipated_start_date: string | null;
  estimated_resolution_date: string | null;
  source_url: string | null;
  regNo: string | null;        // artg_numb / din from the regulator record
  productName: string | null;  // trade name / brand on the notice
  doseForm: string | null;     // dose form on the notice, when published
  ingredients?: string[];      // active ingredients on the notice (Health Canada publishes them)
}

const REGISTER_SOURCE: Record<string, string> = {
  AU: "TGA register (ARTG)", CA: "Health Canada Drug Product Database", US: "FDA register",
  GB: "MHRA register", JP: "PMDA register", EU: "EMA register",
};
const NOTICE_SOURCE: Record<string, string> = {
  AU: "TGA shortage notices", CA: "Drug Shortages Canada", US: "FDA shortage notices",
  GB: "MHRA / DHSC notices", JP: "MHLW notices", EU: "EMA notices",
};

// Order = how a pharmacist scans: oral solids, liquids, injectables, the rest.
const FORMS: [string, RegExp][] = [
  ["Tablets", /\btab(let)?s?\b|\bcaplet/i],
  ["Capsules", /\bcap(sule)?s?\b/i],
  ["Oral liquid", /oral (liquid|solution|suspension)|\bsyrup\b|\belixir\b|\bmixture\b|\bdrops\b/i],
  ["Injection", /inject|ampoule|\bamp\b|\bvial\b|infusion|\bi\.?v\.?\b|prefilled|pre-filled/i],
  ["Inhaler", /inhal|aerosol|nebul/i],
  ["Topical", /cream|ointment|\bgel\b|lotion|patch|topical/i],
  ["Eye or ear", /\beye\b|\bear\b|ophthalm|otic/i],
  ["Rectal", /suppositor|rectal|enema/i],
];
const FORM_ORDER = [...FORMS.map(([f]) => f), "Other forms"];

function formOf(...texts: (string | null)[]): string {
  const t = texts.filter(Boolean).join(" ");
  for (const [form, re] of FORMS) if (re.test(t)) return form;
  return "Other forms";
}

// Pack descriptors that split one product into several register entries.
const PACK_WORDS = /\b(blister pack|blister|bottle|pack|carton|box|strip|sachet|jar|tube|container|bag)\b/gi;

function productKey(name: string): string {
  return name.toLowerCase().replace(PACK_WORDS, " ").replace(/[^a-z0-9./%]+/g, " ").replace(/\s+/g, " ").trim();
}

// Registers often shout brand names ("ANTENEX 10 Diazepam"); keep units and
// short codes as written.
function displayName(name: string): string {
  const base = name.replace(PACK_WORDS, " ").replace(/\s+/g, " ").trim();
  return base.replace(/\b([A-Z]{4,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

function regDigits(s: string | null): string | null {
  const d = (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}

// Combination products (amoxicillin + clavulanic acid, multi-drug packs) get
// linked to a single molecule in both the register and some notices. They are
// a different medicine for the person dispensing, so they're left out and
// counted. Name rules, because active_ingredients is filled on under a third
// of register rows: an " and " / "&" / " + " / "composite" in the name, or a
// bare strength pair like "500/125" (a concentration like "10mg/2ml" has a
// unit before the slash, so it doesn't match).
const COMBO_NAME = /\s(and|&|\+)\s|&|\bcomposite\b|\d\s*\/\s*\d/i;

function isCombo(name: string | null, ingredients?: unknown): boolean {
  if (Array.isArray(ingredients) && ingredients.filter(Boolean).length > 1) return true;
  return !!name && COMBO_NAME.test(name);
}

const today = () => new Date().toISOString().slice(0, 10);

function backFields(est: string | null): { back: string | null; backPassed: boolean } {
  if (!est) return { back: null, backPassed: false };
  return est >= today() ? { back: est, backPassed: false } : { back: null, backPassed: true };
}

function minDate(xs: (string | null)[]): string | null {
  const v = xs.filter(Boolean) as string[];
  return v.length ? v.sort()[0] : null;
}

function fmtMonth(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function listForms(forms: string[]): string {
  const lower = forms.map((f, i) => (i === 0 ? f : f.toLowerCase()));
  return lower.length <= 1 ? lower.join("") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

export function buildSupplyInMarket(
  market: string,
  catalogue: CatalogueRow[],
  notices: MarketNotice[],
): SupplyInMarket | null {
  const named = catalogue.filter((r) => r.brand_name);
  if (named.length === 0) return null; // no register data for this market → caller falls back
  const rows = named.filter((r) => !isCombo(r.brand_name, r.active_ingredients));
  let combosExcluded = named.length - rows.length;

  // One product per name (pack words removed) + strength + form + sponsor. The
  // last three matter where a register uses the generic name as the product
  // name for every firm (US: every row is "Amoxicillin").
  const byKey = new Map<string, { name: string; sponsor: string | null; regNos: Set<string>; form: string }>();
  for (const r of rows) {
    const key = [productKey(r.brand_name!), (r.strength ?? "").toLowerCase(), (r.dosage_form ?? "").toLowerCase(), (r.sponsor ?? "").toLowerCase()].join("|");
    const nameLc = r.brand_name!.toLowerCase();
    const extras = [
      r.strength && !nameLc.includes(r.strength.toLowerCase().replace(/\s+/g, "")) && !nameLc.includes(r.strength.toLowerCase()) ? r.strength : null,
      r.dosage_form && !nameLc.includes(r.dosage_form.toLowerCase()) ? r.dosage_form.toLowerCase() : null,
    ].filter(Boolean);
    const p = byKey.get(key) ?? { name: [displayName(r.brand_name!), ...extras].join(" "), sponsor: r.sponsor, regNos: new Set<string>(), form: formOf(r.dosage_form, r.brand_name) };
    if (r.registration_number) p.regNos.add(r.registration_number.trim());
    p.sponsor = p.sponsor ?? r.sponsor;
    byKey.set(key, p);
  }

  const openAll = notices.filter((n) => n.status === "active" || n.status === "anticipated");
  const open = openAll.filter((n) => !isCombo(n.productName, n.ingredients));
  combosExcluded += openAll.length - open.length;
  const matched = new Map<string, MarketNotice[]>(); // product key → notices
  const unmatched: MarketNotice[] = [];
  for (const n of open) {
    const reg = regDigits(n.regNo);
    let hit: string | null = null;
    if (reg) {
      for (const [k, p] of byKey) if ([...p.regNos].some((x) => regDigits(x) === reg)) { hit = k; break; }
    }
    if (!hit && n.productName) {
      const nk = productKey(n.productName);
      const same = [...byKey.keys()].filter((k) => k.split("|")[0] === nk);
      if (same.length === 1) hit = same[0]; // ambiguous (several firms, same name) → unmatched
    }
    if (hit) matched.set(hit, [...(matched.get(hit) ?? []), n]);
    else unmatched.push(n);
  }

  const groups = new Map<string, SupplyGroup>();
  const group = (form: string) => {
    if (!groups.has(form)) groups.set(form, { form, products: [], notices: [] });
    return groups.get(form)!;
  };

  for (const [k, p] of byKey) {
    const ns = matched.get(k) ?? [];
    const active = ns.filter((n) => n.status === "active");
    const ant = ns.filter((n) => n.status === "anticipated");
    const status: SupplyStatus = active.length ? "short" : ant.length ? "anticipated" : "none";
    const use = active.length ? active : ant;
    group(p.form).products.push({
      name: p.name,
      sponsor: p.sponsor,
      regNos: [...p.regNos].sort(),
      status,
      since: status === "short" ? minDate(use.map((n) => n.start_date))
        : status === "anticipated" ? minDate(use.map((n) => n.anticipated_start_date ?? n.start_date)) : null,
      ...backFields(status === "none" ? null : minDate(use.map((n) => n.estimated_resolution_date))),
      sourceUrl: use.find((n) => n.source_url)?.source_url ?? null,
    });
  }
  for (const n of unmatched) {
    group(formOf(n.doseForm, n.productName)).notices.push({
      label: n.productName ? displayName(n.productName) : "Ingredient-level notice: no product named",
      status: n.status === "active" ? "short" : "anticipated",
      since: n.status === "active" ? n.start_date : n.anticipated_start_date ?? n.start_date,
      ...backFields(n.estimated_resolution_date),
      sourceUrl: n.source_url,
    });
  }

  const rank: Record<SupplyStatus, number> = { short: 0, anticipated: 1, none: 2 };
  const worst = (g: SupplyGroup) =>
    Math.min(...[...g.products.map((p) => rank[p.status]), ...g.notices.map((n) => rank[n.status])]);
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, products: g.products.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name)) }))
    // Forms with a shortage first (the answer leads with them), then the
    // usual pharmacist scan order.
    .sort((a, b) => worst(a) - worst(b) || FORM_ORDER.indexOf(a.form) - FORM_ORDER.indexOf(b.form));

  // The answer, by dose form.
  const shortForms: string[] = [];
  const antForms: string[] = [];
  const clearForms: string[] = [];
  const shortBack = new Map<string, string | null>(); // form → latest return estimate
  for (const g of ordered) {
    const items = [...g.products, ...g.notices];
    if (items.some((x) => x.status === "short")) {
      shortForms.push(g.form);
      // Quote a date only when every short item in the form has one; the
      // form is back when its last product is.
      const backs = items.filter((x) => x.status === "short").map((x) => x.back);
      shortBack.set(g.form, backs.every((b) => b) ? (backs as string[]).sort()[backs.length - 1] : null);
    } else if (items.some((x) => x.status === "anticipated")) antForms.push(g.form);
    else clearForms.push(g.form);
  }
  const singleBack = shortForms.length === 1 ? shortBack.get(shortForms[0]) ?? null : null;
  const parts: string[] = [];
  if (shortForms.length) {
    parts.push(`${listForms(shortForms)} ${shortForms.length > 1 ? "are" : "is"} short` +
      (singleBack ? ` until about ${fmtMonth(singleBack)}` : ""));
  }
  if (antForms.length) parts.push(`${listForms(antForms)}: shortage anticipated`);
  if (clearForms.length) parts.push(`${listForms(clearForms)}: no shortage reported`);
  const answer = parts.length ? parts.join(". ") + "." : "No registered products found.";

  const products = ordered.flatMap((g) => g.products);
  return {
    market,
    registerSource: REGISTER_SOURCE[market] ?? "national register",
    noticeSource: NOTICE_SOURCE[market] ?? "regulator shortage notices",
    groups: ordered,
    answer: answer.charAt(0).toUpperCase() + answer.slice(1),
    productCount: products.length,
    shortCount: products.filter((p) => p.status === "short").length,
    combosExcluded,
  };
}
