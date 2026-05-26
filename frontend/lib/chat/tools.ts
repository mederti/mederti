import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./supabase";
import { coverageGate } from "./coverage";
import type {
  ClassSummary,
  ClassTopDrug,
  DrugDetail,
  DrugSummary,
  RecallRow,
  ShortageRow,
  SubstituteRow,
  SupplierPriceRow,
} from "./types";

export const TOOL_DEFINITIONS: Anthropic.ToolUnion[] = [
  // Anthropic server-side web search — used freely as a primary research tool
  // alongside the DB, not just for macro/news questions. Claude-led synthesis
  // means most substantive answers weave in current reporting and structural
  // context the DB rows alone can't surface. The API resolves the call itself;
  // we never dispatch to executeTool for this.
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5,
  },
  {
    name: "query_intelligence_sources",
    description:
      "Browse Mederti's catalog of 124 vetted macro intelligence sources (regulators, IGOs, specialist outlets, journals) for pharmaceutical supply chains. Use this on macro / geopolitical / policy questions to ground the answer in canonical sources — pair with web_search for current news. Returns sources matching the filters with their name, owning org, category, geography and a short note on what they cover.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text keywords to match against source name and notes (e.g. 'India regulator', 'biosimilar EU', 'API supply China').",
        },
        category: {
          type: "string",
          description: "Optional category filter (e.g. 'regulator', 'IGO', 'specialist press', 'journal', 'investigative').",
        },
        geography: {
          type: "string",
          description: "Optional geography filter — matches against geography_coverage (e.g. 'EU', 'US', 'Global', 'India').",
        },
        regulators_only: {
          type: "boolean",
          description: "If true, restrict to medicines regulators only.",
        },
        limit: { type: "number", description: "Max results (default 8, cap 15)." },
      },
      required: [],
    },
  },
  {
    name: "search_drugs",
    description:
      "Search the Mederti drug master list by name (generic or brand). Returns a compact list of matching drugs with their IDs. Use this before any other drug-specific tool when the user names a drug — never invent a drug_id.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Drug name (generic or brand). Required." },
        country: {
          type: "string",
          description: "Optional ISO-2 country code (e.g. AU, GB, US) to bias results toward drugs with shortage activity in that country.",
        },
        limit: { type: "number", description: "Max results (default 5, hard cap 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_drug_details",
    description:
      "Get the full record for one drug — generic + brand names, ATC code, drug class, dosage forms, strengths, current shortage status across all countries, AND an `external_identifiers` block carrying any cross-reference IDs the database holds (atc_code, atc_code_full, rxcui, unii, cas_number, ema_product_number, snomed_ct_code, chembl_id). Coverage of external_identifiers is partial — only the keys present in the response have known values; absent keys mean Mederti doesn't have that ID for this drug. Call this once you have a drug_id from search_drugs to populate a drug card, OR when the user asks for a specific identifier (CAS, UNII, RxCUI, EMA number, etc.) for a drug.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "UUID returned by search_drugs." },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "find_substitutes",
    description:
      "Find substitution candidates for a drug based on ATC-class matching from the drug_alternatives table. Each candidate includes a similarity_score, clinical evidence level (A=RCT … D=expert opinion), and a flag for whether the alternative is itself in shortage. Returns empty if no alternatives are recorded — substitution data is only available for ~100 high-priority drugs.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "UUID of the drug to substitute." },
        country: {
          type: "string",
          description: "Optional ISO-2 country code; rank alternatives by their availability in this country.",
        },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "list_active_shortages",
    description:
      "Browse currently active shortages across the platform. Use for trending / discovery queries like 'what's in shortage in Australia right now', 'show me critical antibiotic shortages', or 'is Sandoz reporting any shortages'. Returns the most recent shortages first.",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO-2 country code (e.g. AU, US)." },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filter by severity.",
        },
        atc_prefix: {
          type: "string",
          description: "ATC code prefix (e.g. 'J01' = antibacterials, 'N02' = analgesics).",
        },
        manufacturer: {
          type: "string",
          description:
            "Filter to shortages affecting drugs made by a specific manufacturer/sponsor (e.g. 'Sandoz', 'Sun Pharma', 'GSK'). Resolves via drug_products → sponsors; matches by ILIKE on sponsor name.",
        },
        limit: { type: "number", description: "Max results (default 10, cap 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_trade_prices",
    description:
      "Get supplier-listed trade prices for a drug across countries. NOTE: per-drug pricing coverage is sparse — Mederti only has direct supplier listings for a small subset of drugs. Returns an empty array if no prices are on file. Do NOT invent prices when this returns nothing; tell the user pricing data is not yet available for that drug.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "UUID of the drug." },
        countries: {
          type: "array",
          items: { type: "string" },
          description: "Optional ISO-2 country filter. Default: any.",
        },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "summarize_shortage_landscape",
    description:
      "ONE-CALL landscape summary for class/region/severity-level questions ('show critical antibiotic shortages globally', 'what's in shortage in oncology in the EU', 'how bad is the cardiovascular shortage picture'). Returns: aggregate counts, severity distribution, country distribution, top affected drugs (with drug_ids you can drug_card), WHO essential / EU critical overlap, **sources_consulted** (the regulators whose feeds backed this answer — TGA, FDA, MHRA, ANVISA etc. — with row counts, latest event dates, and last_scraped_at where available), and a notes block flagging data caveats. PREFER this over multiple list_active_shortages calls when the user is asking for a landscape — a single tool call beats N row-level fetches and lets you spend tokens on synthesis. The sources_consulted block is what makes Mederti's answer verifiable in a way pure web-search answers can't be — always surface it as a <sources>...</sources> block in the response.",
    input_schema: {
      type: "object",
      properties: {
        atc_prefix: {
          type: "string",
          description:
            "ATC code prefix to scope the landscape (e.g. 'J01' = antibacterials, 'L01' = antineoplastics, 'C' = cardiovascular). Omit for an unscoped global view.",
        },
        country: {
          type: "string",
          description: "Optional ISO-2 country code to scope. Omit for global.",
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description:
            "Optional severity filter. If the user asks for 'critical' and nothing comes back, the response includes broaden=true with the unfiltered counts so you can say 'no rows tagged critical, but here's what's active'.",
        },
        top_n: {
          type: "number",
          description: "How many top drugs to return (default 8, cap 15).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_class_summary",
    description:
      "Build a CLASS card for a single ATC code (e.g. 'L01', 'J01CR05', 'C09'). Returns the class name, drug count, severity mix, top affected drugs, a trend signal (rising/stable/falling/insufficient_data), and the regulator provenance — populated into ctx.classes so you can emit <class_card atc=\"L01\" /> and the frontend renders the rich card. Use this for class-scoped Mode C questions ('show oncology shortages', 'how bad are antibiotics globally') INSTEAD of the <kpis> grid. For unscoped multi-class queries ('show critical shortages globally'), keep using <kpis>. The class card replaces the KPI grid — don't emit both.",
    input_schema: {
      type: "object",
      properties: {
        atc_code: {
          type: "string",
          description: "ATC code prefix (any depth — L01 for the L01 anatomical group, J01CR05 for a specific substance class). Case-insensitive.",
        },
        country: {
          type: "string",
          description: "Optional ISO-2 country scope. Omit for global.",
        },
      },
      required: ["atc_code"],
    },
  },
  {
    name: "search_recalls",
    description:
      "Search recent drug recalls by name. Returns recall_class (I=most severe, III=least), reason, manufacturer, announced_date, and the regulator's press release URL.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Drug name (generic or brand)." },
        country: { type: "string", description: "Optional ISO-2 country code." },
        since: { type: "string", description: "Optional ISO date (YYYY-MM-DD); only return recalls announced on or after this date." },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
];

export type ToolContext = {
  drugs: Record<string, DrugDetail>;
  subs: Record<string, SubstituteRow>;
  /** Hydrated class summaries keyed by ATC code (uppercase). Populated by
   *  get_class_summary; consumed by the frontend when it sees <class_card />.*/
  classes: Record<string, ClassSummary>;
};

export function newContext(): ToolContext {
  return { drugs: {}, subs: {}, classes: {} };
}

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function worstSeverity(rows: ShortageRow[]): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const r of rows) {
    if (r.status !== "active") continue;
    const n = SEV_ORDER[r.severity || ""] || 0;
    if (n > bestN) {
      best = r.severity;
      bestN = n;
    }
  }
  return best;
}

function shortageSummary(rows: ShortageRow[]) {
  const active = rows.filter((r) => r.status === "active");
  const countries = Array.from(new Set(active.map((r) => r.country_code).filter(Boolean) as string[]));
  return {
    active_shortage_count: active.length,
    worst_severity: worstSeverity(rows),
    countries_affected: countries,
  };
}

async function searchDrugs(args: {
  query: string;
  country?: string;
  limit?: number;
}): Promise<DrugSummary[]> {
  const sb = getSupabase();
  const limit = Math.min(args.limit ?? 5, 10);
  const q = args.query.trim();
  if (!q) return [];

  const tsQuery = q.split(/\s+/).filter(Boolean).join(" & ");

  const fts = await sb
    .from("drugs")
    .select("id,generic_name,brand_names,atc_code,atc_description,drug_class,dosage_forms,strengths")
    .textSearch("search_vector", tsQuery, { config: "english" })
    .not("atc_code", "is", null)
    .limit(limit);

  let rows: any[] = fts.data ?? [];

  if (rows.length === 0) {
    const pattern = `%${q.replace(/[%_]/g, "")}%`;
    const ilk = await sb
      .from("drugs")
      .select("id,generic_name,brand_names,atc_code,atc_description,drug_class,dosage_forms,strengths,brand_names_text")
      .or(`generic_name.ilike.${pattern},brand_names_text.ilike.${pattern}`)
      .not("atc_code", "is", null)
      .limit(limit);
    rows = ilk.data ?? [];

    if (rows.length === 0) {
      const open = await sb
        .from("drugs")
        .select("id,generic_name,brand_names,atc_code,atc_description,drug_class,dosage_forms,strengths,brand_names_text")
        .or(`generic_name.ilike.${pattern},brand_names_text.ilike.${pattern}`)
        .limit(limit);
      rows = open.data ?? [];
    }
  }

  return rows.map((r: any) => ({
    drug_id: r.id,
    name: r.generic_name,
    generic_name: r.generic_name,
    brand_names: r.brand_names ?? [],
    atc_code: r.atc_code,
    atc_description: r.atc_description,
    drug_class: r.drug_class,
    dosage_forms: r.dosage_forms ?? [],
    strengths: r.strengths ?? [],
  }));
}

async function getDrugDetails(args: { drug_id: string }, ctx: ToolContext): Promise<DrugDetail | null> {
  const sb = getSupabase();
  // Wide select includes external_identifier columns from migrations 024 + 035.
  // If migration 035 (cas_number, ema_product_number) hasn't been applied to
  // this DB, PostgREST 400s the whole query — fall back to a safe column set
  // so drug_card always renders. The external_identifiers block just degrades
  // to whatever the safe set carries.
  let drug = await sb
    .from("drugs")
    .select(
      "id,generic_name,brand_names,atc_code,atc_code_full,atc_description,drug_class,dosage_forms,strengths,routes_of_administration,therapeutic_category,who_essential_medicine,critical_medicine_eu,rxcui,unii,cas_number,ema_product_number,snomed_ct_code,chembl_id"
    )
    .eq("id", args.drug_id)
    .single();
  if (drug.error) {
    console.warn(
      `[getDrugDetails] wide select failed for ${args.drug_id} (${drug.error.message}) — retrying without migration-035 columns`
    );
    drug = await sb
      .from("drugs")
      .select(
        "id,generic_name,brand_names,atc_code,atc_description,drug_class,dosage_forms,strengths,routes_of_administration,therapeutic_category,who_essential_medicine,critical_medicine_eu,rxcui,unii,snomed_ct_code,chembl_id"
      )
      .eq("id", args.drug_id)
      .single();
  }
  if (drug.error || !drug.data) {
    console.warn(`[getDrugDetails] fallback select also failed for ${args.drug_id}: ${drug.error?.message ?? "no data"}`);
    return null;
  }
  const d: any = drug.data;

  const shortages = await sb
    .from("shortage_events")
    .select("country,country_code,status,severity,reason,start_date,estimated_resolution_date,source_url")
    .eq("drug_id", args.drug_id)
    .order("start_date", { ascending: false })
    .limit(50);

  const rows: ShortageRow[] = (shortages.data ?? []) as ShortageRow[];
  const summary = shortageSummary(rows);

  // Per-drug provenance — only attribute regulators where this drug has an
  // ACTIVE row. A drug that resolved everywhere shouldn't claim "verified by
  // TGA" just because there's a historical entry.
  const activeRows = rows.filter((r) => r.status === "active");
  const sourcesConsulted = activeRows.length > 0
    ? await computeSourcesConsulted(activeRows as any)
    : undefined;

  // External / cross-reference identifiers. Only include keys we actually
  // have a value for — passing `null` would let the model claim the drug
  // "has" the ID. Empty block becomes undefined so it disappears entirely.
  const externalIdentifiers: Record<string, string> = {};
  const pickId = (k: string, v: unknown) => {
    if (typeof v === "string" && v.trim()) externalIdentifiers[k] = v.trim();
  };
  pickId("atc_code", d.atc_code);
  pickId("atc_code_full", d.atc_code_full);
  pickId("rxcui", d.rxcui);
  pickId("unii", d.unii);
  pickId("cas_number", d.cas_number);
  pickId("ema_product_number", d.ema_product_number);
  pickId("snomed_ct_code", d.snomed_ct_code);
  pickId("chembl_id", d.chembl_id);

  const detail: DrugDetail = {
    drug_id: d.id,
    name: d.generic_name,
    generic_name: d.generic_name,
    brand_names: d.brand_names ?? [],
    atc_code: d.atc_code,
    atc_description: d.atc_description,
    drug_class: d.drug_class,
    dosage_forms: d.dosage_forms ?? [],
    strengths: d.strengths ?? [],
    routes_of_administration: d.routes_of_administration ?? [],
    therapeutic_category: d.therapeutic_category,
    who_essential_medicine: !!d.who_essential_medicine,
    critical_medicine_eu: !!d.critical_medicine_eu,
    shortages: rows,
    ...summary,
    sources_consulted: sourcesConsulted,
    external_identifiers: Object.keys(externalIdentifiers).length > 0
      ? externalIdentifiers
      : undefined,
  };

  ctx.drugs[detail.drug_id] = detail;
  return detail;
}

// Public helper used by /api/drug/[id] — same shape, no ctx mutation.
export async function fetchDrugDetail(drugId: string): Promise<DrugDetail | null> {
  const ctx = newContext();
  return getDrugDetails({ drug_id: drugId }, ctx);
}

// Public helper for the pane: substitutes for a given drug, hydrated.
export async function fetchSubstitutesFor(drugId: string, country?: string, limit = 6): Promise<SubstituteRow[]> {
  const ctx = newContext();
  return findSubstitutes({ drug_id: drugId, country, limit }, ctx);
}

// Public helper: actual product registrations for a drug. Same bridge as the manufacturer
// query (drug_products.product_name + trade_name ILIKE on drug's generic + brands), but
// returns individual product rows (with strength, form, sponsor name) rather than aggregating.
// Used by the Products section in the pane — answers "do they have amoxicillin 500mg?".
export async function fetchProductsForDrug(
  drugId: string,
  opts: { country?: string; limit?: number } = {}
) {
  const sb = getSupabase();
  const drug = await sb
    .from("drugs")
    .select("id,generic_name,brand_names")
    .eq("id", drugId)
    .single();
  if (drug.error || !drug.data) return [] as Array<any>;
  const d: any = drug.data;
  const generic = (d.generic_name || "").trim();
  const brands: string[] = d.brand_names ?? [];
  if (!generic && brands.length === 0) return [];

  const esc = (s: string) => s.replace(/[%_,)(]/g, "").trim();
  const conditions: string[] = [];
  if (generic) {
    const g = esc(generic);
    conditions.push(`product_name.ilike.%${g}%`);
    conditions.push(`trade_name.ilike.%${g}%`);
  }
  for (const b of brands.slice(0, 6)) {
    const x = esc(b);
    if (!x) continue;
    conditions.push(`product_name.ilike.%${x}%`);
    conditions.push(`trade_name.ilike.%${x}%`);
  }
  if (conditions.length === 0) return [];

  let q = sb
    .from("drug_products")
    .select("id,product_name,trade_name,strength,dosage_form,route,country,sponsor_id,registry_status,pbs_listed,is_generic")
    .or(conditions.join(","))
    .limit(opts.limit ?? 200);
  if (opts.country) q = q.eq("country", opts.country);
  // Prefer currently-registered rows when available.
  q = q.order("registration_date", { ascending: false });

  const { data, error } = await q;
  if (error) {
    console.error("[fetchProductsForDrug] error:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Resolve sponsor names in one batched lookup.
  const sponsorIds = Array.from(new Set(rows.map((r: any) => r.sponsor_id).filter(Boolean)));
  let sponsorMap = new Map<string, string>();
  if (sponsorIds.length > 0) {
    const sp = await sb.from("sponsors").select("id,name").in("id", sponsorIds);
    sponsorMap = new Map((sp.data ?? []).map((s: any) => [s.id, s.name]));
  }

  return rows.map((r: any) => ({
    product_id: r.id,
    product_name: r.product_name,
    trade_name: r.trade_name,
    strength: r.strength,
    dosage_form: r.dosage_form,
    route: r.route,
    country: r.country,
    sponsor_id: r.sponsor_id,
    sponsor_name: r.sponsor_id ? sponsorMap.get(r.sponsor_id) ?? null : null,
    registry_status: r.registry_status,
    pbs_listed: r.pbs_listed,
    is_generic: r.is_generic,
  }));
}

// Public helper: manufacturers that make this drug, bridged via drug_products → sponsors.
// drug_products doesn't carry drug_id, so we match on product_name + trade_name against the
// drug's generic and brand names. ~700 amoxicillin rows in DB across 4 countries, 103 sponsors —
// real data, not a stub.
export async function fetchManufacturersForDrug(
  drugId: string,
  opts: { country?: string; limit?: number } = {}
) {
  const sb = getSupabase();
  const drug = await sb
    .from("drugs")
    .select("id,generic_name,brand_names")
    .eq("id", drugId)
    .single();
  if (drug.error || !drug.data) return [] as Array<any>;
  const d: any = drug.data;
  const generic = (d.generic_name || "").trim();
  const brands: string[] = d.brand_names ?? [];
  if (!generic && brands.length === 0) return [];

  // Build a PostgREST OR group: product_name starts with the generic (case-insensitive),
  // OR product_name/trade_name contains a brand name. We escape % and _ from inputs.
  const esc = (s: string) => s.replace(/[%_,)(]/g, "").trim();
  const conditions: string[] = [];
  if (generic) {
    const g = esc(generic);
    conditions.push(`product_name.ilike.%${g}%`);
    conditions.push(`trade_name.ilike.%${g}%`);
  }
  for (const b of brands.slice(0, 6)) {
    const x = esc(b);
    if (!x) continue;
    conditions.push(`product_name.ilike.%${x}%`);
    conditions.push(`trade_name.ilike.%${x}%`);
  }
  if (conditions.length === 0) return [];

  let q = sb
    .from("drug_products")
    .select("sponsor_id,country")
    .or(conditions.join(","))
    .not("sponsor_id", "is", null)
    .limit(5000);
  if (opts.country) q = q.eq("country", opts.country);

  const { data, error } = await q;
  if (error) {
    console.error("[fetchManufacturersForDrug] error:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Aggregate by sponsor_id, capturing per-sponsor country diversity + product count.
  const agg = new Map<string, { product_count: number; countries: Set<string> }>();
  for (const r of rows) {
    const cur = agg.get(r.sponsor_id) ?? { product_count: 0, countries: new Set<string>() };
    cur.product_count += 1;
    if (r.country) cur.countries.add(r.country);
    agg.set(r.sponsor_id, cur);
  }

  // Resolve sponsor names.
  const ids = [...agg.keys()];
  const sp = await sb.from("sponsors").select("id,name,country").in("id", ids);
  const sponsorMap = new Map<string, any>((sp.data ?? []).map((s: any) => [s.id, s]));

  const out = [...agg.entries()]
    .map(([sponsor_id, v]) => ({
      sponsor_id,
      name: sponsorMap.get(sponsor_id)?.name ?? "Unknown sponsor",
      country: sponsorMap.get(sponsor_id)?.country ?? null,
      product_count: v.product_count,
      countries_supplied: [...v.countries],
    }))
    .filter((m) => m.name !== "Unknown sponsor")
    .sort((a, b) => b.product_count - a.product_count);

  return out.slice(0, opts.limit ?? 20);
}

// Public helper: full historical shortage stats for one drug, including a timeline array.
// Computes recurrence count, average resolved duration, first/last seen, country recurrences.
export async function fetchShortageHistory(drugId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("shortage_events")
    .select("country,country_code,severity,status,start_date,end_date")
    .eq("drug_id", drugId)
    .order("start_date", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[fetchShortageHistory] error:", error.message);
  }
  const rows = (data ?? []) as Array<{
    country: string;
    country_code: string | null;
    severity: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
  }>;

  const dayMs = 1000 * 60 * 60 * 24;
  const durationDays = (start: string | null, end: string | null) => {
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
    return Math.round((e - s) / dayMs);
  };

  const resolved = rows.filter((r) => r.status === "resolved" && r.start_date && r.end_date);
  // Exclude same-day "resolution events" (e.g. registration-cancellation rows where
  // start_date == end_date) — they're not representative of real shortage duration.
  const resolvedDurations = resolved
    .map((r) => durationDays(r.start_date, r.end_date))
    .filter((d): d is number => d != null && d > 0);
  const avgResolved = resolvedDurations.length
    ? Math.round(resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length)
    : null;
  const longestResolved = resolvedDurations.length ? Math.max(...resolvedDurations) : null;

  const firstSeen = rows.length ? rows[0].start_date : null;
  const lastResolved = (() => {
    let latest: string | null = null;
    for (const r of resolved) {
      if (r.end_date && (!latest || r.end_date > latest)) latest = r.end_date;
    }
    return latest;
  })();

  const countriesSeen = Array.from(
    new Set(rows.map((r) => r.country_code || r.country).filter(Boolean) as string[])
  );

  const recurrencesByCountry: Record<string, number> = {};
  for (const r of rows) {
    const k = r.country_code || r.country;
    if (!k) continue;
    recurrencesByCountry[k] = (recurrencesByCountry[k] ?? 0) + 1;
  }

  return {
    total_events: rows.length,
    active_events: rows.filter((r) => r.status === "active").length,
    resolved_events: resolved.length,
    avg_resolved_duration_days: avgResolved,
    longest_resolved_duration_days: longestResolved,
    first_seen: firstSeen,
    last_resolved_at: lastResolved,
    countries_seen: countriesSeen,
    recurrences_by_country: recurrencesByCountry,
    timeline: rows.map((r) => ({
      country: r.country,
      country_code: r.country_code,
      severity: r.severity,
      status: r.status,
      start_date: r.start_date,
      end_date: r.end_date,
      duration_days: durationDays(r.start_date, r.end_date),
    })),
  };
}

// Public helper: supplier_inventory rows for one drug (or many), joined to supplier_profiles.
export async function fetchSuppliersForDrugs(drugIds: string[], country?: string) {
  if (drugIds.length === 0) return new Map<string, any[]>();
  const sb = getSupabase();
  const inv = await sb
    .from("supplier_inventory")
    .select("drug_id,supplier_id,countries,unit_price,currency,pack_size,available_until,status,notes")
    .in("drug_id", drugIds)
    .eq("status", "available");
  const rows = (inv.data ?? []) as any[];
  const supplierIds = Array.from(new Set(rows.map((r) => r.supplier_id).filter(Boolean)));

  let profiles = new Map<string, any>();
  if (supplierIds.length > 0) {
    const pr = await sb
      .from("supplier_profiles")
      .select("id,company_name,verified,tier")
      .in("id", supplierIds);
    profiles = new Map((pr.data ?? []).map((p: any) => [p.id, p]));
  }

  const byDrug = new Map<string, any[]>();
  for (const r of rows) {
    if (country && !(r.countries ?? []).includes(country)) continue;
    const prof = profiles.get(r.supplier_id);
    const entry = {
      supplier_id: r.supplier_id,
      supplier_name: prof?.company_name ?? null,
      countries: r.countries ?? [],
      unit_price: r.unit_price,
      currency: r.currency,
      pack_size: r.pack_size,
      available_until: r.available_until,
      status: r.status,
      notes: r.notes,
      verified: !!prof?.verified,
      tier: prof?.tier ?? null,
    };
    const arr = byDrug.get(r.drug_id) ?? [];
    arr.push(entry);
    byDrug.set(r.drug_id, arr);
  }
  // Sort each list cheapest-first.
  for (const arr of byDrug.values()) {
    arr.sort((a, b) => (a.unit_price ?? 1e9) - (b.unit_price ?? 1e9));
  }
  return byDrug;
}

// Public helper for the pane: recalls matching the drug's generic name.
export async function fetchRecallsForDrug(drugId: string, limit = 8): Promise<RecallRow[]> {
  const sb = getSupabase();
  const drug = await sb.from("drugs").select("generic_name").eq("id", drugId).single();
  if (drug.error || !drug.data) return [];
  const name = (drug.data as any).generic_name as string | null;
  if (!name) return [];

  const direct = await sb
    .from("recalls")
    .select(
      "recall_id,drug_id,country_code,recall_class,reason,manufacturer,brand_name,generic_name,announced_date,status,press_release_url"
    )
    .eq("drug_id", drugId)
    .order("announced_date", { ascending: false })
    .limit(limit);
  if ((direct.data ?? []).length > 0) return (direct.data ?? []) as RecallRow[];

  const pattern = `%${name.replace(/[%_]/g, "")}%`;
  const fuzzy = await sb
    .from("recalls")
    .select(
      "recall_id,drug_id,country_code,recall_class,reason,manufacturer,brand_name,generic_name,announced_date,status,press_release_url"
    )
    .or(`generic_name.ilike.${pattern},brand_name.ilike.${pattern}`)
    .order("announced_date", { ascending: false })
    .limit(limit);
  return (fuzzy.data ?? []) as RecallRow[];
}

async function findSubstitutes(args: {
  drug_id: string;
  country?: string;
  limit?: number;
}, ctx: ToolContext): Promise<SubstituteRow[]> {
  const sb = getSupabase();
  const limit = Math.min(args.limit ?? 5, 10);

  const alts = await sb
    .from("drug_alternatives")
    .select("alternative_drug_id,similarity_score,atc_match_level,clinical_evidence_level,requires_monitoring,availability_note,dose_conversion_notes")
    .eq("drug_id", args.drug_id)
    .eq("is_approved", true)
    .order("similarity_score", { ascending: false })
    .limit(limit);

  const altRows = alts.data ?? [];
  if (altRows.length === 0) return [];

  const ids = altRows.map((a: any) => a.alternative_drug_id);

  const drugs = await sb
    .from("drugs")
    .select("id,generic_name,brand_names,atc_code,drug_class")
    .in("id", ids);
  const drugMap = new Map<string, any>((drugs.data ?? []).map((d: any) => [d.id, d]));

  const shortageCounts = await sb
    .from("shortage_events")
    .select("drug_id,country_code,status")
    .in("drug_id", ids)
    .eq("status", "active");
  const shortageByDrug = new Map<string, number>();
  for (const row of shortageCounts.data ?? []) {
    if (args.country && row.country_code !== args.country) continue;
    shortageByDrug.set(row.drug_id, (shortageByDrug.get(row.drug_id) ?? 0) + 1);
  }

  const out: SubstituteRow[] = altRows.map((a: any) => {
    const drug = drugMap.get(a.alternative_drug_id) ?? {};
    return {
      drug_id: a.alternative_drug_id,
      name: drug.generic_name ?? "Unknown",
      atc_code: drug.atc_code ?? null,
      drug_class: drug.drug_class ?? null,
      similarity_score: a.similarity_score,
      atc_match_level: a.atc_match_level,
      clinical_evidence_level: a.clinical_evidence_level,
      requires_monitoring: !!a.requires_monitoring,
      availability_note: a.availability_note,
      dose_conversion_notes: a.dose_conversion_notes,
      active_shortage_count: shortageByDrug.get(a.alternative_drug_id) ?? 0,
    };
  });

  for (const s of out) ctx.subs[s.drug_id] = s;
  return out;
}

async function listActiveShortages(args: {
  country?: string;
  severity?: string;
  atc_prefix?: string;
  manufacturer?: string;
  limit?: number;
}, ctx: ToolContext) {
  const sb = getSupabase();
  const limit = Math.min(args.limit ?? 10, 20);

  // If manufacturer filter is set, resolve it first to a set of drug_ids that the
  // manufacturer actually makes (via drug_products → sponsors). Then we pre-filter
  // the shortage query to those drugs only.
  let allowedDrugIds: Set<string> | null = null;
  if (args.manufacturer) {
    const mfg = args.manufacturer.replace(/[%_,)(]/g, "").trim();
    if (mfg) {
      const sp = await sb.from("sponsors").select("id").ilike("name", `%${mfg}%`).limit(50);
      const sponsorIds = (sp.data ?? []).map((s: any) => s.id);
      if (sponsorIds.length === 0) return [];

      // Walk drug_products for these sponsors, collect distinct generic names,
      // then resolve to drug_ids. Limit to a reasonable cap to avoid runaway joins.
      const dp = await sb
        .from("drug_products")
        .select("product_name")
        .in("sponsor_id", sponsorIds)
        .limit(2000);
      const productNames = new Set<string>();
      for (const r of dp.data ?? []) {
        const name = (r as any).product_name;
        if (typeof name === "string") {
          // Take the first word as a rough generic-name guess — registry strings
          // typically lead with the active ingredient ("AMOXICILLIN ... 500mg ...").
          const first = name.trim().split(/\s+/)[0];
          if (first && first.length > 2) productNames.add(first.toLowerCase());
        }
      }
      if (productNames.size === 0) return [];

      // Match drugs whose generic_name starts with any candidate (capped query).
      const ors = [...productNames].slice(0, 20).map((n) => `generic_name.ilike.${n}%`).join(",");
      const drugMatches = await sb.from("drugs").select("id").or(ors).limit(500);
      allowedDrugIds = new Set<string>((drugMatches.data ?? []).map((d: any) => d.id));
      if (allowedDrugIds.size === 0) return [];
    }
  }

  // Build the base query without severity, so we can fall back gracefully if
  // a severity filter wipes the result (severity tagging is sparse across
  // regulators — many rows are NULL). ATC filtering is pushed into the embedded
  // !inner join when set — otherwise a small `limit` on a start_date-ordered
  // page under-counts classes whose recent activity is sparse.
  const atc = (args.atc_prefix || "").toUpperCase();
  // Widen the fetch when we need to post-filter or when an ATC inner-join
  // could still leave us short on rows (defensive over-fetch).
  const fetchLimit = allowedDrugIds || atc ? 500 : limit;
  const baseQuery = () => {
    const embed = atc
      ? "drugs!inner(id,generic_name,brand_names,atc_code,drug_class)"
      : "drugs(id,generic_name,brand_names,atc_code,drug_class)";
    let qb = sb
      .from("shortage_events")
      .select(
        `drug_id,country,country_code,status,severity,reason,start_date,estimated_resolution_date,source_url,${embed}`
      )
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(fetchLimit);
    if (args.country) qb = qb.eq("country_code", args.country);
    if (allowedDrugIds) qb = qb.in("drug_id", [...allowedDrugIds]);
    if (atc) qb = qb.like("drugs.atc_code", `${atc}%`);
    return qb;
  };

  let severityFallbackApplied = false;
  let q = baseQuery();
  if (args.severity) q = q.eq("severity", args.severity);

  let res = await q;
  if (res.error) throw res.error;
  if (args.severity && (res.data ?? []).length === 0) {
    // Filter wiped the result — retry without severity so the caller gets
    // *something* useful (with a flag so they can be honest about the gap).
    severityFallbackApplied = true;
    res = await baseQuery();
    if (res.error) throw res.error;
  }
  const { data } = res;
  const rows = (data ?? []) as Array<ShortageRow & { drug_id: string; drugs?: any }>;
  if (rows.length === 0) return [];

  // Embedded drug rows come back as `drugs` per row (singular when !inner is used
  // on a many-to-one relation). Build a map for the response shape downstream.
  const drugMap = new Map<string, any>();
  for (const r of rows) {
    if (r.drug_id && r.drugs && !drugMap.has(r.drug_id)) drugMap.set(r.drug_id, r.drugs);
  }

  // After fetch (server-side ATC + severity filters), slice to the requested limit.
  const items = rows.slice(0, limit).map((r) => {
    const d = drugMap.get(r.drug_id) ?? {};
    return {
      drug_id: r.drug_id,
      name: d.generic_name ?? "Unknown drug",
      atc_code: d.atc_code ?? null,
      drug_class: d.drug_class ?? null,
      country: r.country,
      country_code: r.country_code,
      severity: r.severity,
      reason: r.reason,
      start_date: r.start_date,
      estimated_resolution_date: r.estimated_resolution_date,
      source_url: r.source_url,
    };
  });
  // When a severity filter was wiped, return the unfiltered rows + a flag so
  // the model can be honest ("no rows tagged X, here's what's active").
  if (severityFallbackApplied) {
    return {
      items,
      severity_fallback_applied: true,
      note: `No active shortages tagged severity=${args.severity}. Returning all severities so you can answer honestly — severity tagging coverage is sparse across regulators.`,
    } as any;
  }
  return items;
}

async function getTradePrices(args: { drug_id: string; countries?: string[] }): Promise<SupplierPriceRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("supplier_inventory")
    .select("countries,unit_price,currency,pack_size,available_until,status,notes")
    .eq("drug_id", args.drug_id)
    .eq("status", "available");
  if (error) throw error;

  const rows: SupplierPriceRow[] = [];
  for (const row of data ?? []) {
    const countries: string[] = row.countries ?? [];
    for (const c of countries) {
      if (args.countries && args.countries.length > 0 && !args.countries.includes(c)) continue;
      rows.push({
        country: c,
        unit_price: row.unit_price,
        currency: row.currency,
        pack_size: row.pack_size,
        available_until: row.available_until,
        status: row.status,
        notes: row.notes,
      });
    }
  }
  return rows;
}

async function searchRecalls(args: {
  query: string;
  country?: string;
  since?: string;
  limit?: number;
}): Promise<RecallRow[]> {
  const sb = getSupabase();
  const limit = Math.min(args.limit ?? 5, 15);
  const pattern = `%${args.query.replace(/[%_]/g, "")}%`;

  let q = sb
    .from("recalls")
    .select("recall_id,drug_id,country_code,recall_class,reason,manufacturer,brand_name,generic_name,announced_date,status,press_release_url")
    .or(`generic_name.ilike.${pattern},brand_name.ilike.${pattern}`)
    .order("announced_date", { ascending: false })
    .limit(limit);

  if (args.country) q = q.eq("country_code", args.country);
  if (args.since) q = q.gte("announced_date", args.since);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RecallRow[];
}

export async function hydrateReferencedIds(text: string, ctx: ToolContext): Promise<void> {
  const drugIds = new Set<string>();
  const subIds = new Set<string>();
  const drugRe = /<drug_card\s+id="([0-9a-f-]{36})"/gi;
  const subRe = /<sub_card\s+id="([0-9a-f-]{36})"/gi;
  let m: RegExpExecArray | null;
  while ((m = drugRe.exec(text)) !== null) if (!ctx.drugs[m[1]]) drugIds.add(m[1]);
  while ((m = subRe.exec(text)) !== null) if (!ctx.subs[m[1]]) subIds.add(m[1]);

  await Promise.all(
    [...drugIds].map((id) => getDrugDetails({ drug_id: id }, ctx).catch(() => null))
  );

  if (subIds.size === 0) return;

  const sb = getSupabase();
  const ids = [...subIds];
  const [drugRes, shortageRes, altRes] = await Promise.all([
    sb.from("drugs").select("id,generic_name,atc_code,drug_class").in("id", ids),
    sb.from("shortage_events").select("drug_id").in("drug_id", ids).eq("status", "active"),
    sb
      .from("drug_alternatives")
      .select("alternative_drug_id,similarity_score,atc_match_level,clinical_evidence_level,requires_monitoring,dose_conversion_notes,availability_note")
      .in("alternative_drug_id", ids)
      .order("similarity_score", { ascending: false }),
  ]);

  const drugMap = new Map<string, any>((drugRes.data ?? []).map((d: any) => [d.id, d]));
  const shortageCounts = new Map<string, number>();
  for (const s of shortageRes.data ?? []) {
    shortageCounts.set(s.drug_id, (shortageCounts.get(s.drug_id) ?? 0) + 1);
  }
  const altMap = new Map<string, any>();
  for (const a of altRes.data ?? []) {
    if (!altMap.has(a.alternative_drug_id)) altMap.set(a.alternative_drug_id, a);
  }

  for (const id of ids) {
    const drug = drugMap.get(id);
    if (!drug) continue;
    const alt = altMap.get(id);
    ctx.subs[id] = {
      drug_id: id,
      name: drug.generic_name ?? "Unknown",
      atc_code: drug.atc_code ?? null,
      drug_class: drug.drug_class ?? null,
      similarity_score: alt?.similarity_score ?? null,
      atc_match_level: alt?.atc_match_level ?? null,
      clinical_evidence_level: alt?.clinical_evidence_level ?? null,
      requires_monitoring: !!alt?.requires_monitoring,
      availability_note: alt?.availability_note ?? null,
      dose_conversion_notes: alt?.dose_conversion_notes ?? null,
      active_shortage_count: shortageCounts.get(id) ?? 0,
    };
  }
}

// Primary medicines regulator per ISO country code. Used to attribute shortage
// rows back to the regulator the scraper pulls from. Multi-source countries
// (US has FDA Drug Shortages + FDA Enforcement, CH has Swissmedic + drugshortage.ch)
// collapse to the canonical regulator name — the per-row source_url still carries
// the precise URL the scraper saw. Codes match data_sources.abbreviation where
// possible.
const REGULATORS: Record<string, { code: string; name: string }> = {
  AU: { code: "TGA", name: "Therapeutic Goods Administration" },
  US: { code: "FDA", name: "Food and Drug Administration" },
  CA: { code: "Health Canada", name: "Health Canada" },
  GB: { code: "MHRA", name: "Medicines and Healthcare products Regulatory Agency" },
  EU: { code: "EMA", name: "European Medicines Agency" },
  DE: { code: "BfArM", name: "Bundesinstitut für Arzneimittel und Medizinprodukte" },
  FR: { code: "ANSM", name: "Agence nationale de sécurité du médicament" },
  IT: { code: "AIFA", name: "Agenzia Italiana del Farmaco" },
  ES: { code: "AEMPS", name: "Agencia Española de Medicamentos y Productos Sanitarios" },
  SG: { code: "HSA", name: "Health Sciences Authority" },
  NZ: { code: "Pharmac", name: "Pharmac" },
  CH: { code: "Swissmedic", name: "Swissmedic" },
  AT: { code: "AGES", name: "Austrian Agency for Health and Food Safety" },
  NL: { code: "CBG-MEB", name: "Medicines Evaluation Board (NL)" },
  DK: { code: "DKMA", name: "Danish Medicines Agency" },
  FI: { code: "Fimea", name: "Finnish Medicines Agency" },
  IE: { code: "HPRA", name: "Health Products Regulatory Authority" },
  SE: { code: "Läkemedelsverket", name: "Swedish Medical Products Agency" },
  CZ: { code: "SÚKL", name: "State Institute for Drug Control (CZ)" },
  HU: { code: "OGYÉI", name: "National Institute of Pharmacy and Nutrition" },
  NO: { code: "NoMA", name: "Norwegian Medicines Agency" },
  BE: { code: "FAMHP", name: "Federal Agency for Medicines and Health Products" },
  BR: { code: "ANVISA", name: "Agência Nacional de Vigilância Sanitária" },
  JP: { code: "PMDA", name: "Pharmaceuticals and Medical Devices Agency" },
  KR: { code: "MFDS", name: "Ministry of Food and Drug Safety" },
  MX: { code: "Cofepris", name: "Comisión Federal para la Protección contra Riesgos Sanitarios" },
  ZA: { code: "SAHPRA", name: "South African Health Products Regulatory Authority" },
  NG: { code: "NAFDAC", name: "National Agency for Food and Drug Administration and Control" },
  SA: { code: "SFDA", name: "Saudi Food and Drug Authority" },
  PT: { code: "INFARMED", name: "INFARMED (PT)" },
};

function regulatorFor(countryCode: string | null | undefined): { code: string; name: string; country_code: string } | null {
  if (!countryCode) return null;
  const cc = countryCode.toUpperCase();
  const r = REGULATORS[cc];
  if (!r) return null;
  return { ...r, country_code: cc };
}

/** Aggregate a set of {country_code, start_date} rows into per-regulator
 *  provenance and (best-effort) attach last_scraped_at + source_url from
 *  data_sources. Shared between summarize_shortage_landscape (landscape-level)
 *  and get_drug_details (per-drug). Rows without a recognised country code
 *  are silently dropped — Mederti doesn't claim coverage it doesn't have. */
async function computeSourcesConsulted(
  rows: Array<{ country_code: string | null | undefined; start_date?: string | null }>
) {
  type Agg = {
    code: string;
    name: string;
    country_code: string;
    rows_contributed: number;
    latest_event_date: string | null;
  };
  const byCountry = new Map<string, Agg>();
  for (const r of rows) {
    const reg = regulatorFor(r.country_code);
    if (!reg) continue;
    let p = byCountry.get(reg.country_code);
    if (!p) {
      p = {
        code: reg.code,
        name: reg.name,
        country_code: reg.country_code,
        rows_contributed: 0,
        latest_event_date: null,
      };
      byCountry.set(reg.country_code, p);
    }
    p.rows_contributed += 1;
    if (r.start_date && (!p.latest_event_date || r.start_date > p.latest_event_date)) {
      p.latest_event_date = r.start_date;
    }
  }

  const countries = [...byCountry.keys()];
  const scrapeMeta = new Map<
    string,
    { last_scraped_at: string | null; source_url: string | null }
  >();
  if (countries.length > 0) {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("data_sources")
        .select("country_code,last_scraped_at,source_url,is_active")
        .in("country_code", countries)
        .eq("is_active", true);
      for (const r of data ?? []) {
        const cc = (r as any).country_code as string | null;
        if (!cc) continue;
        const next = {
          last_scraped_at: (r as any).last_scraped_at as string | null,
          source_url: (r as any).source_url as string | null,
        };
        const ex = scrapeMeta.get(cc);
        if (!ex) scrapeMeta.set(cc, next);
        else if (next.last_scraped_at && (!ex.last_scraped_at || next.last_scraped_at > ex.last_scraped_at)) {
          scrapeMeta.set(cc, next);
        }
      }
    } catch (e) {
      // Best-effort; absence of data_sources rows is non-fatal.
      console.error("[computeSourcesConsulted] data_sources lookup failed:", e);
    }
  }

  // Stale threshold: 7 days. Beyond that the chip carries a "stale" visual flag
  // and the freshness_label says so — so the user sees the actual age, not a
  // misleading "scraped today" string the model could fabricate.
  const STALE_HOURS = 7 * 24;
  const now = Date.now();

  function describeFreshness(
    lastScrapedAt: string | null,
    latestEventDate: string | null
  ): { label: string; is_stale: boolean } {
    if (lastScrapedAt) {
      const ts = new Date(lastScrapedAt).getTime();
      if (Number.isFinite(ts)) {
        const hrs = (now - ts) / (1000 * 60 * 60);
        const days = Math.round(hrs / 24);
        if (hrs < 24) return { label: "scraped today", is_stale: false };
        if (hrs < 48) return { label: "scraped yesterday", is_stale: false };
        if (hrs < STALE_HOURS) return { label: `scraped ${days}d ago`, is_stale: false };
        return { label: `scraped ${days}d ago — stale`, is_stale: true };
      }
    }
    // No last_scraped_at — fall back to the latest event date the scraper has
    // captured. Labelled honestly so the user can tell it's not a scrape signal.
    if (latestEventDate) {
      const ts = new Date(latestEventDate).getTime();
      if (Number.isFinite(ts)) {
        const days = Math.max(0, Math.round((now - ts) / (1000 * 60 * 60 * 24)));
        return { label: `latest event ${days}d ago`, is_stale: true };
      }
    }
    return { label: "freshness unknown", is_stale: true };
  }

  return [...byCountry.values()]
    .map((p) => {
      const meta = scrapeMeta.get(p.country_code);
      const last_scraped_at = meta?.last_scraped_at ?? null;
      const { label, is_stale } = describeFreshness(last_scraped_at, p.latest_event_date);
      return {
        regulator_code: p.code,
        regulator_name: p.name,
        country_code: p.country_code,
        rows_contributed: p.rows_contributed,
        latest_event_date: p.latest_event_date,
        last_scraped_at,
        source_url: meta?.source_url ?? null,
        freshness_label: label,
        is_stale,
      };
    })
    .sort((a, b) => b.rows_contributed - a.rows_contributed);
}

// Landscape summary — single call returns enough data for the model to write a
// class/region answer (KPIs + top drugs + geo distribution) without making N
// per-row tool calls. Drug ids in `top_drugs` are populated into ctx.drugs so the
// model can emit <drug_card id="..." /> tags directly.
async function summarizeShortageLandscape(
  args: { atc_prefix?: string; country?: string; severity?: string; top_n?: number },
  ctx: ToolContext
) {
  const sb = getSupabase();
  const topN = Math.min(Math.max(args.top_n ?? 8, 1), 15);

  // 1. Fetch active shortage events with embedded drug rows. ATC scoping is
  //    pushed into the embedded join via !inner so it filters at the DB level —
  //    client-side filtering against an order-by-start_date sample under-counts
  //    classes whose recent activity is sparse (J01 vs the Swiss N02 firehose).
  const atc = (args.atc_prefix || "").toUpperCase();
  const embed = atc
    ? "drugs!inner(id,generic_name,brand_names,atc_code,drug_class,who_essential_medicine,critical_medicine_eu)"
    : "drugs(id,generic_name,brand_names,atc_code,drug_class,who_essential_medicine,critical_medicine_eu)";
  let q = sb
    .from("shortage_events")
    .select(`drug_id,country_code,severity,start_date,${embed}`)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(5000);
  if (args.country) q = q.eq("country_code", args.country);
  if (atc) q = q.like("drugs.atc_code", `${atc}%`);

  const { data, error } = await q;
  if (error) throw error;
  const allRows = (data ?? []) as Array<any>;
  // With !inner the join itself drops non-matching rows, but defend against
  // null drug embeds just in case (orphaned drug_ids exist in the DB).
  const scoped = atc
    ? allRows.filter((r) => r.drugs && (r.drugs.atc_code || "").toUpperCase().startsWith(atc))
    : allRows.filter((r) => r.drugs);

  // 2. Optional severity narrowing — track both broadened and narrowed sets so
  //    we can tell the model honestly when the filter wiped the result.
  const narrowed = args.severity
    ? scoped.filter((r) => r.severity === args.severity)
    : scoped;

  const usingFallback = !!args.severity && narrowed.length === 0 && scoped.length > 0;
  const working = usingFallback ? scoped : narrowed;

  // 3. Aggregates.
  const bySeverity: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byDrug = new Map<
    string,
    {
      drug_id: string;
      name: string;
      atc_code: string | null;
      drug_class: string | null;
      who_essential: boolean;
      critical_medicine_eu: boolean;
      countries: Set<string>;
      severities: Set<string>;
      shortage_count: number;
    }
  >();

  for (const r of working) {
    const sev = r.severity || "untagged";
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    const c = r.country_code;
    if (c) byCountry[c] = (byCountry[c] || 0) + 1;
    const d = r.drugs;
    if (!d?.id) continue;
    let bucket = byDrug.get(d.id);
    if (!bucket) {
      bucket = {
        drug_id: d.id,
        name: d.generic_name || "Unknown",
        atc_code: d.atc_code,
        drug_class: d.drug_class,
        who_essential: !!d.who_essential_medicine,
        critical_medicine_eu: !!d.critical_medicine_eu,
        countries: new Set<string>(),
        severities: new Set<string>(),
        shortage_count: 0,
      };
      byDrug.set(d.id, bucket);
    }
    bucket.shortage_count += 1;
    if (c) bucket.countries.add(c);
    if (r.severity) bucket.severities.add(r.severity);
  }

  // Sort drugs by (country count desc, shortage count desc) — country diversity
  // is the better signal of structural problems than raw row count, which is
  // dominated by Swiss product fragmentation.
  const rankedDrugs = [...byDrug.values()]
    .sort((a, b) => {
      const dc = b.countries.size - a.countries.size;
      if (dc !== 0) return dc;
      return b.shortage_count - a.shortage_count;
    })
    .slice(0, topN);

  // Hydrate full drug details for the top drugs so the model can drug_card them.
  // Fire in parallel; tolerate individual failures.
  await Promise.all(
    rankedDrugs.map((d) => getDrugDetails({ drug_id: d.drug_id }, ctx).catch(() => null))
  );

  // 4. Pre-format country distribution as a sorted list (cap at 15).
  const countriesSorted = Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([country_code, count]) => ({ country_code, count }));

  // 4b. Source provenance — which regulators backed this answer? Shared
  //     helper aggregates rows by regulator + attaches data_sources metadata.
  const sourcesConsulted = await computeSourcesConsulted(working);

  const notes: string[] = [];
  if (usingFallback) {
    notes.push(
      `No shortages tagged severity=${args.severity} in this scope. Returning all severities so you can answer honestly.`
    );
  }
  // Surface the data-quality caveat the prompt now warns about, so the model
  // can mention it inline when relevant.
  const untaggedCount = bySeverity["untagged"] || 0;
  if (untaggedCount > working.length * 0.1) {
    notes.push(
      `${untaggedCount}/${working.length} rows have no regulator-published severity (data caveat — not "no shortage").`
    );
  }

  return {
    filter: {
      atc_prefix: args.atc_prefix || null,
      country: args.country || null,
      severity: args.severity || null,
      severity_fallback_applied: usingFallback,
    },
    total_active_events: working.length,
    unique_drugs_affected: byDrug.size,
    by_severity: bySeverity,
    by_country: countriesSorted,
    who_essential_overlap: rankedDrugs.filter((d) => d.who_essential).length,
    eu_critical_overlap: rankedDrugs.filter((d) => d.critical_medicine_eu).length,
    top_drugs: rankedDrugs.map((d) => ({
      drug_id: d.drug_id,
      name: d.name,
      atc_code: d.atc_code,
      drug_class: d.drug_class,
      who_essential: d.who_essential,
      critical_medicine_eu: d.critical_medicine_eu,
      countries: [...d.countries].sort(),
      country_count: d.countries.size,
      severities: [...d.severities],
      shortage_event_count: d.shortage_count,
    })),
    sources_consulted: sourcesConsulted,
    notes,
  };
}

// Canonical ATC names — keyed by exact code. Covers L1 (14 anatomical groups)
// + the L2 therapeutic subgroups our chat traffic actually queries. The
// per-drug atc_description field is unreliable for class names (it carries
// the specific substance name, not the class), so we don't fall back to it.
// Add new L2 codes here as needed — WHO ATC has ~95 total at this level.
const ATC_NAMES: Record<string, string> = {
  // L1 — anatomical main groups
  A: "Alimentary tract and metabolism",
  B: "Blood and blood-forming organs",
  C: "Cardiovascular system",
  D: "Dermatologicals",
  G: "Genito-urinary system and sex hormones",
  H: "Systemic hormonal preparations (excl. sex hormones)",
  J: "Anti-infectives for systemic use",
  L: "Antineoplastic and immunomodulating agents",
  M: "Musculoskeletal system",
  N: "Nervous system",
  P: "Antiparasitic products",
  R: "Respiratory system",
  S: "Sensory organs",
  V: "Various",
  // L2 — the most-queried therapeutic subgroups
  A02: "Drugs for acid-related disorders",
  A03: "Drugs for functional gastrointestinal disorders",
  A04: "Antiemetics and antinauseants",
  A10: "Drugs used in diabetes",
  A11: "Vitamins",
  B01: "Antithrombotic agents",
  B02: "Antihemorrhagics",
  B03: "Antianemic preparations",
  C01: "Cardiac therapy",
  C02: "Antihypertensives",
  C03: "Diuretics",
  C07: "Beta-blocking agents",
  C08: "Calcium channel blockers",
  C09: "Agents acting on the renin-angiotensin system",
  C10: "Lipid-modifying agents",
  D01: "Antifungals for dermatological use",
  G03: "Sex hormones and modulators of the genital system",
  G04: "Urologicals",
  H01: "Pituitary and hypothalamic hormones",
  H02: "Corticosteroids for systemic use",
  H03: "Thyroid therapy",
  J01: "Antibacterials for systemic use",
  J02: "Antimycotics for systemic use",
  J04: "Antimycobacterials",
  J05: "Antivirals for systemic use",
  J06: "Immune sera and immunoglobulins",
  J07: "Vaccines",
  L01: "Antineoplastic agents",
  L02: "Endocrine therapy",
  L03: "Immunostimulants",
  L04: "Immunosuppressants",
  M01: "Anti-inflammatory and antirheumatic products",
  M03: "Muscle relaxants",
  M05: "Drugs for treatment of bone diseases",
  N01: "Anesthetics",
  N02: "Analgesics",
  N03: "Antiepileptics",
  N04: "Anti-parkinson drugs",
  N05: "Psycholeptics",
  N06: "Psychoanaleptics",
  N07: "Other nervous system drugs",
  P01: "Antiprotozoals",
  P02: "Anthelmintics",
  R01: "Nasal preparations",
  R03: "Drugs for obstructive airway diseases",
  R05: "Cough and cold preparations",
  R06: "Antihistamines for systemic use",
  S01: "Ophthalmologicals",
  V03: "All other therapeutic products",
  V08: "Contrast media",
};

function resolveAtcName(atcCode: string): string {
  const code = atcCode.toUpperCase();
  // Exact match first (most precise).
  if (ATC_NAMES[code]) return ATC_NAMES[code];
  // Walk up the hierarchy: L01CD01 → L01CD → L01C → L01 → L
  for (let len = code.length - 1; len >= 1; len--) {
    const prefix = code.slice(0, len);
    if (ATC_NAMES[prefix]) {
      return `${ATC_NAMES[prefix]} (${code})`;
    }
  }
  return code;
}

async function getClassSummary(
  args: { atc_code: string; country?: string },
  ctx: ToolContext
): Promise<ClassSummary | null> {
  const sb = getSupabase();
  const atc = args.atc_code.trim().toUpperCase();
  if (!atc) return null;

  // 1. Pull all active shortage events scoped to this ATC prefix (server-side
  //    via embedded !inner join — same pattern as summarize_shortage_landscape
  //    to avoid sample bias). Also fetch a 90d historical window for the trend.
  const baseSelect =
    "drug_id,country_code,severity,start_date,drugs!inner(id,generic_name,atc_code,drug_class,atc_description,who_essential_medicine,critical_medicine_eu)";

  let activeQ = sb
    .from("shortage_events")
    .select(baseSelect)
    .eq("status", "active")
    .like("drugs.atc_code", `${atc}%`)
    .order("start_date", { ascending: false })
    .limit(5000);
  if (args.country) activeQ = activeQ.eq("country_code", args.country);

  // Trend window: count events in the last 30d vs the prior 60d. Cheap proxy.
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const d30 = new Date(now.getTime() - 30 * day).toISOString().slice(0, 10);
  const d90 = new Date(now.getTime() - 90 * day).toISOString().slice(0, 10);

  const [activeRes, recentRes, priorRes] = await Promise.all([
    activeQ,
    sb
      .from("shortage_events")
      .select("drugs!inner(atc_code)", { count: "exact", head: true })
      .like("drugs.atc_code", `${atc}%`)
      .gte("start_date", d30)
      .then((r) => r),
    sb
      .from("shortage_events")
      .select("drugs!inner(atc_code)", { count: "exact", head: true })
      .like("drugs.atc_code", `${atc}%`)
      .gte("start_date", d90)
      .lt("start_date", d30)
      .then((r) => r),
  ]);

  if (activeRes.error) throw activeRes.error;
  const rows = (activeRes.data ?? []) as Array<any>;
  if (rows.length === 0) {
    // Empty class — still return a shell so the model can say so plainly.
    const summary: ClassSummary = {
      atc_code: atc,
      atc_name: resolveAtcName(atc),
      trend: "insufficient_data",
      trend_note: "no active events tracked in this class",
      drugs_in_class_with_active_shortage: 0,
      total_active_events: 0,
      countries_affected: 0,
      by_severity: {},
      who_essential_count: 0,
      eu_critical_count: 0,
      top_drugs: [],
      sources_consulted: [],
    };
    ctx.classes[atc] = summary;
    return summary;
  }

  // 2. Aggregate.
  const bySeverity: Record<string, number> = {};
  const countries = new Set<string>();
  const byDrug = new Map<
    string,
    { drug_id: string; name: string; atc_code: string | null; countries: Set<string>; events: number; who_essential: boolean }
  >();
  let whoEssentialDrugs = new Set<string>();
  let euCriticalDrugs = new Set<string>();

  for (const r of rows) {
    const sev = r.severity || "untagged";
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    if (r.country_code) countries.add(r.country_code);
    const d = r.drugs;
    if (!d?.id) continue;
    let bucket = byDrug.get(d.id);
    if (!bucket) {
      bucket = {
        drug_id: d.id,
        name: d.generic_name || "Unknown",
        atc_code: d.atc_code,
        countries: new Set<string>(),
        events: 0,
        who_essential: !!d.who_essential_medicine,
      };
      byDrug.set(d.id, bucket);
    }
    bucket.events += 1;
    if (r.country_code) bucket.countries.add(r.country_code);
    if (d.who_essential_medicine) whoEssentialDrugs.add(d.id);
    if (d.critical_medicine_eu) euCriticalDrugs.add(d.id);
  }

  const topDrugs: ClassTopDrug[] = [...byDrug.values()]
    .sort((a, b) => b.countries.size - a.countries.size || b.events - a.events)
    .slice(0, 5)
    .map((d) => ({
      drug_id: d.drug_id,
      name: d.name,
      atc_code: d.atc_code,
      country_count: d.countries.size,
      shortage_event_count: d.events,
      who_essential: d.who_essential,
    }));

  // Hydrate top drugs into ctx.drugs so any inline <drug_card /> emitted by
  // the model alongside the class card lands on a real record.
  await Promise.all(topDrugs.map((d) => getDrugDetails({ drug_id: d.drug_id }, ctx).catch(() => null)));

  // 3. Trend signal — proportional comparison of last-30d vs prior-60d.
  //    Normalised because the prior window is twice as wide.
  const recentCount = (recentRes as any).count ?? 0;
  const priorCount = (priorRes as any).count ?? 0;
  let trend: ClassSummary["trend"] = "insufficient_data";
  let trendNote = `${recentCount} events in last 30d vs ${priorCount} in prior 60d`;
  const total = recentCount + priorCount;
  if (total >= 10) {
    const priorRate = priorCount / 60; // events/day
    const recentRate = recentCount / 30;
    const ratio = priorRate === 0 ? Infinity : recentRate / priorRate;
    if (ratio > 1.3) trend = "rising";
    else if (ratio < 0.7) trend = "falling";
    else trend = "stable";
    trendNote = `${recentCount} new events in last 30d vs ${priorCount} in prior 60d (rate ratio ${ratio.toFixed(2)}×)`;
  }

  // 4. Sources consulted via the shared helper.
  const sourcesConsulted = await computeSourcesConsulted(rows);

  const summary: ClassSummary = {
    atc_code: atc,
    atc_name: resolveAtcName(atc),
    trend,
    trend_note: trendNote,
    drugs_in_class_with_active_shortage: byDrug.size,
    total_active_events: rows.length,
    countries_affected: countries.size,
    by_severity: bySeverity,
    who_essential_count: whoEssentialDrugs.size,
    eu_critical_count: euCriticalDrugs.size,
    top_drugs: topDrugs,
    sources_consulted: sourcesConsulted,
  };

  ctx.classes[atc] = summary;
  return summary;
}

async function queryIntelligenceSources(input: {
  query?: string;
  category?: string;
  geography?: string;
  regulators_only?: boolean;
  limit?: number;
}): Promise<unknown> {
  const supabase = getSupabase();
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 15);

  let q = supabase
    .from("intelligence_sources")
    .select(
      "source_id, name, owner_org, category, subcategory, geography_coverage, access_method, is_medicines_regulator, is_government_or_igo, notes"
    )
    .limit(limit);

  if (input.category) q = q.ilike("category", `%${input.category}%`);
  if (input.geography) q = q.ilike("geography_coverage", `%${input.geography}%`);
  if (input.regulators_only) q = q.eq("is_medicines_regulator", true);
  if (input.query) {
    const term = input.query.replace(/[%,]/g, " ").trim();
    if (term) {
      q = q.or(`name.ilike.%${term}%,notes.ilike.%${term}%`);
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    source_id: r.source_id,
    name: r.name,
    owner_org: r.owner_org,
    category: r.category,
    subcategory: r.subcategory,
    geography: r.geography_coverage,
    access_method: r.access_method,
    is_regulator: r.is_medicines_regulator,
    is_government_or_igo: r.is_government_or_igo,
    notes: r.notes ? r.notes.slice(0, 240) : null,
  }));
}

export async function executeTool(
  name: string,
  input: Record<string, any>,
  ctx: ToolContext
): Promise<unknown> {
  // Pre-flight coverage gate: short-circuit country-filtered tool calls when
  // the country isn't in our live allowlist, so the model never sees an
  // ambiguous empty array for an uncovered country.
  if (name === "search_recalls") {
    const gate = coverageGate("recalls", (input as any).country);
    if (gate) return gate;
  }
  if (
    name === "list_active_shortages" ||
    name === "summarize_shortage_landscape"
  ) {
    const gate = coverageGate("shortages", (input as any).country);
    if (gate) return gate;
  }

  switch (name) {
    case "search_drugs":
      return await searchDrugs(input as any);
    case "get_drug_details":
      return await getDrugDetails(input as any, ctx);
    case "find_substitutes":
      return await findSubstitutes(input as any, ctx);
    case "list_active_shortages":
      return await listActiveShortages(input as any, ctx);
    case "summarize_shortage_landscape":
      return await summarizeShortageLandscape(input as any, ctx);
    case "get_class_summary":
      return await getClassSummary(input as any, ctx);
    case "get_trade_prices":
      return await getTradePrices(input as any);
    case "search_recalls":
      return await searchRecalls(input as any);
    case "query_intelligence_sources":
      return await queryIntelligenceSources(input as any);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
