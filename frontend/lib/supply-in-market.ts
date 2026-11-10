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
  label: string;               // short label for sentences: brand + strength ("Amoxil 250mg")
  strength: string | null;     // normalised strength ("250mg", "125mg/5ml"), from the register or the name
  // Every open notice on this product is a discontinuation (TGA reason
  // "discontinuation"): a permanent market exit, not a temporary shortage.
  discontinued: boolean;
  exitDate: string | null;     // registration end date the regulator gives for a discontinuation
  sponsor: string | null;
  regNos: string[];
  status: SupplyStatus;
  since: string | null;        // ISO date the shortage started (short) / is expected (anticipated)
  back: string | null;         // ISO estimated return, only when still in the future
  backPassed: boolean;         // the regulator's estimate has passed without an update
  sourceUrl: string | null;
  // Past (resolved) regulator notices for this exact product, matched by
  // registration number only. "No shortage reported" today can hide a product
  // that has been short on and off for years (Barwon Health, Fresofol: 3 TGA
  // notices in 2026). Counted per distinct start date.
  history: { count: number; last: string | null } | null;
}

export interface SupplyNotice {
  label: string;               // product named on the notice, or "Ingredient-level notice"
  status: Exclude<SupplyStatus, "none">;
  discontinued: boolean;
  since: string | null;
  back: string | null;
  backPassed: boolean;
  sourceUrl: string | null;
}

export interface SupplyGroup {
  form: string;                // "Injection", "Tablets", …
  slug: string;                // URL value for the form picker ("capsules", "oral-liquid")
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
  shortCount: number;          // products with an open notice now (short + discontinued)
  discCount: number;           // of which discontinued
  antCount: number;            // products with only an anticipated notice
  combosExcluded: number;      // combination products / notices left out
  forms: FormSummary[];        // per-form counts for the form picker, in table order
}

export interface FormSummary {
  form: string;
  slug: string;
  total: number;               // registered products in the form
  affected: number;            // with an open (short or discontinued) notice
  discontinued: number;        // of which every open notice is a discontinuation
  anticipated: number;
  unmatched: number;           // open notices in the form not tied to a product
  strengths: { strength: string; total: number; affected: number; discontinued: number }[];
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
  discontinued?: boolean;      // reason_category = discontinuation
  exitDate?: string | null;    // regulator-stated registration end date (TGA deleted_date)
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

export function isCombo(name: string | null, ingredients?: unknown): boolean {
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

export function formSlug(form: string): string {
  return form.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mg|g|mcg|microgram(?:s)?|µg|ml|iu|units?|%)(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|g|dose|actuation)?)?/i;

/** "250 mg" / "125 mg/5 mL" → "250mg" / "125mg/5ml". Null when none is stated. */
export function normStrength(...texts: (string | null)[]): string | null {
  const found: string[] = [];
  for (const t of texts) {
    const m = t ? STRENGTH_RE.exec(t) : null;
    if (!m) continue;
    const unit = m[2].toLowerCase().replace(/^micrograms?$|^µg$/, "mcg").replace(/^units?$/, "unit");
    const per = m[4] ? `/${m[3] ?? ""}${m[4].toLowerCase()}` : "";
    found.push(`${m[1]}${unit}${per}`);
  }
  // A register strength of "125 mg" for a "125mg/5mL" liquid drops the
  // volume; prefer the fuller form of the same amount.
  const full = found.find((f) => f.includes("/") && found[0] && f.startsWith(found[0]));
  return full ?? found[0] ?? null;
}

/** Brand part of a register name: the words before the active ingredient. */
function brandOf(name: string, ingredient: string | null): string {
  if (ingredient) {
    // First occurrence after the start: "Amoxicillin-WGR amoxicillin …" → "Amoxicillin-WGR".
    const re = new RegExp(`\\b${ingredient}\\b`, "gi");
    for (const m of name.matchAll(re)) if (m.index > 0) return name.slice(0, m.index).trim();
  }
  const m = /^(.*?)(\s+\d|\s*$)/.exec(name);
  return (m?.[1] || name).trim();
}

/** Summary sentence for a set of form groups. A form is called short only
 *  when every product in it is; otherwise the affected products are named. */
function summarise(groups: SupplyGroup[]): string {
  const parts: string[] = [];
  const clear: string[] = [];
  for (const g of groups) {
    const prods = g.products;
    const hit = prods.filter((p) => p.status === "short");
    const ant = prods.filter((p) => p.status === "anticipated");
    const openNotices = g.notices.filter((n) => n.status === "short");
    const word = (xs: { discontinued: boolean }[]) =>
      xs.every((x) => x.discontinued) ? "discontinued" : xs.some((x) => x.discontinued) ? "short or discontinued" : "short";
    if (prods.length > 0 && hit.length === prods.length) {
      const backs = hit.map((p) => p.back);
      const back = hit.every((p) => !p.discontinued) && backs.every(Boolean) ? (backs as string[]).sort()[backs.length - 1] : null;
      const who = prods.length === 1 ? "the only product is" : `all ${prods.length} products are`;
      parts.push(`${g.form}: ${who} ${word(hit)}${back ? ` until about ${fmtMonth(back)}` : ""}`);
    } else if (hit.length > 0) {
      const names = hit.slice(0, 3).map((p) => p.label).join(", ") + (hit.length > 3 ? ` +${hit.length - 3} more` : "");
      parts.push(`${g.form}: ${hit.length} of ${prods.length} product${prods.length === 1 ? "" : "s"} ${word(hit)} (${names})`);
    } else if (ant.length > 0) {
      parts.push(`${g.form}: shortage anticipated for ${ant.length} of ${prods.length} product${prods.length === 1 ? "" : "s"}`);
    } else if (openNotices.length > 0) {
      parts.push(`${g.form}: ${openNotices.length} shortage notice${openNotices.length === 1 ? "" : "s"} not matched to a registered product`);
    } else {
      clear.push(g.form);
      continue;
    }
    if (openNotices.length > 0 && prods.length > 0) {
      parts[parts.length - 1] += `, plus ${openNotices.length} notice${openNotices.length === 1 ? "" : "s"} not matched to a product`;
    }
  }
  if (clear.length) parts.push(`${listForms(clear)}: no shortage reported`);
  return parts.length ? parts.join(". ") + "." : "No registered products found.";
}

function finish(base: Omit<SupplyInMarket, "groups" | "answer" | "productCount" | "shortCount" | "discCount" | "antCount" | "forms">, groups: SupplyGroup[]): SupplyInMarket {
  const products = groups.flatMap((g) => g.products);
  const forms: FormSummary[] = groups.map((g) => {
    const byStrength = new Map<string, { total: number; affected: number; discontinued: number }>();
    for (const p of g.products) {
      if (!p.strength) continue;
      const v = byStrength.get(p.strength) ?? { total: 0, affected: 0, discontinued: 0 };
      v.total++;
      if (p.status === "short") v.affected++;
      if (p.status === "short" && p.discontinued) v.discontinued++;
      byStrength.set(p.strength, v);
    }
    return {
      form: g.form,
      slug: g.slug,
      total: g.products.length,
      affected: g.products.filter((p) => p.status === "short").length,
      discontinued: g.products.filter((p) => p.status === "short" && p.discontinued).length,
      anticipated: g.products.filter((p) => p.status === "anticipated").length,
      unmatched: g.notices.filter((n) => n.status === "short").length,
      strengths: [...byStrength.entries()]
        .map(([strength, v]) => ({ strength, ...v }))
        .sort((a, b) => parseFloat(a.strength) - parseFloat(b.strength) || a.strength.localeCompare(b.strength)),
    };
  });
  return {
    ...base,
    groups,
    answer: summarise(groups),
    productCount: products.length,
    shortCount: products.filter((p) => p.status === "short").length,
    discCount: products.filter((p) => p.status === "short" && p.discontinued).length,
    antCount: products.filter((p) => p.status === "anticipated").length,
    forms,
  };
}

/** The same supply picture narrowed to one dose form (and optionally one
 *  strength), for the form/strength picker. Returns null when nothing matches. */
export function scopeSupply(s: SupplyInMarket, formSlugSel?: string | null, strength?: string | null): SupplyInMarket | null {
  if (!formSlugSel) return s;
  const g = s.groups.find((x) => x.slug === formSlugSel);
  if (!g) return null;
  const products = strength ? g.products.filter((p) => p.strength === strength) : g.products;
  if (strength && products.length === 0) return null;
  // Unmatched notices carry no strength, so they only stay in a form-wide view.
  const scoped: SupplyGroup = { ...g, products, notices: strength ? [] : g.notices };
  const { groups: _g, answer: _a, productCount: _p, shortCount: _s, discCount: _d, antCount: _n, forms: _f, ...base } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return finish(base, [scoped]);
}

/** Same medicine, same form and strength, with no notice: what a pharmacist
 *  can dispense instead of the affected products. Strict — a product with no
 *  stated strength never matches. */
export function sameIngredientOptions(s: SupplyInMarket): SupplyProduct[] {
  const out = new Map<string, SupplyProduct>();
  for (const g of s.groups) {
    const hit = g.products.filter((p) => p.status === "short" && p.strength);
    for (const h of hit) {
      for (const p of g.products) {
        if (p.status === "none" && p.strength === h.strength) out.set(p.name, p);
      }
    }
  }
  return [...out.values()];
}

export function buildSupplyInMarket(
  market: string,
  catalogue: CatalogueRow[],
  notices: MarketNotice[],
  ingredient?: string | null,
): SupplyInMarket | null {
  const ingWord = (ingredient ?? "").toLowerCase().match(/[a-z]+/)?.[0] ?? null;
  const named = catalogue.filter((r) => r.brand_name);
  if (named.length === 0) return null; // no register data for this market → caller falls back
  const rows = named.filter((r) => !isCombo(r.brand_name, r.active_ingredients));
  let combosExcluded = named.length - rows.length;

  // One product per name (pack words removed) + strength + form + sponsor. The
  // last three matter where a register uses the generic name as the product
  // name for every firm (US: every row is "Amoxicillin").
  const byKey = new Map<string, { name: string; sponsor: string | null; regNos: Set<string>; form: string; strength: string | null }>();
  for (const r of rows) {
    const key = [productKey(r.brand_name!), (r.strength ?? "").toLowerCase(), (r.dosage_form ?? "").toLowerCase(), (r.sponsor ?? "").toLowerCase()].join("|");
    const nameLc = r.brand_name!.toLowerCase();
    const extras = [
      r.strength && !nameLc.includes(r.strength.toLowerCase().replace(/\s+/g, "")) && !nameLc.includes(r.strength.toLowerCase()) ? r.strength : null,
      r.dosage_form && !nameLc.includes(r.dosage_form.toLowerCase()) ? r.dosage_form.toLowerCase() : null,
    ].filter(Boolean);
    const p = byKey.get(key) ?? { name: [displayName(r.brand_name!), ...extras].join(" "), sponsor: r.sponsor, regNos: new Set<string>(), form: formOf(r.dosage_form, r.brand_name), strength: normStrength(r.strength, r.brand_name) };
    if (r.registration_number) p.regNos.add(r.registration_number.trim());
    p.sponsor = p.sponsor ?? r.sponsor;
    byKey.set(key, p);
  }

  // Resolved notices → per-product history, exact registration match only.
  const pastByReg = new Map<string, Set<string>>(); // reg digits → start dates
  for (const n of notices) {
    const reg = regDigits(n.regNo);
    if (n.status !== "resolved" || !reg || !n.start_date) continue;
    pastByReg.set(reg, (pastByReg.get(reg) ?? new Set()).add(n.start_date));
  }
  const historyOf = (regNos: Set<string>) => {
    const starts = new Set<string>();
    for (const r of regNos) {
      const d = regDigits(r);
      for (const s of (d && pastByReg.get(d)) || []) starts.add(s);
    }
    if (starts.size === 0) return null;
    return { count: starts.size, last: [...starts].sort().pop() ?? null };
  };

  const openAll = notices.filter((n) => n.status === "active" || n.status === "anticipated");
  const matched = new Map<string, MarketNotice[]>(); // product key → notices
  const unmatched: MarketNotice[] = [];
  for (const n of openAll) {
    const reg = regDigits(n.regNo);
    let hit: string | null = null;
    // A registration-number match wins over the combination rule: the notice
    // is about a product we already show (e.g. "TEVA-TELMISARTAN HCTZ", whose
    // register name doesn't look like a combination but whose notice lists
    // two ingredients), so it must not leave that row reading "no shortage".
    if (reg) {
      for (const [k, p] of byKey) if ([...p.regNos].some((x) => regDigits(x) === reg)) { hit = k; break; }
    }
    if (!hit && isCombo(n.productName, n.ingredients)) { combosExcluded++; continue; }
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
    if (!groups.has(form)) groups.set(form, { form, slug: formSlug(form), products: [], notices: [] });
    return groups.get(form)!;
  };

  for (const [k, p] of byKey) {
    const ns = matched.get(k) ?? [];
    const active = ns.filter((n) => n.status === "active");
    const ant = ns.filter((n) => n.status === "anticipated");
    const status: SupplyStatus = active.length ? "short" : ant.length ? "anticipated" : "none";
    const use = active.length ? active : ant;
    const disc = active.length > 0 && active.every((n) => n.discontinued);
    const brand = brandOf(p.name, ingWord);
    group(p.form).products.push({
      name: p.name,
      // "Alphamox 250" already carries its strength; don't repeat it.
      label: [brand, p.strength && !brand.includes(p.strength.match(/^[\d.]+/)?.[0] ?? "\u0000") ? p.strength : null].filter(Boolean).join(" "),
      strength: p.strength,
      discontinued: disc,
      exitDate: disc ? ((active.map((n) => n.exitDate).filter(Boolean) as string[]).sort().pop() ?? null) : null,
      sponsor: p.sponsor,
      regNos: [...p.regNos].sort(),
      status,
      since: status === "short" ? minDate(use.map((n) => n.start_date))
        : status === "anticipated" ? minDate(use.map((n) => n.anticipated_start_date ?? n.start_date)) : null,
      ...backFields(status === "none" ? null : minDate(use.map((n) => n.estimated_resolution_date))),
      sourceUrl: use.find((n) => n.source_url)?.source_url ?? null,
      history: historyOf(p.regNos),
    });
  }
  for (const n of unmatched) {
    group(formOf(n.doseForm, n.productName)).notices.push({
      label: n.productName ? displayName(n.productName) : "Ingredient-level notice: no product named",
      status: n.status === "active" ? "short" : "anticipated",
      discontinued: n.status === "active" && !!n.discontinued,
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

  return finish({
    market,
    registerSource: REGISTER_SOURCE[market] ?? "national register",
    noticeSource: NOTICE_SOURCE[market] ?? "regulator shortage notices",
    combosExcluded,
  }, ordered);
}
