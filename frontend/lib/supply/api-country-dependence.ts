/**
 * API country dependence — which drugs have known API manufacturers in only
 * one country, and what a single country stopping exports would leave.
 *
 * Built only from tables we already hold:
 *   - api_suppliers (source='fda_dmf') — FDA "List of Drug Master Files",
 *     active Type II DMFs (drug substance / API). One row per substance × holder.
 *   - api_suppliers.country — filled by the fda_decrs run, which name-matches
 *     each DMF holder to an FDA DECRS registered establishment and only assigns
 *     a country when every matching establishment agrees. Unmatched → NULL.
 *   - shortage_events — active / anticipated rows, to say which drugs are short
 *     or flagged by a regulator as anticipated now.
 *
 * Rows are grouped by MOLECULE, not by drugs.id: one molecule's DMFs are filed
 * under several salt and grade names ("montelukast sodium", "acetaminophen
 * dc90-10 sd") and US names (acetaminophen = paracetamol), and the DMF ingest
 * links those to different drug records or none. Grouping by drug record made
 * Montelukast look like a single-holder API (1 of its 24 DMFs).
 *
 * What this is NOT: market share, volumes, or a map of actual supply. A DMF
 * shows a firm has filed API manufacturing information with FDA. It does not
 * show FDA approval, current production, how much is made, or which market it
 * ships to, and makers that never filed a US DMF are absent. Every result
 * carries those caveats and the coverage gaps, never a bare verdict.
 */
import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { looksCombo, moleculeKey, normFirm } from "./molecule-key";

export const DMF_SOURCE_URL = "https://www.fda.gov/drugs/drug-master-files-dmfs/list-drug-master-files-dmfs";
export const DECRS_SOURCE_URL = "https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site";

export const DEPENDENCE_CAVEATS = [
  "Counts are known FDA Drug Master File (DMF) holders, not market share or supply volumes. A DMF lists firms that have filed API manufacturing information with FDA for the US market; it does not show approval, current production, volumes or where the API is shipped.",
  "Makers that never filed a US DMF (common for APIs sold mainly outside the US) are not counted. A drug with one or two DMF holders is often simply a small US product, not a global single source.",
  "Country is the country of the DMF holder's FDA-registered establishment (FDA DECRS), matched by firm name. The DMF list does not name the manufacturing site, so for a holder with plants in several countries this may not be the site that makes this API.",
  "Holders whose name could not be matched unambiguously to a DECRS establishment have no country on file. A drug is only called single-country when every one of its holders has a country.",
  "Salt forms and grades of one molecule are counted together (montelukast sodium with montelukast; acetaminophen with paracetamol). Different salts can serve different dosage forms.",
  "Holders are those listed as active when ingested; Mederti adds new DMFs each quarter but does not yet remove DMFs that later close.",
  "Shortage status is matched to the molecule by drug name; combination products are excluded.",
  "Biologics (insulins, gonadotropins, antibodies and other proteins) are left out of the single-country and what-if lists: they are licensed under BLAs, so their DMF holders do not describe where their supply comes from.",
];

// Biologics (insulins and the other proteins moved to BLAs in March 2020, antibodies)
// are licensed under BLAs: the originators' drug substance is in the licence,
// not a DMF. Their DMF holders are a few follow-on suppliers, so a DMF count
// says nothing about where their supply comes from. Kept out of the
// single-country and what-if lists and reported separately.
const BIOLOGIC = /\b(insulin|gonadotropin|menotropins|follitropin|urofollitropin|lutropin|somatropin|epoetin|darbepoetin|filgrastim|pegfilgrastim|interferon|albumin|immunoglobulin|hyaluronidase|asparaginase|alteplase|tenecteplase|botulinum|collagenase|thyrotropin|pancrelipase|imiglucerase|sacrosidase|pegvisomant|mecasermin|pegademase)\b|(mab|cept|ase alfa)$/;
export const isBiologic = (key: string) => BIOLOGIC.test(key);

// ── Index ──────────────────────────────────────────────────────────────────
type Holder = { name: string; country: string | null; dmf_numbers: string[]; substances: string[] };

export interface MoleculeDependence {
  key: string;
  /** Mederti drug record to link to (the molecule's base record where one exists). */
  drug_id: string | null;
  name: string;
  /** Every drug record whose DMF rows were grouped here. */
  drug_ids: string[];
  holders: Holder[];
  /** Countries of holders that have one, with holder counts, most first. */
  countries: { country: string; holders: number }[];
  holders_without_country: number;
  /** ISO-2 country codes with an active shortage event, and with an anticipated one. */
  short_in: string[];
  anticipated_in: string[];
}

export interface DependenceIndex {
  molecules: MoleculeDependence[];
  coverage: {
    dmf_rows: number;
    dmf_molecules: number;
    dmf_molecules_with_drug_record: number;
    distinct_holders: number;
    distinct_holders_without_country: number;
    drugs_short_or_anticipated: number;
    molecules_short_or_anticipated: number;
    molecules_short_or_anticipated_with_dmf_holder: number;
  };
  dmf_first_ingested: string | null;
  dmf_last_refreshed: string | null;
  computed_at: string;
}

const PAGE = 1000;
const PARALLEL = 8;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>;

// PostgREST caps a response at 1,000 rows. Read the total from the first page,
// then fetch the rest a few pages at a time instead of one round-trip each.
async function fetchAll<T>(build: (from: number, to: number, count: boolean) => Page<T>): Promise<T[]> {
  const head = await build(0, PAGE - 1, true);
  if (head.error) throw new Error(head.error.message);
  const out: T[] = [...(head.data ?? [])];
  const total = head.count ?? out.length;
  const starts: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) starts.push(from);
  for (let i = 0; i < starts.length; i += PARALLEL) {
    const pages = await Promise.all(starts.slice(i, i + PARALLEL).map((f) => build(f, f + PAGE - 1, false)));
    for (const p of pages) {
      if (p.error) throw new Error(p.error.message);
      out.push(...(p.data ?? []));
    }
  }
  return out;
}

async function buildIndex(): Promise<CompactIndex> {
  const sb = getSupabaseAdmin();
  type Row = { drug_id: string | null; generic_name: string; subject: string | null; manufacturer_name: string; country: string | null; dmf: string | null; created_at: string; updated_at: string };
  const rows = await fetchAll<Row>((a, b, count) =>
    sb.from("api_suppliers")
      .select("drug_id,generic_name,subject:raw_data->>subject,manufacturer_name,country,dmf:raw_data->>dmf_number,created_at,updated_at", count ? { count: "exact" } : undefined)
      .eq("source", "fda_dmf")
      .order("id")
      .range(a, b) as unknown as Page<Row>);

  type Group = { holders: Map<string, Holder>; drugIds: Set<string>; dmfOwner: Map<string, string> };
  const groups = new Map<string, Group>();
  const allHolders = new Map<string, string | null>();
  let first: string | null = null;
  let last: string | null = null;
  // Newest rows first. The ingest is insert-only, so when FDA moves a DMF to a
  // renamed holder ("Viyash Life Sciences" → "Viyash Scientific") both names
  // are stored; each DMF number counts once, under its newest holder name.
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of rows) {
    if (!first || r.created_at < first) first = r.created_at;
    if (!last || r.updated_at > last) last = r.updated_at;
    let firm = normFirm(r.manufacturer_name) || r.manufacturer_name.toLowerCase();
    const key = moleculeKey(r.generic_name);
    if (!key) continue;
    const g = groups.get(key) ?? { holders: new Map(), drugIds: new Set<string>(), dmfOwner: new Map() };
    if (r.drug_id) g.drugIds.add(r.drug_id);
    const owner = r.dmf ? g.dmfOwner.get(r.dmf) : undefined;
    if (owner) firm = owner;
    else if (r.dmf) g.dmfOwner.set(r.dmf, firm);
    if (!allHolders.get(firm)) allHolders.set(firm, r.country);
    const h = g.holders.get(firm) ?? { name: r.manufacturer_name, country: null, dmf_numbers: [], substances: [] };
    h.country ??= r.country;
    if (r.dmf && !h.dmf_numbers.includes(r.dmf)) h.dmf_numbers.push(r.dmf);
    const sub = (r.subject ?? r.generic_name).trim();
    if (!h.substances.includes(sub)) h.substances.push(sub);
    g.holders.set(firm, h);
    groups.set(key, g);
  }

  // Names of the drug records the DMF ingest linked rows to.
  const linkedIds = [...new Set([...groups.values()].flatMap((g) => [...g.drugIds]))];
  const drugName = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < linkedIds.length; i += 200) chunks.push(linkedIds.slice(i, i + 200));
  for (const res of await Promise.all(chunks.map((c) => sb.from("drugs").select("id,generic_name").in("id", c)))) {
    if (res.error) throw new Error(res.error.message);
    for (const d of res.data ?? []) drugName.set(d.id, d.generic_name);
  }

  // Shortage rows → molecule, via the drug record's resolved INN (else its name).
  // Keyset-paged (id > last) in 16 parallel slices of the UUID space: an exact
  // count or deep OFFSET over open shortage rows hits the statement timeout,
  // and one serial keyset walk is ~35 pages at ~1.7s each.
  type Ev = { id: string; drug_id: string; status: string; country_code: string | null; drugs: { generic_name: string | null; resolved_inn: string | null } | null };
  const HEX = "0123456789abcdef";
  const slices = await Promise.all([...HEX].map(async (h, i) => {
    const lo = `${h}0000000-0000-0000-0000-000000000000`;
    const hi = i < 15 ? `${HEX[i + 1]}0000000-0000-0000-0000-000000000000` : null;
    const out: Ev[] = [];
    for (let after = ""; ; ) {
      let q = sb.from("shortage_events")
        .select("id,drug_id,status,country_code,drugs(generic_name,resolved_inn)")
        .in("status", ["active", "anticipated"])
        .not("drug_id", "is", null)
        .order("id")
        .limit(PAGE);
      q = after ? q.gt("id", after) : q.gte("id", lo);
      if (hi) q = q.lt("id", hi);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as Ev[];
      out.push(...page);
      if (page.length < PAGE) return out;
      after = page[page.length - 1].id;
    }
  }));
  const events = slices.flat();

  const short = new Map<string, Set<string>>();
  const anticipated = new Map<string, Set<string>>();
  const shortDrugIds = new Set<string>();
  const shortMolecules = new Set<string>();
  // Candidate drug records per molecule, for molecules the DMF ingest never linked.
  const shortDrugFor = new Map<string, Map<string, string>>();
  for (const e of events) {
    shortDrugIds.add(e.drug_id);
    const gn = e.drugs?.generic_name ?? "";
    if (looksCombo(gn)) continue;
    const key = moleculeKey(e.drugs?.resolved_inn || gn);
    if (!key || !e.country_code) continue;
    shortMolecules.add(key);
    const m = e.status === "active" ? short : anticipated;
    const s = m.get(key) ?? new Set<string>();
    s.add(e.country_code);
    m.set(key, s);
    const c = shortDrugFor.get(key) ?? new Map<string, string>();
    c.set(e.drug_id, gn);
    shortDrugFor.set(key, c);
  }

  // Prefer the drug record whose own name is the bare molecule, then the shortest.
  const pick = (key: string, cands: [string, string][]): [string, string] | null => {
    if (!cands.length) return null;
    return [...cands].sort((a, b) =>
      Number(moleculeKey(b[1]) === key && b[1].toLowerCase() === key) - Number(moleculeKey(a[1]) === key && a[1].toLowerCase() === key) ||
      Number(moleculeKey(b[1]) === key) - Number(moleculeKey(a[1]) === key) ||
      a[1].length - b[1].length)[0];
  };

  const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const molecules: MoleculeDependence[] = [...groups].map(([key, g]) => {
    const hs = [...g.holders.values()].sort((a, b) => a.name.localeCompare(b.name));
    const cc = new Map<string, number>();
    for (const h of hs) if (h.country) cc.set(h.country, (cc.get(h.country) ?? 0) + 1);
    const linked = [...g.drugIds].map((id) => [id, drugName.get(id) ?? ""] as [string, string]);
    const chosen = pick(key, linked) ?? pick(key, [...(shortDrugFor.get(key) ?? [])].filter(([, n]) => moleculeKey(n) === key));
    return {
      key,
      drug_id: chosen?.[0] ?? null,
      name: chosen && moleculeKey(chosen[1]) === key ? chosen[1] : titleCase(key),
      drug_ids: [...g.drugIds],
      holders: hs,
      countries: [...cc].map(([country, holders]) => ({ country, holders })).sort((a, b) => b.holders - a.holders || a.country.localeCompare(b.country)),
      holders_without_country: hs.filter((h) => !h.country).length,
      short_in: [...(short.get(key) ?? [])].sort(),
      anticipated_in: [...(anticipated.get(key) ?? [])].sort(),
    };
  });

  // Next's data cache refuses entries over 2MB, and the expanded index is
  // ~2.9MB, so it is stored compact: each firm (name, country) once, holders
  // as [firm index, DMF numbers, DMF subjects], expanded again on read.
  const firmIdx = new Map<string, number>();
  const firms: [string, string | null][] = [];
  const compact: CompactMolecule[] = molecules.map((m) => [
    m.key, m.drug_id, m.name, m.drug_ids,
    m.holders.map((h) => {
      const k = `${h.name}\u0000${h.country ?? ""}`;
      let i = firmIdx.get(k);
      if (i === undefined) { i = firms.length; firms.push([h.name, h.country]); firmIdx.set(k, i); }
      return [i, h.dmf_numbers.join(","), h.substances.join("|")] as [number, string, string];
    }),
    m.short_in.join(","), m.anticipated_in.join(","),
  ]);

  return {
    firms,
    molecules: compact,
    coverage: {
      dmf_rows: rows.length,
      dmf_molecules: molecules.length,
      dmf_molecules_with_drug_record: molecules.filter((m) => m.drug_id).length,
      distinct_holders: allHolders.size,
      distinct_holders_without_country: [...allHolders.values()].filter((c) => !c).length,
      drugs_short_or_anticipated: shortDrugIds.size,
      molecules_short_or_anticipated: shortMolecules.size,
      molecules_short_or_anticipated_with_dmf_holder: molecules.filter((m) => m.short_in.length || m.anticipated_in.length).length,
    },
    dmf_first_ingested: first?.slice(0, 10) ?? null,
    dmf_last_refreshed: last?.slice(0, 10) ?? null,
    computed_at: new Date().toISOString(),
  };
}

type CompactMolecule = [key: string, drugId: string | null, name: string, drugIds: string[], holders: [number, string, string][], short: string, anticipated: string];
type CompactIndex = Omit<DependenceIndex, "molecules"> & { firms: [string, string | null][]; molecules: CompactMolecule[] };

const split = (s: string, sep: string) => (s ? s.split(sep) : []);

function expand(c: CompactIndex): DependenceIndex {
  const { firms, molecules, ...rest } = c;
  return {
    ...rest,
    molecules: molecules.map(([key, drug_id, name, drug_ids, hs, sh, an]) => {
      const holders = hs.map(([i, d, sub]) => ({ name: firms[i][0], country: firms[i][1], dmf_numbers: split(d, ","), substances: split(sub, "|") }));
      const cc = new Map<string, number>();
      for (const h of holders) if (h.country) cc.set(h.country, (cc.get(h.country) ?? 0) + 1);
      return {
        key, drug_id, name, drug_ids, holders,
        countries: [...cc].map(([country, n]) => ({ country, holders: n })).sort((a, b) => b.holders - a.holders || a.country.localeCompare(b.country)),
        holders_without_country: holders.filter((h) => !h.country).length,
        short_in: split(sh, ","),
        anticipated_in: split(an, ","),
      };
    }),
  };
}

// DMF holders change quarterly; shortage status daily. An hour is well inside
// both, and a cold build pages ~15k supplier rows plus every open shortage row.
const cachedIndex = unstable_cache(buildIndex, ["api-country-dependence-v8"], { revalidate: 3600 });
export const getDependenceIndex = async (): Promise<DependenceIndex> => expand(await cachedIndex());

// ── Country names ──────────────────────────────────────────────────────────
// api_suppliers.country holds DECRS country names. Accept those, ISO-2 codes
// and a few common aliases.
const ALIASES: Record<string, string> = {
  CN: "China", PRC: "China", IN: "India", US: "United States", USA: "United States", "UNITED STATES OF AMERICA": "United States",
  IT: "Italy", ES: "Spain", TW: "Taiwan", DE: "Germany", JP: "Japan", FR: "France", IL: "Israel", CA: "Canada",
  CH: "Switzerland", MY: "Malaysia", AT: "Austria", NL: "Netherlands", KR: "South Korea", KOREA: "South Korea",
  "KOREA, SOUTH": "South Korea", "REPUBLIC OF KOREA": "South Korea", PL: "Poland", HU: "Hungary", FI: "Finland",
  MT: "Malta", GB: "United Kingdom", UK: "United Kingdom", BE: "Belgium", AR: "Argentina", JO: "Jordan", BR: "Brazil",
  ZA: "South Africa", MX: "Mexico", DK: "Denmark", PT: "Portugal", SE: "Sweden", CZ: "Czech Republic", TR: "Turkey",
  AU: "Australia", IE: "Ireland", IS: "Iceland", GR: "Greece", NO: "Norway", MO: "Macau", SK: "Slovakia", LV: "Latvia",
  SG: "Singapore", NZ: "New Zealand", RO: "Romania", SI: "Slovenia",
};

/** Resolve user input to a country name present in the data, or null. */
export function resolveCountry(input: string, idx: DependenceIndex): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const known = new Set(idx.molecules.flatMap((d) => d.countries.map((c) => c.country)));
  const alias = ALIASES[raw.toUpperCase()];
  if (alias && known.has(alias)) return alias;
  for (const k of known) if (k.toLowerCase() === raw.toLowerCase()) return k;
  return null;
}

// ── Views ──────────────────────────────────────────────────────────────────
export type DependenceClass = "single_country" | "single_known_country_some_unknown" | "multi_country" | "no_country_data";

export function classify(d: MoleculeDependence): DependenceClass {
  if (d.countries.length === 0) return "no_country_data";
  if (d.countries.length > 1) return "multi_country";
  return d.holders_without_country === 0 ? "single_country" : "single_known_country_some_unknown";
}

const isShort = (d: MoleculeDependence) => d.short_in.length > 0 || d.anticipated_in.length > 0;

function row(d: MoleculeDependence) {
  return {
    drug_id: d.drug_id,
    name: d.name,
    dmf_holders: d.holders.length,
    holders_by_country: d.countries,
    holders_without_country: d.holders_without_country,
    holders: d.holders.map((h) => ({ name: h.name, country: h.country, dmf_numbers: h.dmf_numbers, dmf_subjects: h.substances })),
    short_now_in: d.short_in,
    anticipated_in: d.anticipated_in,
  };
}

const rank = (a: MoleculeDependence, b: MoleculeDependence) =>
  (b.short_in.length + b.anticipated_in.length) - (a.short_in.length + a.anticipated_in.length) || a.name.localeCompare(b.name);

function meta(idx: DependenceIndex) {
  return {
    sources: [
      { name: "FDA List of Drug Master Files (active Type II)", url: DMF_SOURCE_URL, first_ingested: idx.dmf_first_ingested, last_refreshed: idx.dmf_last_refreshed },
      { name: "FDA Drug Establishments Current Registration Site (DECRS) — holder country", url: DECRS_SOURCE_URL },
      { name: "Mederti shortage_events (active / anticipated, all regulators)", url: null },
    ],
    coverage: idx.coverage,
    computed_at: idx.computed_at,
    caveats: DEPENDENCE_CAVEATS,
  };
}

/** "Which drugs depend on API manufacturers in only one country?" */
export function singleCountryView(idx: DependenceIndex, opts: { country?: string | null; shortOnly?: boolean; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const all = idx.molecules.filter((d) => !opts.shortOnly || isShort(d));
  const universe = all.filter((d) => !isBiologic(d.key));
  const biologics = all.filter((d) => isBiologic(d.key));
  const scope = (d: MoleculeDependence) => !opts.country || d.countries[0]?.country === opts.country;

  const counts: Record<DependenceClass, number> = { single_country: 0, single_known_country_some_unknown: 0, multi_country: 0, no_country_data: 0 };
  for (const d of universe) counts[classify(d)]++;

  const single = universe.filter((d) => classify(d) === "single_country" && scope(d)).sort(rank);
  const partial = universe.filter((d) => classify(d) === "single_known_country_some_unknown" && scope(d)).sort(rank);
  const byCountry = new Map<string, number>();
  for (const d of universe) if (classify(d) === "single_country") {
    const c = d.countries[0].country;
    byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
  }
  return {
    question: "Molecules whose known FDA DMF API holders are all in one country",
    filters: { country: opts.country ?? null, short_or_anticipated_only: !!opts.shortOnly },
    molecules_in_scope: universe.length,
    classification_counts: counts,
    single_country_by_country: [...byCountry].map(([country, molecules]) => ({ country, molecules })).sort((a, b) => b.molecules - a.molecules),
    single_country: {
      total: single.length,
      with_one_holder_only: single.filter((d) => d.holders.length === 1).length,
      items: single.slice(0, limit).map(row),
    },
    single_known_country_some_unknown: {
      note: "Every holder with a known country is in one country, but at least one holder has no country on file — cannot be called single-country.",
      total: partial.length,
      items: partial.slice(0, limit).map(row),
    },
    biologics_excluded: { total: biologics.length, names: biologics.map((d) => d.name).sort().slice(0, 30) },
    ...meta(idx),
  };
}

/** "If country X stopped exporting, which short / anticipated drugs lose all known API holders?" */
export function whatIfView(idx: DependenceIndex, country: string, opts: { includeNotShort?: boolean; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const scoped = idx.molecules.filter((d) => opts.includeNotShort || isShort(d));
  const inScope = scoped.filter((d) => !isBiologic(d.key));
  const biologics = scoped.filter((d) => isBiologic(d.key) && d.countries.some((c) => c.country === country));
  const onlyHere = (d: MoleculeDependence) => d.countries.length === 1 && d.countries[0].country === country;
  const all = inScope.filter((d) => onlyHere(d) && d.holders_without_country === 0).sort(rank);
  const known = inScope.filter((d) => onlyHere(d) && d.holders_without_country > 0).sort(rank);
  const partly = inScope.filter((d) => d.countries.length > 1 && d.countries.some((c) => c.country === country));
  return {
    question: `If ${country} stopped exporting API, which ${opts.includeNotShort ? "" : "currently short or anticipated "}molecules lose all known FDA DMF holders?`,
    scenario_country: country,
    scope: opts.includeNotShort ? "all molecules with an FDA DMF holder" : "molecules with an active or anticipated shortage in at least one market",
    molecules_in_scope: inScope.length,
    lose_all_known_holders: {
      note: `Every known DMF holder is in ${country} and every holder has a country on file.`,
      total: all.length,
      items: all.slice(0, limit).map(row),
    },
    lose_all_holders_with_known_country: {
      note: `Every holder with a known country is in ${country}, but some holders have no country on file — they may or may not be in ${country}.`,
      total: known.length,
      items: known.slice(0, limit).map(row),
    },
    keep_holders_elsewhere: {
      note: `Have DMF holders in ${country} and in at least one other country.`,
      total: partly.length,
    },
    biologics_excluded: {
      note: `Biologics with a DMF holder in ${country}. Not assessed: they are licensed under BLAs, so DMF holders do not show where their supply comes from.`,
      total: biologics.length,
      names: biologics.map((d) => d.name).sort().slice(0, 30),
    },
    ...meta(idx),
  };
}

/** One molecule's breakdown, found by a drug record id or a name. */
export function moleculeView(idx: DependenceIndex, by: { drugId?: string | null; name?: string | null }) {
  let d = by.drugId ? idx.molecules.find((m) => m.drug_id === by.drugId || m.drug_ids.includes(by.drugId!)) : undefined;
  const key = moleculeKey(by.name);
  if (!d && key) d = idx.molecules.find((m) => m.key === key);
  if (!d) return null;
  return {
    ...row(d),
    classification: classify(d),
    ...(isBiologic(d.key) ? { biologic_note: "Biologic licensed under a BLA: the originator's drug substance is not in a DMF, so these DMF holders do not show where its supply comes from." } : {}),
    ...meta(idx),
  };
}
