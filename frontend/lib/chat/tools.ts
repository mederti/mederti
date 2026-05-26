import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./supabase";
import type {
  DrugDetail,
  DrugSummary,
  RecallRow,
  ShortageRow,
  SubstituteRow,
  SupplierPriceRow,
} from "./types";

export const TOOL_DEFINITIONS: Anthropic.ToolUnion[] = [
  // Anthropic server-side web search — for macro / geopolitical / news questions
  // the database can't answer (e.g. "how does X conflict affect pharma supply?").
  // The API resolves the call itself; we never dispatch to executeTool for this.
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 3,
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
      "Get the full record for one drug — generic + brand names, ATC code, drug class, dosage forms, strengths, plus its current shortage status across all countries. Call this once you have a drug_id from search_drugs to populate a drug card.",
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
      "ONE-CALL landscape summary for class/region/severity-level questions ('show critical antibiotic shortages globally', 'what's in shortage in oncology in the EU', 'how bad is the cardiovascular shortage picture'). Returns: aggregate counts, severity distribution, country distribution, top affected drugs (with drug_ids you can drug_card), WHO essential / EU critical overlap, and a notes block flagging data caveats (sparse severity tagging, country coverage gaps). PREFER this over multiple list_active_shortages calls when the user is asking for a landscape — a single tool call beats N row-level fetches and lets you spend tokens on synthesis.",
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
};

export function newContext(): ToolContext {
  return { drugs: {}, subs: {} };
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
  const drug = await sb
    .from("drugs")
    .select(
      "id,generic_name,brand_names,atc_code,atc_description,drug_class,dosage_forms,strengths,routes_of_administration,therapeutic_category,who_essential_medicine,critical_medicine_eu"
    )
    .eq("id", args.drug_id)
    .single();
  if (drug.error || !drug.data) return null;
  const d: any = drug.data;

  const shortages = await sb
    .from("shortage_events")
    .select("country,country_code,status,severity,reason,start_date,estimated_resolution_date,source_url")
    .eq("drug_id", args.drug_id)
    .order("start_date", { ascending: false })
    .limit(50);

  const rows: ShortageRow[] = (shortages.data ?? []) as ShortageRow[];
  const summary = shortageSummary(rows);

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
    notes,
  };
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
