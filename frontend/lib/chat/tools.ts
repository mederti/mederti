import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./supabase";
import { coverageGate } from "./coverage";
import type {
  ClassSummary,
  ClassTopDrug,
  Confidence,
  DrugDetail,
  DrugSummary,
  RecallRow,
  ShortageRow,
  SourceConsulted,
  SubstituteRow,
  SupplierPriceRow,
} from "./types";
import { computeConfidence, confidenceFromSources, levelFromScore } from "./confidence";

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
  // ── Sprint 1 Step 5 quick-win tools (audit §1.4) ───────────────────────────
  {
    name: "get_sole_source_essentials",
    description:
      "Surface WHO Essential Medicines that have only ONE active sponsor in a country — the sole-source / single-supplier risk view. Backed by drugs.who_essential_medicine + drug_products active count per drug × country. Returns the drug, the single sponsor name (where derivable), active shortage status, and confidence. Use for GOV-02 (essentials with one supplier nationally), GOV-11 (sole-supplier contracts to diversify), GOV-19 (low-cost generics at risk), SUP-02 (essentials with zero/single supply in market), and any 'critical drugs with no fallback in [country]' question.",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO-2 country code (required)." },
        who_only: { type: "boolean", description: "If true (default), restrict to WHO Essential Medicines. Set false to include all drugs." },
        limit: { type: "number", description: "Max results (default 25)." },
      },
      required: ["country"],
    },
  },
  {
    name: "compare_shortage_burden",
    description:
      "Compare shortage burden across countries — active event count, severity distribution, WHO-essential overlap, and the top affected drugs per country. Use for GOV-13 (shortages unique to our country vs global), GOV-14 (burden vs AU/UK/CA/US/EU), GOV-15 (peer countries that resolved what we still have), GOV-05 (durations us vs peers), SUP-05 (arbitrage view country A surplus vs country B short). Defaults to a sensible regional peer set when peer_set is omitted.",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO-2 country code (the focal market). Required." },
        peer_set: {
          type: "array",
          items: { type: "string" },
          description: "Optional ISO-2 codes of peer countries to compare against. Default depends on the focal country (EU+UK orbit for European markets, NA+EU+UK for US/CA, AU/NZ/UK/US/SG for AU/NZ).",
        },
      },
      required: ["country"],
    },
  },
  {
    name: "get_class_concentration_risk",
    description:
      "Manufacturer concentration risk for an ATC class — surfaces how many distinct API/finished-dose suppliers serve each drug in the class, and which drugs are sole-sourced or hyper-concentrated. Backed by v_drug_manufacturer_concentration (PharmaCompass + drug_rxnorm). Use for SUP-24 (drug classes most exposed to upstream concentration), GOV-03 (therapeutic classes with highest concentration risk in our market), GOV-04 (proportion dependent on single API source), GOV-27 (most concentrated upstream exposure), HCL-08 (most fragile global supply chains).",
    input_schema: {
      type: "object",
      properties: {
        atc_prefix: { type: "string", description: "ATC code prefix to scope the class (e.g. 'J01' for antibiotics, 'L01' for oncology, 'A10' for diabetes). Required." },
        country: { type: "string", description: "Optional ISO-2 country code to narrow to drugs registered in that market." },
        limit: { type: "number", description: "Max drugs to return (default 20)." },
      },
      required: ["atc_prefix"],
    },
  },
  {
    name: "get_resolution_time_stats",
    description:
      "Historical resolution-time statistics for a drug or ATC class — median, p25, p75, max days from start_date to end_date across RESOLVED shortage events. Use for HCL-12 (buffer stock based on historical resolution), HCL-20 (resolution distribution per class), HPR-10 (buffer for [drug] based on historical duration), GOV-21 (optimal reserve holding period), SUP-22 (recurring / structurally undersupplied), RET-23 (recurring shortage long-term planning). Returns confidence calibrated to the sample size — thin samples (<10 events) downgrade automatically.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID to scope to a single drug." },
        atc_prefix: { type: "string", description: "ATC prefix to scope to a class (mutually exclusive with drug_id; provide one)." },
        country: { type: "string", description: "Optional ISO-2 country code to narrow the resolved sample to that market." },
      },
    },
  },
  {
    name: "get_predictive_signals",
    description:
      "Peer-set lead-time analysis — drugs in active shortage across N+ peer countries but NOT yet declared short in the user's country. The strongest leading indicator for upstream API / manufacturing failure that hasn't yet reached the user's market. Wraps the /api/predictive-signals route. Use for SUP-25 (early signals not yet officially declared), GOV-28 (early signals next quarter), HCL-05 (formulary drugs at risk in next 90 days), RET-16 (drugs in my regular order at risk in next 30 days).",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO-2 country code of the focal market. Required." },
        min_peers: { type: "number", description: "Minimum peer countries that must be short before a drug is flagged (default 3)." },
        limit: { type: "number", description: "Max candidates to return (default 20)." },
      },
      required: ["country"],
    },
  },
  // ── Sprint 2 PR 3 — eligibility lookup ──────────────────────────────────
  {
    name: "get_eligibility_status",
    description:
      "Lookup eligibility for shortage-specific regulatory pathways — TGA Section 19A (AU), MHRA Serious Shortage Protocol (UK), DHSC Medicine Supply Notification (UK), FDA Drug Shortage list (US), FDA 503B outsourcing (US), EU Article 5(2) per-country exemption (EU). Returns the active eligibility entries with regulator-published reference IDs, descriptions, lifecycle dates and canonical source URLs. When no entries exist on file (e.g. before scrapers backfill the regulatory_eligibility table) returns the audit §11 eligibility refusal envelope so the model lands on the canonical refusal template — directing the user at the live regulator URL — instead of improvising. Use for SUP-15/16/17/18, RET-08/27, HPR-18 — the ⚠ HALLUCINATION RISK eligibility cluster.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID (preferred when known)." },
        generic_name: { type: "string", description: "Generic name (use when drug_id not resolved)." },
        country: { type: "string", description: "ISO-2 country code. Required." },
        scheme: { type: "string", description: "Optional filter to one scheme: tga_s19a | mhra_ssp | dhsc_msn | fda_503b | fda_shortage | eu_art_5_2." },
      },
      required: ["country"],
    },
  },
  // ── Sprint 2 PR 1 (audit §4 remaining 11 tools) ──────────────────────────
  {
    name: "get_recurring_shortages",
    description:
      "Recurring-shortage view — drugs with ≥2 events for a scope (single drug or ATC class) over a time window. Use for SUP-22, RET-23, HCL-19, GOV-08, RET-16 — structural-undersupply / recurrence-pattern questions.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID (single-drug history)." },
        atc_prefix: { type: "string", description: "ATC prefix (class-level recurrence)." },
        country: { type: "string", description: "Optional ISO-2 country to narrow scope." },
        since: { type: "string", description: "ISO date — count events on or after this date (default: all-time)." },
      },
    },
  },
  {
    name: "get_shortage_history",
    description:
      "Full shortage history for one drug — timeline (up to 50 events), per-country recurrence + duration stats, median resolved duration. Use whenever the user asks 'has this been short before', 'how often does this happen', or wants the recurrence detail behind a drug card's quarterly chip.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "Optional ISO-2 country to scope." },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_available_brands",
    description:
      "Active brand/sponsor view for a drug in a country — grouped by sponsor with strength, dosage form, route, PBS-listed flag, generic flag. Use for RET-03 (different brand right now), RET-04 (what pack sizes available), RET-19 (alt brands for standing order), SUP-11 (who supplies this in [country] at what doses).",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "ISO-2 country code. Required." },
      },
      required: ["drug_id", "country"],
    },
  },
  {
    name: "get_recent_deregistrations",
    description:
      "Recently deregistered / cancelled / withdrawn / suspended drug-product registrations. Use for SUP-13 (major supplier just discontinued), RET-18 (slow-moving lines at risk of permanent discontinue), and any 'who pulled out of the market recently' question. Default window: last 12 months.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Optional drug UUID to scope." },
        country: { type: "string", description: "Optional ISO-2 country code." },
        since: { type: "string", description: "Optional ISO date floor (default: 12 months ago)." },
      },
    },
  },
  {
    name: "get_dose_conversion",
    description:
      "Verified dose-conversion + monitoring notes between two specific drugs. HIGH STAKES — returns a refusal envelope when no verified entry exists rather than improvising from priors. Use for HCL-15 / RET-12 dose-conversion questions. Pair with refusal-template language when status=unanswerable.",
    input_schema: {
      type: "object",
      properties: {
        from_drug_id: { type: "string", description: "Drug being switched FROM. Required." },
        to_drug_id: { type: "string", description: "Drug being switched TO. Required." },
      },
      required: ["from_drug_id", "to_drug_id"],
    },
  },
  {
    name: "get_therapeutic_equivalents",
    description:
      "FDA Orange Book / WHO EML therapeutic-equivalence + bioequivalence ratings. Different from find_substitutes (which is ATC-class-matched) — these are formal regulator-grade equivalence statements. Use for RET-06 (need prescriber approval?), HPR-17 (registered alt suppliers fulfilling today).",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "Optional ISO-2 country." },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_supplier_shortage_record",
    description:
      "Shortage attribution by manufacturer / sponsor over time — events count, quarterly breakdown, mean resolved duration. Use for HPR-01 (contracted suppliers with worst record), HPR-04 (suppliers improved/deteriorated QoQ), GOV-07 (suppliers with late/missing notifications).",
    input_schema: {
      type: "object",
      properties: {
        manufacturer_or_sponsor: { type: "string", description: "Supplier name (fuzzy ILIKE match). Required." },
        since: { type: "string", description: "Optional ISO date floor (default: 12 months ago)." },
        country: { type: "string", description: "Optional ISO-2 country." },
      },
      required: ["manufacturer_or_sponsor"],
    },
  },
  {
    name: "get_facility_distress_signals",
    description:
      "FDA inspection / EU EudraGMDP distress signals — sites with OAI classification, recent warning letters, or active import alerts. Use for SUP-12 (competitor sites with recent recalls / warning letters / GMP issues), SUP-23 (India/Chinese API distress — caveat: US/EU coverage only; India CDSCO + China NMPA NOT covered).",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "Optional ISO-2 country of the facility." },
        drug_id: { type: "string", description: "Optional drug UUID to scope to facilities supplying this drug." },
        limit: { type: "number", description: "Max results (default 25)." },
      },
    },
  },
  {
    name: "get_price_around_shortage",
    description:
      "Price-vs-shortage time-series correlation for one drug — median price in window before vs after each shortage start, pct change. Use for SUP-07 (price during shortage vs baseline), HCL-11 (pricing during recent shortages), HPR-15 (most expensive substitutions). Coverage best for UK + AU.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "ISO-2 country code. Required." },
        window_days: { type: "number", description: "Days before/after shortage start to compute medians (default 180, max 720)." },
      },
      required: ["drug_id", "country"],
    },
  },
  {
    name: "get_management_guidance",
    description:
      "Regulator-published shortage management_action text (TGA-rich, others sparse). Use for RET-26 (regulator shortage guidance issued), RET-30 (alert when guidance changes), and any 'what's the regulator telling pharmacists to do about this' question.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "Optional ISO-2 country." },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_recall_links",
    description:
      "Recall ↔ shortage causal links from recall_shortage_links — surfaces when a recall caused / preceded / coincided with a shortage. Use for SUP-12 follow-ups, HPR/HCL provenance questions, and recall-driven supply analysis. Recall coverage: US/CA/AU/EU/GB only.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
      },
      required: ["drug_id"],
    },
  },
  // ── Sprint 3 PR 2 — buyer-side demand telemetry ─────────────────────────
  {
    name: "get_demand_signal_summary",
    description:
      "Weekly buyer-side demand-signal summary for a drug — searches, drug-card views, supplier enquiries, watchlist adds, chip clicks. Returns only buckets above the k-anonymity floor of 5 distinct sessions per drug × country × week. Use for SUP-08/09/26/27/28 — buyer demand-side questions. Returns a 'no data' envelope when the route-handler instrumentation hasn't yet wired up to populate demand_signals.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        country: { type: "string", description: "Optional ISO-2 country code to narrow scope." },
        weeks: { type: "number", description: "Lookback in weeks (default 12, max 52)." },
      },
      required: ["drug_id"],
    },
  },
  // Sprint 4 PR 2 — auth-required portfolio tools (audit §4.8)
  {
    name: "get_my_portfolio_status",
    description:
      "AUTH REQUIRED. For the signed-in user, returns shortage status of every drug in their watchlist + supplier portfolio. Surfaces which portfolio drugs are currently in shortage, worst severity, countries affected, and WHO-essential overlap. Use for SUP-03 ('shortages overlapping my catalogue'), RET-16 ('drugs in my regular order at risk'), HCL-01 ('shortages affecting drugs we dispense' — uses watchlist as a stand-in for formulary). Returns a sign-in envelope when called without auth.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_watchlist_demand",
    description:
      "AUTH REQUIRED (supplier-side). Overlays anonymised buyer-demand counts (v_demand_signal_summary, k-anon ≥ 5) against the signed-in user's supplier_portfolios drug_ids. Returns drugs in portfolio that buyers are actively searching for + how often. Use for SUP-26 ('buyers actively searching for products I supply'), SUP-28 ('watchlist subscribers for my drugs'). Returns a sign-in or no-portfolio envelope when not applicable.",
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "Optional ISO-2 country to narrow scope." },
        weeks: { type: "number", description: "Lookback in weeks (default 8, max 52)." },
      },
    },
  },
  {
    name: "set_portfolio_alert",
    description:
      "AUTH REQUIRED. WRITE OP. Enables / disables / updates a watchlist alert for the signed-in user on a specific drug. Use for SUP-29, HCL-28, RET-28/29. Returns a sign-in envelope when called without auth.",
    input_schema: {
      type: "object",
      properties: {
        drug_id: { type: "string", description: "Drug UUID. Required." },
        threshold: { type: "string", description: "any | active_only | critical_only (default 'any')." },
        channel: { type: "string", description: "email | sms | webhook (default email)." },
        enabled: { type: "boolean", description: "Set false to disable an existing alert; default true." },
      },
      required: ["drug_id"],
    },
  },
];

export type ToolContext = {
  drugs: Record<string, DrugDetail>;
  subs: Record<string, SubstituteRow>;
  /** Hydrated class summaries keyed by ATC code (uppercase). Populated by
   *  get_class_summary; consumed by the frontend when it sees <class_card />.*/
  classes: Record<string, ClassSummary>;
  /** Optional authenticated user_id (Supabase Auth uid). Populated by the
   *  /api/chat route from createServerClient().auth.getUser(). Auth-required
   *  tools (get_my_portfolio_status, get_watchlist_demand, set_portfolio_alert)
   *  refuse cleanly when null with a 'sign in' hint. */
  user_id?: string | null;
};

export function newContext(overrides?: { user_id?: string | null }): ToolContext {
  return { drugs: {}, subs: {}, classes: {}, user_id: overrides?.user_id ?? null };
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
    // Confidence for the shortage claim attached to this drug. Absent when
    // there are no active rows (no shortage claim to be confident about).
    confidence: sourcesConsulted
      ? confidenceFromSources(sourcesConsulted, { signalCount: activeRows.length })
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
  if (altRows.length === 0) {
    // No alternatives recorded — return a zero-row low-confidence envelope
    // so the model surfaces the §11 dose-conversion / substitute refusal
    // template instead of inventing alternatives from priors.
    return Object.assign([] as SubstituteRow[], {
      confidence: {
        level: "low",
        score: 0,
        basis: "No ATC-matched alternatives on file for this drug.",
      } satisfies Confidence,
    }) as any;
  }

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
  // Confidence for the substitute set — backed by curated drug_alternatives
  // rows, so reliability is high (Mederti pharmacists / WHO EML / FDA Orange
  // Book sources). Use clinical_evidence_level as the per-row reliability:
  // A → 0.95, B → 0.85, C → 0.7, D → 0.5, E → 0.4. Best-of-set drives the
  // aggregate. signalCount = number of alternatives surfaced.
  const evidenceScore = (lvl: string | null | undefined): number => {
    if (!lvl) return 0.6;
    const k = lvl.toUpperCase();
    if (k === "A") return 0.95;
    if (k === "B") return 0.85;
    if (k === "C") return 0.7;
    if (k === "D") return 0.5;
    return 0.4;
  };
  const bestEvidence = out.reduce(
    (best, s) => Math.max(best, evidenceScore(s.clinical_evidence_level)),
    0
  );
  const confidence = computeConfidence({
    sourceReliability: bestEvidence,
    signalCount: out.length,
    freshnessDays: 0, // drug_alternatives is curated reference data, not scraped
  });
  return Object.assign(out, {
    confidence: {
      ...confidence,
      basis: `${out.length} substitute${out.length === 1 ? "" : "s"} (best evidence ${
        out
          .map((s) => s.clinical_evidence_level)
          .filter(Boolean)[0] ?? "unspecified"
      }) from Mederti's curated alternates table.`,
    },
  }) as any;
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

  // Provenance + confidence — backed by the SAME rows the items are summarised
  // from so the chip strip and the confidence basis stay in sync with the
  // count surfaced to the model.
  const sourcesConsulted = await computeSourcesConsulted(rows.slice(0, limit) as any);
  const confidence = confidenceFromSources(sourcesConsulted, {
    signalCount: items.length,
  });

  // When a severity filter was wiped, return the unfiltered rows + a flag so
  // the model can be honest ("no rows tagged X, here's what's active").
  if (severityFallbackApplied) {
    return {
      items,
      severity_fallback_applied: true,
      note: `No active shortages tagged severity=${args.severity}. Returning all severities so you can answer honestly — severity tagging coverage is sparse across regulators.`,
      sources_consulted: sourcesConsulted,
      confidence,
    } as any;
  }
  // Return the legacy shape (raw array) when no caveat applies — wrap in an
  // object instead when callers want the confidence block. The model picks up
  // either shape via tool-result inspection.
  return {
    items,
    sources_consulted: sourcesConsulted,
    confidence,
  } as any;
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
  // Supplier-listed prices are sparse — confidence reflects volume of evidence.
  // Zero rows → low (audit §11 HPR-13/16 template territory). 1–2 → low-medium.
  // 3+ rows → medium (still not procurement-grade — these are listed prices,
  // not transacted ones).
  const confidence = computeConfidence({
    sourceReliability: 0.6,
    signalCount: rows.length,
    freshnessDays: 0, // supplier_inventory has its own status field; trust the rows we get
  });
  return Object.assign(rows, {
    confidence: {
      ...confidence,
      basis: rows.length === 0
        ? "No supplier-listed prices on file for this drug."
        : `${rows.length} supplier-listed price point${rows.length === 1 ? "" : "s"} from supplier_inventory.`,
    },
  }) as any;
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
  const rows = (data ?? []) as RecallRow[];

  // Provenance for recalls — same regulator mapping as shortages, using
  // country_code as the join key. announced_date carries the timing signal
  // when last_scraped_at is missing.
  const provenanceRows = rows.map((r) => ({
    country_code: r.country_code ?? null,
    start_date: r.announced_date ?? null,
  }));
  const sourcesConsulted = await computeSourcesConsulted(provenanceRows);
  const confidence = confidenceFromSources(sourcesConsulted, { signalCount: rows.length });

  return Object.assign(rows, {
    sources_consulted: sourcesConsulted,
    confidence,
  }) as any;
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
    {
      last_scraped_at: string | null;
      source_url: string | null;
      /** Max reliability_weight observed across this country's data_sources rows.
       *  Drives the confidence helper's per-source aggregation downstream. */
      reliability_weight: number;
    }
  >();
  if (countries.length > 0) {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("data_sources")
        .select("country_code,last_scraped_at,source_url,is_active,reliability_weight")
        .in("country_code", countries)
        .eq("is_active", true);
      for (const r of data ?? []) {
        const cc = (r as any).country_code as string | null;
        if (!cc) continue;
        const next = {
          last_scraped_at: (r as any).last_scraped_at as string | null,
          source_url: (r as any).source_url as string | null,
          reliability_weight: typeof (r as any).reliability_weight === "number"
            ? Number((r as any).reliability_weight)
            : 0.7,
        };
        const ex = scrapeMeta.get(cc);
        if (!ex) scrapeMeta.set(cc, next);
        else {
          // Keep the freshest scrape AND the highest reliability observed.
          if (
            next.last_scraped_at &&
            (!ex.last_scraped_at || next.last_scraped_at > ex.last_scraped_at)
          ) {
            ex.last_scraped_at = next.last_scraped_at;
            ex.source_url = next.source_url;
          }
          if (next.reliability_weight > ex.reliability_weight) {
            ex.reliability_weight = next.reliability_weight;
          }
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
        reliability_weight: meta?.reliability_weight ?? 0.7,
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
    confidence: confidenceFromSources(sourcesConsulted, {
      signalCount: working.length,
    }),
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
    confidence: confidenceFromSources(sourcesConsulted, { signalCount: rows.length }),
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

// ─── Sprint 1 Step 5 quick-win tools (audit §1.4) ────────────────────────────
//
// Five new tools backed by existing Supabase tables. Each:
//   • returns confidence per the Step 4 contract
//   • returns sources_consulted (where row data backs the answer)
//   • returns an unanswerable envelope when the country is not_indexed
//     instead of silently empty arrays
//
// The audit's coverage projection: these unlock ~20 questions across all
// personas (mainly GOV + SUP + HCL) and lift strict-GREEN coverage from
// 10.7% → ~24%.

const PEER_GROUPS_DEFAULT: Record<string, string[]> = {
  GB: ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  IE: ["GB", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  AU: ["NZ", "GB", "US", "CA", "SG"],
  NZ: ["AU", "GB", "US", "CA", "SG"],
  CA: ["US", "GB", "EU", "FR", "DE", "AU"],
  US: ["CA", "GB", "EU", "FR", "DE"],
  IT: ["DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  DE: ["IT", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  FR: ["IT", "DE", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  ES: ["IT", "DE", "FR", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  EU: ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "FI", "SE", "DK"],
  NL: ["IT", "DE", "FR", "ES", "BE", "IE", "PT", "AT", "CH", "FI", "GB", "EU"],
  BE: ["NL", "IT", "DE", "FR", "ES", "IE", "PT", "AT", "CH", "FI", "GB", "EU"],
  CH: ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "AT", "FI", "GB", "EU"],
  NO: ["SE", "FI", "DK", "DE", "FR", "GB", "EU"],
  FI: ["SE", "NO", "DK", "DE", "FR", "GB", "EU"],
  SE: ["NO", "FI", "DK", "DE", "FR", "GB", "EU"],
  DK: ["SE", "NO", "FI", "DE", "FR", "GB", "EU"],
  JP: ["US", "CA", "AU", "NZ", "GB", "EU"],
};

const SEV_RANK_STEP5: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Tool 1: get_sole_source_essentials ────────────────────────────────────
async function getSoleSourceEssentials(args: {
  country: string;
  who_only?: boolean;
  limit?: number;
}) {
  const country = (args.country || "").toUpperCase();
  if (!country) {
    return {
      status: "unanswerable",
      reason: "missing_country",
      hint: "Pass a 2-letter ISO country code (e.g. AU, GB, US).",
    };
  }
  const gate = coverageGate("shortages", country);
  if (gate) return gate;

  const sb = getSupabase();
  const whoOnly = args.who_only !== false; // default true
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);

  // 1. Pull candidate drugs (WHO EML if filtered, else all).
  let drugQuery = sb
    .from("drugs")
    .select("id,generic_name,atc_code,atc_description,drug_class,who_essential_medicine,critical_medicine_eu")
    .not("generic_name", "is", null);
  if (whoOnly) drugQuery = drugQuery.eq("who_essential_medicine", true);
  const { data: drugs, error: drugErr } = await drugQuery.limit(2000);
  if (drugErr) throw new Error(drugErr.message);

  if (!drugs || drugs.length === 0) {
    return {
      status: "unanswerable",
      reason: whoOnly ? "no_who_essentials_loaded" : "no_drugs_in_db",
      hint: whoOnly
        ? "Mederti hasn't tagged any drugs as WHO Essential Medicines in this DB. Run the WHO EML importer or set who_only=false."
        : "No drugs in the database — something is wrong with the data load.",
    };
  }

  const drugIds = drugs.map((d: any) => d.id);

  // 2. For each drug, count DISTINCT active sponsors with products registered
  //    in the country. drug_products carries (sponsor_id, country, registry_status).
  //    'Active' covers ARTG Active, PL Authorised, NDA approved equivalents.
  const ACTIVE_STATUSES = ["Active", "active", "Authorised", "authorised", "Approved", "approved", "Marketed"];
  const { data: products } = await sb
    .from("drug_products")
    .select("sponsor_id,product_name,registry_status,country")
    .in("registry_status", ACTIVE_STATUSES)
    .eq("country", country);

  // drug_products doesn't directly carry drug_id (registry-entry table).
  // Bridge via product_name ILIKE generic_name. Use a normalised map for speed.
  const drugNameById = new Map<string, { name: string; row: any }>();
  for (const d of drugs as any[]) {
    const n = (d.generic_name || "").trim().toLowerCase();
    if (n) drugNameById.set(d.id, { name: n, row: d });
  }

  // sponsors-per-drug count
  const sponsorsByDrug = new Map<string, Set<string>>();
  const sampleSponsorByDrug = new Map<string, string>(); // first sponsor_id seen
  for (const p of products ?? []) {
    const pn = ((p as any).product_name || "").toLowerCase();
    if (!pn) continue;
    for (const [drugId, info] of drugNameById) {
      if (pn.includes(info.name)) {
        const sid = (p as any).sponsor_id;
        if (!sid) continue;
        let set = sponsorsByDrug.get(drugId);
        if (!set) {
          set = new Set();
          sponsorsByDrug.set(drugId, set);
          sampleSponsorByDrug.set(drugId, sid);
        }
        set.add(sid);
      }
    }
  }

  // 3. Resolve sponsor names for the single-supplier drugs.
  const soleSourceDrugIds: string[] = [];
  const sponsorIdsToResolve = new Set<string>();
  for (const [drugId, sponsors] of sponsorsByDrug) {
    if (sponsors.size === 1) {
      soleSourceDrugIds.push(drugId);
      sponsorIdsToResolve.add([...sponsors][0]);
    }
  }

  let sponsorNameById = new Map<string, string>();
  if (sponsorIdsToResolve.size > 0) {
    const { data: sps } = await sb
      .from("sponsors")
      .select("id,name")
      .in("id", [...sponsorIdsToResolve]);
    for (const s of sps ?? []) sponsorNameById.set((s as any).id, (s as any).name);
  }

  // 4. Active shortage status for these drugs in this country.
  const inShortage = new Set<string>();
  if (soleSourceDrugIds.length > 0) {
    const { data: shorts } = await sb
      .from("shortage_events")
      .select("drug_id")
      .eq("status", "active")
      .eq("country_code", country)
      .in("drug_id", soleSourceDrugIds);
    for (const r of shorts ?? []) if ((r as any).drug_id) inShortage.add((r as any).drug_id);
  }

  // 5. Assemble + rank: WHO + critical first, then in-shortage, then alpha.
  const out = soleSourceDrugIds
    .map((id) => {
      const info = drugNameById.get(id);
      const drug = info?.row;
      const sponsorId = sampleSponsorByDrug.get(id);
      return {
        drug_id: id,
        name: drug?.generic_name ?? "Unknown",
        atc_code: drug?.atc_code ?? null,
        drug_class: drug?.drug_class ?? null,
        who_essential: !!drug?.who_essential_medicine,
        eu_critical: !!drug?.critical_medicine_eu,
        sole_sponsor_name: sponsorId ? sponsorNameById.get(sponsorId) ?? null : null,
        currently_in_shortage: inShortage.has(id),
      };
    })
    .sort((a, b) => {
      const ax = (a.who_essential ? 4 : 0) + (a.eu_critical ? 2 : 0) + (a.currently_in_shortage ? 1 : 0);
      const bx = (b.who_essential ? 4 : 0) + (b.eu_critical ? 2 : 0) + (b.currently_in_shortage ? 1 : 0);
      if (ax !== bx) return bx - ax;
      return (a.name || "").localeCompare(b.name || "");
    })
    .slice(0, limit);

  // Confidence — backed by drug_products registration data + drugs WHO flag.
  // Reliability is high (regulator registry data), freshness is high (registry
  // is daily-scraped), signal volume is the count of sole-source candidates
  // found. The trap: this is a structural snapshot, not a live signal — flag
  // explicitly in the basis so the model adds a caveat.
  const confidence = computeConfidence({
    sourceReliability: 0.9,
    signalCount: Math.max(out.length, 3), // any non-zero result is corroborated
    freshnessDays: 1,
  });

  return {
    country,
    who_only: whoOnly,
    total_candidates_checked: drugs.length,
    sole_source_count: out.length,
    items: out,
    confidence: {
      ...confidence,
      basis: `Cross-reference of drugs.who_essential_medicine + drug_products active sponsors per country. ${out.length} sole-source drugs found in ${country}. Sponsor-name matching uses product_name ILIKE generic_name — coverage best for single-INN drugs, weaker for combinations.`,
    },
    notes: [
      "Sole-source = exactly ONE active sponsor (drug_products row with active status) in the country.",
      "Sponsor name is resolved via the first matching product; combination products may surface a partial sponsor list.",
      "This is a structural risk snapshot — does NOT mean these drugs are in shortage today (see currently_in_shortage per row).",
    ],
  };
}

// ── Tool 2: compare_shortage_burden ───────────────────────────────────────
async function compareShortageBurden(args: { country: string; peer_set?: string[] }) {
  const focal = (args.country || "").toUpperCase();
  if (!focal) {
    return { status: "unanswerable", reason: "missing_country", hint: "Pass a 2-letter ISO country code." };
  }
  const gate = coverageGate("shortages", focal);
  if (gate) return gate;

  const peers = (args.peer_set && args.peer_set.length > 0)
    ? args.peer_set.map((c) => c.toUpperCase())
    : (PEER_GROUPS_DEFAULT[focal] ?? PEER_GROUPS_DEFAULT.GB);

  const allCountries = [focal, ...peers.filter((c) => c !== focal)];
  const sb = getSupabase();

  // Pull all active events for the focal + peer set in one shot, paginated.
  const events: Array<{ drug_id: string | null; country_code: string; severity: string | null; start_date: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("shortage_events")
      .select("drug_id,country_code,severity,start_date,drugs!inner(who_essential_medicine)")
      .eq("status", "active")
      .in("country_code", allCountries)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    events.push(...(data as any[]));
    if (data.length < 1000) break;
    offset += 1000;
  }

  // Per-country aggregate.
  type Bucket = {
    country: string;
    total_active_events: number;
    by_severity: Record<string, number>;
    unique_drugs: Set<string>;
    who_essential_events: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const c of allCountries) {
    buckets.set(c, { country: c, total_active_events: 0, by_severity: {}, unique_drugs: new Set(), who_essential_events: 0 });
  }
  for (const ev of events) {
    const b = buckets.get(ev.country_code);
    if (!b) continue;
    b.total_active_events += 1;
    const sev = ev.severity || "untagged";
    b.by_severity[sev] = (b.by_severity[sev] || 0) + 1;
    if (ev.drug_id) b.unique_drugs.add(ev.drug_id);
    const drugs = (ev as any).drugs;
    if (drugs && drugs.who_essential_medicine) b.who_essential_events += 1;
  }

  // Drugs short in focal vs short in any peer.
  const focalDrugIds = buckets.get(focal)!.unique_drugs;
  const peerDrugIds = new Set<string>();
  for (const c of peers) {
    for (const d of buckets.get(c)?.unique_drugs ?? []) peerDrugIds.add(d);
  }
  const unique_to_focal: string[] = [...focalDrugIds].filter((d) => !peerDrugIds.has(d));
  const short_in_peers_not_focal: string[] = [...peerDrugIds].filter((d) => !focalDrugIds.has(d));
  const short_in_both: string[] = [...focalDrugIds].filter((d) => peerDrugIds.has(d));

  // Hydrate the top drug names for unique_to_focal + short_in_peers_not_focal (cap 10 each).
  const idsToName = [...unique_to_focal.slice(0, 10), ...short_in_peers_not_focal.slice(0, 10)];
  let drugNames = new Map<string, string>();
  if (idsToName.length > 0) {
    const { data: drugRows } = await sb.from("drugs").select("id,generic_name").in("id", idsToName);
    for (const r of drugRows ?? []) drugNames.set((r as any).id, (r as any).generic_name);
  }

  // Sources consulted across all the rows.
  const sourcesConsulted = await computeSourcesConsulted(events as any);
  const confidence = confidenceFromSources(sourcesConsulted, {
    signalCount: events.length,
  });

  return {
    focal_country: focal,
    peer_set: peers,
    per_country: [...buckets.values()]
      .map((b) => ({
        country: b.country,
        total_active_events: b.total_active_events,
        by_severity: b.by_severity,
        unique_drugs_affected: b.unique_drugs.size,
        who_essential_events: b.who_essential_events,
        is_focal: b.country === focal,
      }))
      .sort((a, b) => (a.is_focal ? -1 : 0) - (b.is_focal ? -1 : 0) || b.total_active_events - a.total_active_events),
    unique_to_focal_count: unique_to_focal.length,
    short_in_peers_not_focal_count: short_in_peers_not_focal.length,
    short_in_both_count: short_in_both.length,
    sample_unique_to_focal: unique_to_focal.slice(0, 10).map((id) => ({ drug_id: id, name: drugNames.get(id) ?? "Unknown" })),
    sample_short_in_peers_not_focal: short_in_peers_not_focal.slice(0, 10).map((id) => ({ drug_id: id, name: drugNames.get(id) ?? "Unknown" })),
    sources_consulted: sourcesConsulted,
    confidence,
  };
}

// ── Tool 3: get_class_concentration_risk ──────────────────────────────────
async function getClassConcentrationRisk(args: { atc_prefix: string; country?: string; limit?: number }) {
  const atc = (args.atc_prefix || "").toUpperCase().trim();
  if (!atc) {
    return { status: "unanswerable", reason: "missing_atc_prefix", hint: "Pass an ATC prefix (e.g. J01, L01, A10)." };
  }
  const sb = getSupabase();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

  // 1. Drugs in class
  const { data: drugs, error } = await sb
    .from("drugs")
    .select("id,generic_name,atc_code,who_essential_medicine")
    .like("atc_code", `${atc}%`)
    .limit(500);
  if (error) throw new Error(error.message);
  if (!drugs || drugs.length === 0) {
    return {
      status: "unanswerable",
      reason: "no_drugs_in_class",
      hint: `No drugs found with ATC prefix '${atc}'. Verify the prefix (e.g. J01 = antibacterials, L01 = oncology, A10 = diabetes).`,
    };
  }

  const drugIds = drugs.map((d: any) => d.id);

  // 2. Concentration view (per-drug manufacturer count + risk tier).
  // The audit cites v_drug_manufacturer_concentration. The view's exact shape
  // can drift; tolerate alternative column names.
  let concentration: any[] = [];
  try {
    const { data } = await sb
      .from("v_drug_manufacturer_concentration")
      .select("*")
      .in("drug_id", drugIds)
      .limit(500);
    concentration = data ?? [];
  } catch (e) {
    // View may not exist on every DB; fall back to api_supply_summary if present.
    concentration = [];
  }

  // Map by drug_id
  const concentrationByDrug = new Map<string, any>();
  for (const row of concentration) {
    const id = row.drug_id ?? row.id;
    if (id) concentrationByDrug.set(id, row);
  }

  // 3. Cross-reference with active shortages in country (if provided).
  const shortageByDrug = new Map<string, number>();
  let shortageQ = sb.from("shortage_events").select("drug_id").eq("status", "active").in("drug_id", drugIds);
  if (args.country) shortageQ = shortageQ.eq("country_code", args.country.toUpperCase());
  const { data: shorts } = await shortageQ;
  for (const r of shorts ?? []) {
    const id = (r as any).drug_id;
    if (id) shortageByDrug.set(id, (shortageByDrug.get(id) ?? 0) + 1);
  }

  // 4. Assemble. Rank by concentration_risk (single-source first) then shortage count.
  const tierRank: Record<string, number> = { high_risk: 4, moderate_risk: 3, low_risk: 2, unknown: 1 };
  const items = drugs.map((d: any) => {
    const c = concentrationByDrug.get(d.id) ?? {};
    return {
      drug_id: d.id,
      name: d.generic_name,
      atc_code: d.atc_code,
      who_essential: !!d.who_essential_medicine,
      manufacturer_count: c.manufacturer_count ?? c.total_suppliers ?? null,
      concentration_risk: (c.concentration_risk as string) ?? "unknown",
      currently_in_shortage_events: shortageByDrug.get(d.id) ?? 0,
    };
  });

  items.sort((a, b) => {
    const ar = tierRank[a.concentration_risk] ?? 1;
    const br = tierRank[b.concentration_risk] ?? 1;
    if (ar !== br) return br - ar;
    return b.currently_in_shortage_events - a.currently_in_shortage_events;
  });

  // Class-level summary
  const tierCounts: Record<string, number> = {};
  for (const i of items) tierCounts[i.concentration_risk] = (tierCounts[i.concentration_risk] || 0) + 1;

  const confidence = computeConfidence({
    sourceReliability: 0.85, // PharmaCompass + reg data is good but not regulator-grade
    signalCount: items.filter((i) => i.manufacturer_count != null).length,
    freshnessDays: 7, // pharmacompass imports are quarterly-ish
  });

  return {
    atc_prefix: atc,
    country: args.country?.toUpperCase() ?? null,
    drugs_in_class: drugs.length,
    tier_distribution: tierCounts,
    items: items.slice(0, limit),
    confidence: {
      ...confidence,
      basis: `Manufacturer counts via v_drug_manufacturer_concentration (PharmaCompass + drug_rxnorm). ${items.filter((i) => i.manufacturer_count != null).length}/${items.length} drugs in this class have manufacturer-count coverage; the rest fall through as 'unknown'.`,
    },
    notes: [
      "concentration_risk values: high_risk (≤2 suppliers), moderate_risk (≤5), low_risk (>5), unknown (no PharmaCompass data).",
      args.country ? "currently_in_shortage_events is per-country (using the country filter)." : "currently_in_shortage_events is global (no country filter applied).",
      "Manufacturer coverage is best for established generics; specialty/biologic drugs often show as 'unknown'.",
    ],
  };
}

// ── Tool 4: get_resolution_time_stats ─────────────────────────────────────
async function getResolutionTimeStats(args: { drug_id?: string; atc_prefix?: string; country?: string }) {
  const sb = getSupabase();

  if (!args.drug_id && !args.atc_prefix) {
    return {
      status: "unanswerable",
      reason: "missing_scope",
      hint: "Provide either drug_id (single-drug stats) or atc_prefix (class-level stats).",
    };
  }

  // Resolve scope to a list of drug_ids
  let drugIds: string[] = [];
  let scopeLabel = "";
  if (args.drug_id) {
    drugIds = [args.drug_id];
    scopeLabel = `drug ${args.drug_id}`;
  } else if (args.atc_prefix) {
    const atc = args.atc_prefix.toUpperCase().trim();
    const { data } = await sb.from("drugs").select("id").like("atc_code", `${atc}%`).limit(1000);
    drugIds = (data ?? []).map((d: any) => d.id);
    scopeLabel = `ATC ${atc} (${drugIds.length} drugs)`;
  }
  if (drugIds.length === 0) {
    return {
      status: "unanswerable",
      reason: "no_drugs_in_scope",
      hint: "No drugs matched. For ATC prefix queries, verify the prefix (e.g. J01, L01, A10).",
    };
  }

  // Pull RESOLVED events with start_date and end_date populated.
  let q = sb
    .from("shortage_events")
    .select("drug_id,country_code,start_date,end_date,severity")
    .in("drug_id", drugIds)
    .eq("status", "resolved")
    .not("start_date", "is", null)
    .not("end_date", "is", null);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());

  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  if (rows.length === 0) {
    return {
      status: "unanswerable",
      reason: "no_resolved_events",
      hint: `No resolved shortage events with start+end dates for ${scopeLabel}${args.country ? ` in ${args.country}` : ""}. Mederti may have only active events on file, or end_date may not yet be backfilled by the source regulator.`,
      confidence: {
        level: "low",
        score: 0,
        basis: "No resolved sample to compute statistics from.",
      },
    };
  }

  const durations = rows
    .map((r: any) => {
      const s = new Date(r.start_date).getTime();
      const e = new Date(r.end_date).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
      return Math.floor((e - s) / 86400_000);
    })
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b);

  const pct = (p: number) => {
    if (durations.length === 0) return null;
    const idx = Math.min(durations.length - 1, Math.floor(p * (durations.length - 1)));
    return durations[idx];
  };
  const mean = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  // Confidence calibrated to sample size.
  const confidence = computeConfidence({
    sourceReliability: 0.9,
    signalCount: durations.length,
    freshnessDays: 30, // resolution stats are by definition historical
  });

  return {
    scope: scopeLabel,
    country: args.country?.toUpperCase() ?? null,
    n_resolved_events: durations.length,
    median_days: pct(0.5),
    p25_days: pct(0.25),
    p75_days: pct(0.75),
    max_days: durations.length > 0 ? durations[durations.length - 1] : null,
    mean_days: mean,
    confidence: {
      ...confidence,
      basis: `${durations.length} resolved event${durations.length === 1 ? "" : "s"} for ${scopeLabel}${args.country ? ` in ${args.country}` : ""}. ${durations.length < 10 ? "Thin sample — treat percentiles as directional, not precise." : "Sample size adequate for percentile estimates."}`,
    },
    notes: durations.length < 10
      ? ["Sample size < 10 — confidence downgraded automatically; report median with a wide hedge."]
      : [],
  };
}

// ── Tool 5: get_predictive_signals ────────────────────────────────────────
// Inlined re-implementation of /api/predictive-signals so the chat tool
// doesn't need to round-trip through fetch on the same server. Logic and
// peer-set defaults stay in sync via PEER_GROUPS_DEFAULT above.
async function getPredictiveSignals(args: { country: string; min_peers?: number; limit?: number }) {
  const country = (args.country || "").toUpperCase();
  if (!country) {
    return { status: "unanswerable", reason: "missing_country", hint: "Pass a 2-letter ISO country code." };
  }
  const gate = coverageGate("shortages", country);
  if (gate) return gate;

  const minPeers = Math.max(args.min_peers ?? 3, 1);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const peers = PEER_GROUPS_DEFAULT[country] ?? PEER_GROUPS_DEFAULT.GB;
  const sb = getSupabase();

  const allEvents: Array<{ drug_id: string; country_code: string; severity: string; start_date: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from("shortage_events")
      .select("drug_id,country_code,severity,start_date")
      .eq("status", "active")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents.push(...(data as any[]));
    if (data.length < 1000) break;
    offset += 1000;
  }

  type Agg = {
    countries: Set<string>;
    peerCountries: Set<string>;
    inUserCountry: boolean;
    worstSev: string;
    oldestStart: string | null;
  };
  const drugMap = new Map<string, Agg>();
  for (const ev of allEvents) {
    if (!ev.drug_id) continue;
    let d = drugMap.get(ev.drug_id);
    if (!d) {
      d = { countries: new Set(), peerCountries: new Set(), inUserCountry: false, worstSev: "low", oldestStart: null };
      drugMap.set(ev.drug_id, d);
    }
    d.countries.add(ev.country_code);
    if (ev.country_code === country) d.inUserCountry = true;
    if (peers.includes(ev.country_code)) d.peerCountries.add(ev.country_code);
    const r = SEV_RANK_STEP5[ev.severity] ?? 0;
    if (r > (SEV_RANK_STEP5[d.worstSev] ?? 0)) d.worstSev = ev.severity;
    if (ev.start_date && (!d.oldestStart || ev.start_date < d.oldestStart)) d.oldestStart = ev.start_date;
  }

  // Live price concessions by drug → markets. A concession (regulator paying
  // above tariff because pharmacies can't source at price) is a supply-pressure
  // signal that often LEADS the shortage listing; one in the user's own market
  // is the most imminent signal. GB-only today (NHS). Defensive.
  const concCutoff = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
  const concByDrug = new Map<string, Set<string>>();
  try {
    const { data: concRows } = await sb
      .from("drug_pricing_history")
      .select("drug_id,country,effective_date")
      .eq("price_type", "concession")
      .gte("effective_date", concCutoff)
      .not("drug_id", "is", null);
    for (const r of (concRows ?? []) as Array<{ drug_id: string; country: string }>) {
      if (!concByDrug.has(r.drug_id)) concByDrug.set(r.drug_id, new Set());
      concByDrug.get(r.drug_id)!.add(r.country);
    }
  } catch { /* no concession signal → radar still works */ }

  const candidates: Array<{
    drug_id: string;
    peer_count: number;
    peers: string[];
    worst_severity: string;
    oldest_start: string | null;
    days_lead: number | null;
    concession_local: boolean;
    concession_markets: string[];
  }> = [];
  for (const [drugId, d] of drugMap) {
    if (d.inUserCountry) continue;
    const concMarkets = concByDrug.get(drugId) ?? new Set<string>();
    const concessionLocal = concMarkets.has(country);
    // Qualify on peer breadth, OR a live local concession backed by ≥1 peer.
    if (!(d.peerCountries.size >= minPeers || (concessionLocal && d.peerCountries.size >= 1))) continue;
    const days = d.oldestStart ? Math.floor((Date.now() - new Date(d.oldestStart).getTime()) / 86400000) : null;
    candidates.push({
      drug_id: drugId,
      peer_count: d.peerCountries.size,
      peers: [...d.peerCountries].sort(),
      worst_severity: d.worstSev,
      oldest_start: d.oldestStart,
      days_lead: days,
      concession_local: concessionLocal,
      concession_markets: [...concMarkets].sort(),
    });
  }
  // Composite rank: live local concession dominates, then severity, then breadth.
  const score = (c: (typeof candidates)[number]): number =>
    (c.concession_local ? 1000 : 0) +
    (SEV_RANK_STEP5[c.worst_severity] ?? 0) * 100 +
    c.peer_count * 5 +
    c.concession_markets.length * 3;
  candidates.sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return (b.days_lead ?? 0) - (a.days_lead ?? 0);
  });

  const top = candidates.slice(0, limit);
  const drugIds = top.map((c) => c.drug_id);
  const drugLookup = new Map<string, { generic_name: string; atc_code: string | null; who_essential_medicine: boolean }>();
  if (drugIds.length > 0) {
    const { data: drugs } = await sb
      .from("drugs")
      .select("id,generic_name,atc_code,who_essential_medicine")
      .in("id", drugIds);
    for (const d of drugs ?? []) {
      const r = d as any;
      drugLookup.set(r.id, {
        generic_name: r.generic_name,
        atc_code: r.atc_code,
        who_essential_medicine: !!r.who_essential_medicine,
      });
    }
  }

  const results = top.map((c) => ({
    ...c,
    drug_name: drugLookup.get(c.drug_id)?.generic_name ?? "Unknown",
    atc_code: drugLookup.get(c.drug_id)?.atc_code ?? null,
    who_essential: drugLookup.get(c.drug_id)?.who_essential_medicine ?? false,
  }));

  const confidence = computeConfidence({
    sourceReliability: 0.85,
    signalCount: results.length,
    freshnessDays: 1, // scrape cadence is daily
  });

  const concCount = candidates.filter((c) => c.concession_local).length;
  return {
    country,
    peer_set: peers,
    min_peers: minPeers,
    total_candidates: candidates.length,
    concession_candidates: concCount,
    results,
    confidence: {
      ...confidence,
      basis: `${results.length} drug${results.length === 1 ? "" : "s"} short in ${minPeers}+ peer markets but not yet in ${country}. Backed by daily shortage_events scrapes across ${peers.length} peer regulators.`,
    },
    notes: [
      "Peer-set is a regional default for the focal country; pass peer_set to override.",
      "Lead time = days since the OLDEST of the corroborating peer signals started.",
      "Drugs already declared short in the focal country are filtered out — this is a leading-indicator view.",
      "concession_local = a live price concession in the focal market: regulator paying above tariff because pharmacies can't source. A supply-pressure signal that often precedes the local shortage listing; these rank highest and can qualify with fewer peer shortages.",
    ],
  };
}

// ─── Sprint 2 PR 3 — get_eligibility_status (audit §9 item 12, cluster E) ────
//
// Backed by regulatory_eligibility (migration 040). When the table is empty
// (e.g. before scrapers backfill), returns the §11 eligibility refusal
// envelope so the model lands on the canonical refusal template instead of
// improvising. When populated, returns the structured eligibility entry +
// confidence + source URL.
async function getEligibilityStatus(args: { drug_id?: string; generic_name?: string; country: string; scheme?: string }) {
  const country = (args.country || "").toUpperCase();
  if (!country) return { status: "unanswerable", reason: "missing_country", hint: "Pass a 2-letter ISO country code." };
  if (!args.drug_id && !args.generic_name) {
    return { status: "unanswerable", reason: "missing_drug", hint: "Pass drug_id (preferred) or generic_name." };
  }
  const sb = getSupabase();
  let q = sb.from("regulatory_eligibility")
    .select("id,drug_id,generic_name,brand_name,scheme,status,scheme_reference,description,listed_at,expires_at,withdrawn_at,source_url,source_name,last_verified_at")
    .eq("country_code", country)
    .order("listed_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (args.drug_id) q = q.eq("drug_id", args.drug_id);
  else if (args.generic_name) q = q.ilike("generic_name", `%${args.generic_name.replace(/[%_]/g, "")}%`);
  if (args.scheme) q = q.eq("scheme", args.scheme);

  let rows: any[] = [];
  try {
    const { data, error } = await q;
    if (error) throw error;
    rows = (data ?? []) as any[];
  } catch (e: any) {
    // Table may not exist yet (migration 040 unapplied). Treat as no-data path.
    rows = [];
  }

  if (rows.length === 0) {
    return {
      status: "unanswerable",
      reason: "no_eligibility_on_file",
      hint: `Eligibility for ${args.scheme ?? "this scheme"} is determined per-application by the regulator. Mederti doesn't currently index the live eligibility list for ${country}. Canonical sources: TGA s19A (tga.gov.au/resources/section-19a-approvals), MHRA SSP (cpe.org.uk/dispensing-and-supply/supply-chain/ssps/), FDA Drug Shortage (accessdata.fda.gov/scripts/drugshortages/). I can tell you whether the drug is in a declared shortage — that gates eligibility for most pathways.`,
      country, drug_id: args.drug_id ?? null, generic_name: args.generic_name ?? null, scheme: args.scheme ?? null,
      confidence: { level: "low", score: 0, basis: "No eligibility entries on file. Pilot coverage AU/UK/US/EU when scrapers populate regulatory_eligibility." } satisfies Confidence,
    };
  }

  const active = rows.filter((r) => r.status === "active");
  let freshestDays = Infinity;
  for (const r of rows) {
    if (r.last_verified_at) {
      const d = (Date.now() - new Date(r.last_verified_at).getTime()) / 86400_000;
      if (d < freshestDays) freshestDays = d;
    }
  }
  const confidence = computeConfidence({
    sourceReliability: 0.95,
    signalCount: rows.length,
    freshnessDays: Number.isFinite(freshestDays) ? freshestDays : 30,
  });
  return {
    country, drug_id: args.drug_id ?? null, generic_name: args.generic_name ?? null, scheme: args.scheme ?? null,
    total_entries: rows.length,
    active_entries: active.length,
    items: rows.map((r) => ({
      scheme: r.scheme, status: r.status, scheme_reference: r.scheme_reference,
      description: r.description, listed_at: r.listed_at, expires_at: r.expires_at,
      withdrawn_at: r.withdrawn_at, source_url: r.source_url, source_name: r.source_name,
      last_verified_at: r.last_verified_at,
    })),
    confidence: { ...confidence, basis: `${active.length} active eligibility entr${active.length === 1 ? "y" : "ies"} for ${country}${args.scheme ? ` under ${args.scheme}` : ""}. Backed by regulator-published listings; verify against canonical URL before relying on the entry for a clinical or commercial decision.` },
    notes: [
      "Eligibility schemes are issued per-application by the regulator. This view shows what Mederti has scraped, not what's necessarily applicable to a specific applicant or product variant.",
      "Coverage pilot: AU (TGA s19A), UK (MHRA SSP + DHSC MSN), US (FDA Drug Shortage + 503B), EU (Article 5(2) per country).",
    ],
  };
}

// ─── Sprint 2 PR 1 — Remaining 11 typed tools (audit §4) ─────────────────────
// Same contract as Step 5: every tool returns {confidence, sources_consulted?,
// status:"unanswerable"+reason+hint} envelopes.

async function getRecurringShortages(args: { drug_id?: string; atc_prefix?: string; country?: string; since?: string }) {
  if (!args.drug_id && !args.atc_prefix) {
    return { status: "unanswerable", reason: "missing_scope", hint: "Pass drug_id or atc_prefix." };
  }
  const sb = getSupabase();
  let scopeLabel = ""; let drugIds: string[] = [];
  if (args.drug_id) { drugIds = [args.drug_id]; scopeLabel = `drug ${args.drug_id}`; }
  else if (args.atc_prefix) {
    const atc = args.atc_prefix.toUpperCase().trim();
    const { data } = await sb.from("drugs").select("id").like("atc_code", `${atc}%`).limit(500);
    drugIds = (data ?? []).map((d: any) => d.id);
    scopeLabel = `ATC ${atc}`;
  }
  if (drugIds.length === 0) return { status: "unanswerable", reason: "no_drugs_in_scope", hint: "Verify drug_id or ATC prefix." };

  let q = sb.from("shortage_events").select("drug_id,country_code,status,start_date,end_date").in("drug_id", drugIds);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());
  if (args.since) q = q.gte("start_date", args.since);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  type Agg = { drug_id: string; events: number; countries: Set<string>; first_seen: string | null; last_seen: string | null; resolved: number };
  const byDrug = new Map<string, Agg>();
  for (const r of rows as any[]) {
    if (!r.drug_id) continue;
    let b = byDrug.get(r.drug_id);
    if (!b) { b = { drug_id: r.drug_id, events: 0, countries: new Set(), first_seen: null, last_seen: null, resolved: 0 }; byDrug.set(r.drug_id, b); }
    b.events += 1;
    if (r.country_code) b.countries.add(r.country_code);
    if (r.start_date && (!b.first_seen || r.start_date < b.first_seen)) b.first_seen = r.start_date;
    if (r.start_date && (!b.last_seen || r.start_date > b.last_seen)) b.last_seen = r.start_date;
    if (r.status === "resolved") b.resolved += 1;
  }
  const recurring = [...byDrug.values()].filter((b) => b.events >= 2).sort((a, b) => b.events - a.events);

  const ids = recurring.slice(0, 30).map((r) => r.drug_id);
  const { data: drugRows } = ids.length ? await sb.from("drugs").select("id,generic_name,atc_code").in("id", ids) : { data: [] };
  const drugMap = new Map<string, any>();
  for (const d of (drugRows ?? [])) drugMap.set((d as any).id, d);

  const confidence = computeConfidence({ sourceReliability: 0.9, signalCount: rows.length, freshnessDays: 30 });
  return {
    scope: scopeLabel,
    country: args.country?.toUpperCase() ?? null,
    total_drugs_with_events: byDrug.size,
    recurring_drug_count: recurring.length,
    items: recurring.slice(0, 30).map((r) => ({
      drug_id: r.drug_id,
      name: drugMap.get(r.drug_id)?.generic_name ?? "Unknown",
      atc_code: drugMap.get(r.drug_id)?.atc_code ?? null,
      total_events: r.events,
      resolved_events: r.resolved,
      country_count: r.countries.size,
      countries_touched: [...r.countries].sort(),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    })),
    confidence: { ...confidence, basis: `${recurring.length} recurring drugs (≥2 events) out of ${byDrug.size} in scope; ${rows.length} events total.` },
  };
}

async function getShortageHistory(args: { drug_id: string; country?: string }) {
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const sb = getSupabase();
  let q = sb.from("shortage_events")
    .select("country_code,status,severity,start_date,end_date,reason")
    .eq("drug_id", args.drug_id)
    .order("start_date", { ascending: false });
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());
  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      drug_id: args.drug_id,
      country: args.country?.toUpperCase() ?? null,
      timeline: [],
      confidence: { level: "low", score: 0, basis: "No shortage events on file" + (args.country ? ` for ${args.country}.` : ".") } satisfies Confidence,
    };
  }
  const sourcesConsulted = await computeSourcesConsulted(rows as any);
  const byCountry = new Map<string, { events: number; active: number; resolved: number; longestDays: number | null }>();
  const durations: number[] = [];
  for (const r of rows as any[]) {
    const cc = r.country_code || "—";
    let b = byCountry.get(cc);
    if (!b) { b = { events: 0, active: 0, resolved: 0, longestDays: null }; byCountry.set(cc, b); }
    b.events += 1;
    if (["active", "anticipated"].includes(r.status)) b.active += 1;
    if (r.status === "resolved") b.resolved += 1;
    if (r.start_date && r.end_date) {
      const d = Math.floor((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000);
      if (d >= 0) { durations.push(d); if (b.longestDays == null || d > b.longestDays) b.longestDays = d; }
    }
  }
  durations.sort((a, b) => a - b);
  const med = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  return {
    drug_id: args.drug_id,
    country: args.country?.toUpperCase() ?? null,
    total_events: rows.length,
    active_or_anticipated: rows.filter((r: any) => ["active", "anticipated"].includes(r.status)).length,
    resolved: rows.filter((r: any) => r.status === "resolved").length,
    median_resolved_duration_days: med,
    by_country: [...byCountry.entries()].map(([c, b]) => ({ country: c, ...b })).sort((a, b) => b.events - a.events),
    timeline: rows.slice(0, 50).map((r: any) => ({ country: r.country_code, status: r.status, severity: r.severity, start_date: r.start_date, end_date: r.end_date, reason: r.reason })),
    sources_consulted: sourcesConsulted,
    confidence: confidenceFromSources(sourcesConsulted, { signalCount: rows.length }),
  };
}

async function getAvailableBrands(args: { drug_id: string; country: string }) {
  if (!args.drug_id || !args.country) return { status: "unanswerable", reason: "missing_args", hint: "Both drug_id and country required." };
  const country = args.country.toUpperCase();
  const sb = getSupabase();
  const drug = await sb.from("drugs").select("id,generic_name,brand_names").eq("id", args.drug_id).single();
  if (drug.error || !drug.data) return { status: "unanswerable", reason: "drug_not_found", hint: "Verify drug_id." };
  const d: any = drug.data;
  const generic = (d.generic_name || "").trim();
  const brands: string[] = d.brand_names || [];
  const esc = (s: string) => s.replace(/[%_,)(]/g, "").trim();
  const candidates: string[] = [];
  if (generic) candidates.push(generic);
  for (const b of brands.slice(0, 10)) if (b) candidates.push(b);
  if (candidates.length === 0) return { items: [], confidence: { level: "low", score: 0, basis: "No name candidates for matching" } satisfies Confidence };
  const orParts = candidates.flatMap((n) => { const e = esc(n); return [`product_name.ilike.%${e}%`, `trade_name.ilike.%${e}%`]; }).join(",");
  const ACTIVE = ["Active", "active", "Authorised", "authorised", "Approved", "approved", "Marketed"];
  const { data: products } = await sb.from("drug_products")
    .select("product_name,trade_name,strength,dosage_form,route,sponsor_id,registry_status,pbs_listed,is_generic")
    .eq("country", country)
    .in("registry_status", ACTIVE)
    .or(orParts)
    .limit(200);
  const rows = products ?? [];
  if (rows.length === 0) {
    return { drug_id: args.drug_id, country, items: [], confidence: { level: "low", score: 0, basis: `No active registrations matching '${generic}' in ${country} on file.` } satisfies Confidence };
  }
  const sponsorIds = [...new Set(rows.map((r: any) => r.sponsor_id).filter(Boolean))];
  const sponsorMap = new Map<string, string>();
  if (sponsorIds.length > 0) {
    const { data: sps } = await sb.from("sponsors").select("id,name").in("id", sponsorIds);
    for (const s of sps ?? []) sponsorMap.set((s as any).id, (s as any).name);
  }
  const bySponsor = new Map<string, { sponsor: string; products: any[] }>();
  for (const p of rows as any[]) {
    const sn = sponsorMap.get(p.sponsor_id) ?? "Unknown";
    let g = bySponsor.get(sn);
    if (!g) { g = { sponsor: sn, products: [] }; bySponsor.set(sn, g); }
    g.products.push({ product_name: p.product_name, trade_name: p.trade_name, strength: p.strength, dosage_form: p.dosage_form, route: p.route, is_generic: !!p.is_generic, pbs_listed: !!p.pbs_listed });
  }
  const confidence = computeConfidence({ sourceReliability: 0.95, signalCount: bySponsor.size, freshnessDays: 1 });
  return {
    drug_id: args.drug_id,
    country,
    total_active_products: rows.length,
    unique_sponsors: bySponsor.size,
    by_sponsor: [...bySponsor.values()].sort((a, b) => b.products.length - a.products.length),
    confidence: { ...confidence, basis: `${bySponsor.size} sponsor${bySponsor.size === 1 ? "" : "s"} across ${rows.length} active registry entries in ${country}.` },
  };
}

async function getRecentDeregistrations(args: { drug_id?: string; country?: string; since?: string }) {
  const sb = getSupabase();
  const since = args.since || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const CANCELLED = ["Cancelled", "cancelled", "Withdrawn", "withdrawn", "Suspended", "suspended", "Discontinued", "discontinued"];
  let q = sb.from("drug_products")
    .select("product_name,trade_name,sponsor_id,country,registry_status,cancellation_date")
    .in("registry_status", CANCELLED)
    .gte("cancellation_date", since)
    .limit(500);
  if (args.country) q = q.eq("country", args.country.toUpperCase());
  if (args.drug_id) {
    const dr = await sb.from("drugs").select("generic_name").eq("id", args.drug_id).single();
    if (dr.error || !dr.data) return { status: "unanswerable", reason: "drug_not_found", hint: "Verify drug_id." };
    const generic = ((dr.data as any).generic_name || "").trim();
    if (!generic) return { items: [], confidence: { level: "low", score: 0, basis: "Drug has no generic name on file." } satisfies Confidence };
    q = q.or(`product_name.ilike.%${generic}%,trade_name.ilike.%${generic}%`);
  }
  const { data, error } = await q.order("cancellation_date", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const sponsorIds = [...new Set(rows.map((r: any) => r.sponsor_id).filter(Boolean))];
  const sponsorMap = new Map<string, string>();
  if (sponsorIds.length > 0) {
    const { data: sps } = await sb.from("sponsors").select("id,name").in("id", sponsorIds);
    for (const s of sps ?? []) sponsorMap.set((s as any).id, (s as any).name);
  }
  const items = rows.slice(0, 50).map((r: any) => ({
    product_name: r.product_name, trade_name: r.trade_name,
    sponsor: sponsorMap.get(r.sponsor_id) ?? "Unknown",
    country: r.country, registry_status: r.registry_status,
    cancellation_date: r.cancellation_date,
  }));
  const confidence = computeConfidence({ sourceReliability: 0.95, signalCount: rows.length, freshnessDays: 1 });
  return {
    since, country: args.country?.toUpperCase() ?? null, drug_id: args.drug_id ?? null,
    total_deregistrations: rows.length,
    items,
    confidence: { ...confidence, basis: `${rows.length} deregistrations since ${since}${args.country ? ` in ${args.country}` : ""}.` },
  };
}

async function getDoseConversion(args: { from_drug_id: string; to_drug_id: string }) {
  if (!args.from_drug_id || !args.to_drug_id) return { status: "unanswerable", reason: "missing_args", hint: "Both from_drug_id and to_drug_id required." };
  const sb = getSupabase();
  const { data: rows } = await sb.from("drug_alternatives")
    .select("drug_id,alternative_drug_id,dose_conversion_notes,clinical_evidence_level,relationship_type,requires_monitoring,monitoring_notes,similarity_score")
    .or(`and(drug_id.eq.${args.from_drug_id},alternative_drug_id.eq.${args.to_drug_id}),and(drug_id.eq.${args.to_drug_id},alternative_drug_id.eq.${args.from_drug_id})`)
    .limit(2);
  const r = (rows ?? [])[0] as any;
  if (!r || (!r.dose_conversion_notes && !r.monitoring_notes)) {
    return {
      status: "unanswerable",
      reason: "no_verified_conversion",
      hint: "Mederti doesn't have a verified dose-conversion entry for this pair. Dose conversion depends on patient factors not visible to this system. Canonical references: Australian Medicines Handbook / BNF / Micromedex / hospital antimicrobial stewardship guideline.",
      from_drug_id: args.from_drug_id, to_drug_id: args.to_drug_id,
      confidence: { level: "low", score: 0, basis: "No verified dose-conversion entry on file." } satisfies Confidence,
    };
  }
  const e = (r.clinical_evidence_level ?? "").toUpperCase();
  const scoreByEvidence = e === "A" ? 0.9 : e === "B" ? 0.75 : 0.5;
  return {
    from_drug_id: args.from_drug_id, to_drug_id: args.to_drug_id,
    dose_conversion_notes: r.dose_conversion_notes,
    monitoring_notes: r.monitoring_notes,
    requires_monitoring: !!r.requires_monitoring,
    clinical_evidence_level: r.clinical_evidence_level,
    relationship_type: r.relationship_type,
    similarity_score: r.similarity_score,
    confidence: { level: levelFromScore(scoreByEvidence), score: scoreByEvidence, basis: `Mederti curated dose-conversion (evidence ${r.clinical_evidence_level ?? "unspecified"}). Final dose decision is yours — patient factors not visible to this system.` } satisfies Confidence,
  };
}

async function getTherapeuticEquivalents(args: { drug_id: string; country?: string }) {
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const sb = getSupabase();
  const { data: te } = await sb.from("therapeutic_equivalents")
    .select("alternative_drug_id,equivalence_type,evidence_level,notes,source,source_url")
    .eq("drug_id", args.drug_id).limit(30);
  const rows = te ?? [];
  if (rows.length === 0) {
    return { drug_id: args.drug_id, country: args.country?.toUpperCase() ?? null, items: [], confidence: { level: "low", score: 0, basis: "No therapeutic-equivalent entries on file (FDA Orange Book / WHO EML)." } satisfies Confidence };
  }
  const altIds = rows.map((r: any) => r.alternative_drug_id);
  const { data: drugs } = await sb.from("drugs").select("id,generic_name,atc_code").in("id", altIds);
  const drugMap = new Map<string, any>();
  for (const d of (drugs ?? [])) drugMap.set((d as any).id, d);
  const items = rows.map((r: any) => ({
    drug_id: r.alternative_drug_id,
    name: drugMap.get(r.alternative_drug_id)?.generic_name ?? "Unknown",
    atc_code: drugMap.get(r.alternative_drug_id)?.atc_code ?? null,
    equivalence_type: r.equivalence_type, evidence_level: r.evidence_level,
    notes: r.notes, source: r.source, source_url: r.source_url,
  }));
  const bestEvidence = items.reduce((best, i) => {
    const e = (i.evidence_level || "C").toUpperCase();
    const s = e === "A" ? 0.95 : e === "B" ? 0.85 : e === "C" ? 0.7 : 0.6;
    return Math.max(best, s);
  }, 0);
  const confidence = computeConfidence({ sourceReliability: bestEvidence, signalCount: items.length, freshnessDays: 30 });
  return {
    drug_id: args.drug_id, country: args.country?.toUpperCase() ?? null,
    items,
    confidence: { ...confidence, basis: `${items.length} entries; best evidence ${items[0]?.evidence_level ?? "unspecified"} from ${items[0]?.source ?? "—"}.` },
  };
}

async function getSupplierShortageRecord(args: { manufacturer_or_sponsor: string; since?: string; country?: string }) {
  const name = (args.manufacturer_or_sponsor || "").trim();
  if (!name) return { status: "unanswerable", reason: "missing_name", hint: "Pass a manufacturer or sponsor name." };
  const sb = getSupabase();
  const { data: sponsors } = await sb.from("sponsors").select("id,name").ilike("name", `%${name.replace(/[%_]/g, "")}%`).limit(20);
  const { data: mfgs } = await sb.from("manufacturers").select("id,name").ilike("name", `%${name.replace(/[%_]/g, "")}%`).limit(20);
  const mfgIds = (mfgs ?? []).map((m: any) => m.id);
  if ((sponsors ?? []).length === 0 && mfgIds.length === 0) {
    return { status: "unanswerable", reason: "supplier_not_found", hint: `No sponsors or manufacturers matching '${name}'.` };
  }
  const since = args.since || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  let q = sb.from("shortage_events").select("country_code,status,severity,start_date,end_date,reason,drug_id,manufacturer_id").gte("start_date", since);
  if (mfgIds.length > 0) q = q.in("manufacturer_id", mfgIds);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());
  const { data: shorts, error } = await q.limit(1000);
  if (error) throw new Error(error.message);
  const rows = shorts ?? [];
  type Quarter = { period: string; events: number; resolved: number };
  const byQ = new Map<string, Quarter>(); let totalDuration = 0; let resolvedCount = 0;
  for (const r of rows as any[]) {
    if (!r.start_date) continue;
    const d = new Date(r.start_date);
    const period = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    let qx = byQ.get(period);
    if (!qx) { qx = { period, events: 0, resolved: 0 }; byQ.set(period, qx); }
    qx.events += 1;
    if (r.status === "resolved") {
      qx.resolved += 1;
      if (r.end_date) {
        const dur = Math.floor((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000);
        if (dur >= 0) { totalDuration += dur; resolvedCount += 1; }
      }
    }
  }
  const sourcesConsulted = await computeSourcesConsulted(rows as any);
  return {
    supplier_query: name,
    matched_sponsors: (sponsors ?? []).slice(0, 5).map((s: any) => s.name),
    matched_manufacturers: (mfgs ?? []).slice(0, 5).map((m: any) => m.name),
    since, country: args.country?.toUpperCase() ?? null,
    total_events: rows.length,
    active_events: rows.filter((r: any) => r.status === "active").length,
    by_quarter: [...byQ.values()].sort((a, b) => a.period.localeCompare(b.period)),
    mean_resolved_duration_days: resolvedCount > 0 ? Math.round(totalDuration / resolvedCount) : null,
    sources_consulted: sourcesConsulted,
    confidence: confidenceFromSources(sourcesConsulted, { signalCount: rows.length }),
    notes: [
      "Manufacturer attribution depends on shortage_events.manufacturer_id being populated — coverage varies by regulator.",
      "Sponsor and manufacturer name matching is fuzzy (ILIKE); verify matched names match your intended supplier.",
    ],
  };
}

async function getFacilityDistressSignals(args: { country?: string; drug_id?: string; limit?: number }) {
  const sb = getSupabase();
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  let q = sb.from("manufacturing_facilities")
    .select("facility_name,company_name,country,facility_type,last_inspection_date,last_inspection_classification,oai_count_5y,warning_letter_count_5y,import_alert_active,import_alert_number,gmp_authority,source_url")
    .or("last_inspection_classification.eq.OAI,warning_letter_count_5y.gt.0,import_alert_active.eq.true")
    .order("last_inspection_date", { ascending: false, nullsFirst: false })
    .limit(limit * 2);
  if (args.country) q = q.eq("country", args.country.toUpperCase());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    return { country: args.country?.toUpperCase() ?? null, drug_id: args.drug_id ?? null, items: [], confidence: { level: "low", score: 0, basis: "No distress signals in manufacturing_facilities (US/EU coverage)." } satisfies Confidence };
  }
  const confidence = computeConfidence({ sourceReliability: 0.9, signalCount: rows.length, freshnessDays: 30 });
  return {
    country: args.country?.toUpperCase() ?? null, drug_id: args.drug_id ?? null,
    items: rows.slice(0, limit).map((r) => ({
      facility_name: r.facility_name, company_name: r.company_name, country: r.country,
      facility_type: r.facility_type, last_inspection_date: r.last_inspection_date,
      last_inspection_classification: r.last_inspection_classification,
      oai_count_5y: r.oai_count_5y ?? 0, warning_letter_count_5y: r.warning_letter_count_5y ?? 0,
      import_alert_active: !!r.import_alert_active, import_alert_number: r.import_alert_number,
      gmp_authority: r.gmp_authority, source_url: r.source_url,
    })),
    confidence: { ...confidence, basis: `${rows.length} sites with OAI / warning letter / import alert in last 5y. Coverage: US (FDA) + EU (EudraGMDP); India CDSCO / China NMPA NOT covered.` },
  };
}

async function getPriceAroundShortage(args: { drug_id: string; country: string; window_days?: number }) {
  if (!args.drug_id || !args.country) return { status: "unanswerable", reason: "missing_args", hint: "Both drug_id and country required." };
  const sb = getSupabase();
  const window = Math.min(Math.max(args.window_days ?? 180, 30), 720);
  const { data: shorts } = await sb.from("shortage_events").select("start_date,end_date,status").eq("drug_id", args.drug_id).eq("country_code", args.country.toUpperCase()).order("start_date", { ascending: false }).limit(20);
  const { data: prices } = await sb.from("drug_pricing_history").select("effective_date,unit_price,currency,price_type,authority,pack_price,pack_description,source").eq("drug_id", args.drug_id).eq("country", args.country.toUpperCase()).order("effective_date", { ascending: false }).limit(200);
  const shortageRows = (shorts ?? []) as any[];
  const priceRows = (prices ?? []) as any[];
  if (priceRows.length === 0) {
    return { drug_id: args.drug_id, country: args.country.toUpperCase(), items: [], confidence: { level: "low", score: 0, basis: "No pricing history on file for this drug × country." } satisfies Confidence };
  }
  const correlations = shortageRows.map((s: any) => {
    if (!s.start_date) return null;
    const start = new Date(s.start_date).getTime();
    const before: number[] = []; const after: number[] = [];
    for (const p of priceRows) {
      if (!p.effective_date || p.unit_price == null) continue;
      const t = new Date(p.effective_date).getTime();
      const days = (t - start) / 86400000;
      if (days < 0 && days > -window) before.push(Number(p.unit_price));
      else if (days >= 0 && days < window) after.push(Number(p.unit_price));
    }
    const med = (xs: number[]) => xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
    const medBefore = med(before); const medAfter = med(after);
    const pctChange = (medBefore != null && medAfter != null && medBefore > 0) ? Math.round(((medAfter - medBefore) / medBefore) * 10000) / 100 : null;
    return { shortage_start: s.start_date, shortage_end: s.end_date, shortage_status: s.status, median_price_before: medBefore, median_price_after: medAfter, pct_change: pctChange, n_before: before.length, n_after: after.length };
  }).filter(Boolean);
  const confidence = computeConfidence({ sourceReliability: 0.85, signalCount: priceRows.length, freshnessDays: 60 });
  return {
    drug_id: args.drug_id, country: args.country.toUpperCase(),
    window_days: window, total_price_points: priceRows.length, shortage_events: shortageRows.length,
    correlations,
    confidence: { ...confidence, basis: `${priceRows.length} price points across ${shortageRows.length} shortage events; window ±${window}d. Coverage best for UK + AU.` },
  };
}

async function getManagementGuidance(args: { drug_id: string; country?: string }) {
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const sb = getSupabase();
  let q = sb.from("shortage_events")
    .select("country_code,management_action,reason,status,severity,start_date,source_url")
    .eq("drug_id", args.drug_id).not("management_action", "is", null);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());
  const { data } = await q.order("start_date", { ascending: false }).limit(20);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    return { drug_id: args.drug_id, country: args.country?.toUpperCase() ?? null, items: [], confidence: { level: "low", score: 0, basis: "No regulator-published management_action on file. TGA populates this; other regulators sparse." } satisfies Confidence };
  }
  const sourcesConsulted = await computeSourcesConsulted(rows as any);
  return {
    drug_id: args.drug_id, country: args.country?.toUpperCase() ?? null,
    items: rows.map((r) => ({
      country: r.country_code, status: r.status, severity: r.severity, start_date: r.start_date,
      management_action: r.management_action, reason: r.reason, source_url: r.source_url,
    })),
    sources_consulted: sourcesConsulted,
    confidence: confidenceFromSources(sourcesConsulted, { signalCount: rows.length }),
  };
}

async function getRecallLinks(args: { drug_id: string }) {
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const sb = getSupabase();
  const { data: recalls } = await sb.from("recalls")
    .select("id,recall_class,announced_date,reason,country_code,manufacturer,brand_name,press_release_url")
    .eq("drug_id", args.drug_id).order("announced_date", { ascending: false }).limit(20);
  const recallRows = (recalls ?? []) as any[];
  if (recallRows.length === 0) {
    return { drug_id: args.drug_id, items: [], confidence: { level: "low", score: 0, basis: "No recalls on file for this drug. Recall coverage: US/CA/AU/EU/GB only." } satisfies Confidence };
  }
  const recallIds = recallRows.map((r) => r.id);
  const { data: links } = await sb.from("recall_shortage_links")
    .select("recall_id,shortage_id,link_type").in("recall_id", recallIds);
  const linksByRecall = new Map<string, any[]>();
  for (const l of links ?? []) {
    const arr = linksByRecall.get((l as any).recall_id) ?? [];
    arr.push(l); linksByRecall.set((l as any).recall_id, arr);
  }
  const items = recallRows.map((r) => ({
    recall_id: r.id, recall_class: r.recall_class, announced_date: r.announced_date,
    country: r.country_code, manufacturer: r.manufacturer, brand_name: r.brand_name,
    reason: r.reason, press_release_url: r.press_release_url,
    linked_shortages: linksByRecall.get(r.id) ?? [],
  }));
  const confidence = computeConfidence({ sourceReliability: 0.95, signalCount: items.length, freshnessDays: 1 });
  return {
    drug_id: args.drug_id, total_recalls: items.length, total_links: links?.length ?? 0,
    items,
    confidence: { ...confidence, basis: `${items.length} recall${items.length === 1 ? "" : "s"} on file, ${links?.length ?? 0} linked to shortage events.` },
  };
}

// ─── Sprint 3 PR 2: get_demand_signal_summary (audit cluster D) ─────────────
//
// Reads from v_demand_signal_summary (migration 041) — the k-anonymity ≥ 5
// aggregate view over demand_signals. Direct SELECT on demand_signals is
// denied by RLS; this view is the only supported read path. Buckets with
// fewer than 5 distinct session_hashes are suppressed by the view's HAVING
// clause — privacy floor below which we don't release counts.
async function getDemandSignalSummary(args: { drug_id: string; country?: string; weeks?: number }) {
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const sb = getSupabase();
  const weeks = Math.min(Math.max(args.weeks ?? 12, 1), 52);
  const since = new Date(Date.now() - weeks * 7 * 86400_000).toISOString().slice(0, 10);

  let q = sb.from("v_demand_signal_summary")
    .select("drug_id,country_code,signal_type,week_starting,unique_signals,total_signals")
    .eq("drug_id", args.drug_id)
    .gte("week_starting", since)
    .order("week_starting", { ascending: false })
    .limit(500);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());

  let rows: any[] = [];
  try {
    const { data, error } = await q;
    if (error) throw error;
    rows = (data ?? []) as any[];
  } catch {
    rows = []; // migration 041 may not be applied — degrade silently
  }

  if (rows.length === 0) {
    return {
      status: "unanswerable",
      reason: "no_demand_signal",
      hint: "Mederti's demand-signal telemetry either has no data above the k-anonymity floor (≥5 distinct sessions per drug × country × week) for this scope, or the instrumentation isn't yet wired into the route handlers. Either way: no buyer-side demand signal to share. Use shortage prevalence + manufacturer concentration as proxies instead.",
      drug_id: args.drug_id,
      country: args.country?.toUpperCase() ?? null,
      weeks,
      confidence: { level: "low", score: 0, basis: "No demand_signals buckets above k-anonymity floor for this scope." } satisfies Confidence,
    };
  }

  const byType = new Map<string, { weeks: any[]; total_unique: number; total_signals: number }>();
  for (const r of rows) {
    let b = byType.get(r.signal_type);
    if (!b) { b = { weeks: [], total_unique: 0, total_signals: 0 }; byType.set(r.signal_type, b); }
    b.weeks.push({ week_starting: r.week_starting, unique_signals: r.unique_signals, total_signals: r.total_signals, country: r.country_code });
    b.total_unique += r.unique_signals;
    b.total_signals += r.total_signals;
  }

  const confidence = computeConfidence({
    sourceReliability: 0.85,
    signalCount: rows.length,
    freshnessDays: 1,
  });
  return {
    drug_id: args.drug_id,
    country: args.country?.toUpperCase() ?? null,
    weeks,
    privacy: {
      k_anonymity_floor: 5,
      note: "Buckets with <5 distinct sessions per drug × country × week are suppressed by the v_demand_signal_summary view. Session identifiers are hashed with a daily-rotating salt before storage.",
    },
    by_signal_type: [...byType.entries()].map(([type, b]) => ({
      signal_type: type,
      total_unique_sessions: b.total_unique,
      total_signals: b.total_signals,
      weeks: b.weeks.slice(0, 12),
    })),
    confidence: { ...confidence, basis: `${rows.length} weekly buckets across ${byType.size} signal type${byType.size === 1 ? "" : "s"}, all above the k-anonymity floor of 5.` },
    notes: [
      "Signal types: search (text query landed on this drug), drug_view (drug card opened), enquiry (supplier-marketplace enquiry submitted), watchlist_add (user added to watch list), chip_click (clicked a chip suggesting this drug).",
      "Use for SUP-08 (queries received per drug), SUP-09 (highest unmet-demand quarter), SUP-26 (buyers searching for products I supply), SUP-27 (anonymous demand by region), SUP-28 (watchlist subscribers).",
    ],
  };
}

// ─── Sprint 4 PR 2 — Auth-required portfolio tools (audit §4.8) ──────────────
function authRequired(ctx: ToolContext): { status: "unanswerable"; reason: string; hint: string } | null {
  if (!ctx.user_id) {
    return {
      status: "unanswerable",
      reason: "auth_required",
      hint: "This tool needs a signed-in user. Sign in at mederti.vercel.app/login to set up a watchlist or supplier portfolio, then re-ask.",
    };
  }
  return null;
}

async function getMyPortfolioStatus(_args: object, ctx: ToolContext) {
  const refuse = authRequired(ctx);
  if (refuse) return refuse;
  const userId = ctx.user_id!;
  const sb = getSupabase();
  const [{ data: watchRows }, { data: portRows }] = await Promise.all([
    sb.from("user_watchlists").select("drug_id,countries,is_active,alert_threshold").eq("user_id", userId).eq("is_active", true).limit(500),
    sb.from("supplier_portfolios").select("drug_id,notes,added_at").eq("user_id", userId).limit(500),
  ]);
  const watchDrugIds = new Set<string>((watchRows ?? []).map((r: any) => r.drug_id).filter(Boolean));
  const portDrugIds = new Set<string>((portRows ?? []).map((r: any) => r.drug_id).filter(Boolean));
  const allIds = [...new Set([...watchDrugIds, ...portDrugIds])];
  if (allIds.length === 0) {
    return {
      user_id: userId, total_watched: 0, total_portfolio: 0, items: [],
      confidence: { level: "low", score: 0, basis: "Signed-in user has no watchlist entries or supplier portfolio yet." } satisfies Confidence,
    };
  }
  const { data: drugs } = await sb.from("drugs").select("id,generic_name,atc_code,who_essential_medicine").in("id", allIds);
  const drugMap = new Map<string, any>();
  for (const d of drugs ?? []) drugMap.set((d as any).id, d);
  const { data: shorts } = await sb.from("shortage_events").select("drug_id,country_code,status,severity,start_date").eq("status", "active").in("drug_id", allIds);
  const shortagesByDrug = new Map<string, any[]>();
  for (const s of shorts ?? []) {
    const arr = shortagesByDrug.get((s as any).drug_id) ?? [];
    arr.push(s);
    shortagesByDrug.set((s as any).drug_id, arr);
  }
  const items = allIds.map((id) => {
    const d = drugMap.get(id);
    const shortageRows = shortagesByDrug.get(id) ?? [];
    const watchRow = (watchRows ?? []).find((w: any) => w.drug_id === id);
    const portRow = (portRows ?? []).find((p: any) => p.drug_id === id);
    return {
      drug_id: id, name: d?.generic_name ?? "Unknown", atc_code: d?.atc_code ?? null,
      who_essential: !!d?.who_essential_medicine,
      on_watchlist: watchDrugIds.has(id), in_portfolio: portDrugIds.has(id),
      portfolio_added_at: portRow?.added_at ?? null,
      watchlist_threshold: watchRow?.alert_threshold ?? null,
      active_shortage_count: shortageRows.length,
      worst_severity: shortageRows.reduce((w: string | null, s: any) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
        return (order[s.severity || ""] || 0) > (order[w || ""] || 0) ? s.severity : w;
      }, null as string | null),
      countries_short: [...new Set(shortageRows.map((s: any) => s.country_code).filter(Boolean))],
    };
  }).sort((a, b) => (b.active_shortage_count - a.active_shortage_count) || (Number(b.who_essential) - Number(a.who_essential)));
  await Promise.all(items.slice(0, 8).map((i) => getDrugDetails({ drug_id: i.drug_id }, ctx).catch(() => null)));
  const inShortageCount = items.filter((i) => i.active_shortage_count > 0).length;
  const confidence = computeConfidence({ sourceReliability: 0.95, signalCount: items.length, freshnessDays: 1 });
  return {
    user_id: userId, total_watched: watchDrugIds.size, total_portfolio: portDrugIds.size,
    in_shortage_count: inShortageCount, items,
    confidence: { ...confidence, basis: `${items.length} drugs in your watchlist + portfolio; ${inShortageCount} currently in active shortage somewhere.` },
  };
}

async function getWatchlistDemand(args: { country?: string; weeks?: number }, ctx: ToolContext) {
  const refuse = authRequired(ctx);
  if (refuse) return refuse;
  const userId = ctx.user_id!;
  const sb = getSupabase();
  const { data: portRows } = await sb.from("supplier_portfolios").select("drug_id").eq("user_id", userId);
  const drugIds = (portRows ?? []).map((r: any) => r.drug_id).filter(Boolean);
  if (drugIds.length === 0) {
    return {
      user_id: userId, total_portfolio_drugs: 0, items: [],
      confidence: { level: "low", score: 0, basis: "No supplier portfolio on file for this user." } satisfies Confidence,
    };
  }
  const weeks = Math.min(Math.max(args.weeks ?? 8, 1), 52);
  const since = new Date(Date.now() - weeks * 7 * 86400_000).toISOString().slice(0, 10);
  let q = sb.from("v_demand_signal_summary").select("drug_id,country_code,signal_type,week_starting,unique_signals,total_signals").in("drug_id", drugIds).gte("week_starting", since);
  if (args.country) q = q.eq("country_code", args.country.toUpperCase());
  let rows: any[] = [];
  try {
    const { data, error } = await q;
    if (error) throw error;
    rows = (data ?? []) as any[];
  } catch { rows = []; }
  if (rows.length === 0) {
    return {
      user_id: userId, total_portfolio_drugs: drugIds.length, country: args.country?.toUpperCase() ?? null,
      weeks, items: [],
      confidence: { level: "low", score: 0, basis: `${drugIds.length} drugs in your portfolio; no demand-signal buckets above the k-anonymity floor (5) for them in the last ${weeks} weeks.` } satisfies Confidence,
    };
  }
  const byDrug = new Map<string, { total_unique: number; total_signals: number; signal_types: Set<string> }>();
  for (const r of rows) {
    let b = byDrug.get(r.drug_id);
    if (!b) { b = { total_unique: 0, total_signals: 0, signal_types: new Set() }; byDrug.set(r.drug_id, b); }
    b.total_unique += r.unique_signals;
    b.total_signals += r.total_signals;
    b.signal_types.add(r.signal_type);
  }
  const ids = [...byDrug.keys()];
  const { data: drugs } = ids.length ? await sb.from("drugs").select("id,generic_name,atc_code").in("id", ids) : { data: [] };
  const drugMap = new Map<string, any>();
  for (const d of (drugs ?? [])) drugMap.set((d as any).id, d);
  const items = ids.map((id) => {
    const b = byDrug.get(id)!;
    return {
      drug_id: id, name: drugMap.get(id)?.generic_name ?? "Unknown",
      atc_code: drugMap.get(id)?.atc_code ?? null,
      total_unique_sessions: b.total_unique, total_signals: b.total_signals,
      signal_types: [...b.signal_types],
    };
  }).sort((a, b) => b.total_unique_sessions - a.total_unique_sessions);
  const confidence = computeConfidence({ sourceReliability: 0.85, signalCount: items.length, freshnessDays: 1 });
  return {
    user_id: userId, total_portfolio_drugs: drugIds.length, country: args.country?.toUpperCase() ?? null,
    weeks,
    privacy: { k_anonymity_floor: 5, note: "Buckets below 5 distinct sessions suppressed." },
    items,
    confidence: { ...confidence, basis: `${items.length} of your ${drugIds.length} portfolio drugs have demand signals above the k-anon floor in the last ${weeks} weeks.` },
  };
}

async function setPortfolioAlert(args: { drug_id: string; threshold?: "any" | "active_only" | "critical_only"; channel?: "email" | "sms" | "webhook"; enabled?: boolean }, ctx: ToolContext) {
  const refuse = authRequired(ctx);
  if (refuse) return refuse;
  if (!args.drug_id) return { status: "unanswerable", reason: "missing_drug_id", hint: "Pass a drug UUID." };
  const userId = ctx.user_id!;
  const sb = getSupabase();
  const enabled = args.enabled !== false;
  const threshold = args.threshold ?? "any";
  const { error } = await sb.from("user_watchlists").upsert(
    {
      user_id: userId, drug_id: args.drug_id,
      alert_threshold: threshold, is_active: enabled,
      ...(args.channel ? { notification_channels: { [args.channel]: true } } : {}),
    },
    { onConflict: "user_id,drug_id" }
  );
  if (error) {
    return {
      status: "error", reason: "upsert_failed",
      hint: `Could not save the alert: ${error.message}`,
      confidence: { level: "low", score: 0, basis: "Write failed; no change persisted." } satisfies Confidence,
    };
  }
  return {
    user_id: userId, drug_id: args.drug_id, alert_threshold: threshold, enabled,
    confidence: { level: "high", score: 0.9, basis: `Watchlist alert ${enabled ? "enabled" : "disabled"} for the requested drug at threshold '${threshold}'.` } satisfies Confidence,
  };
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
    // Step 5 quick-win tools
    case "get_sole_source_essentials":
      return await getSoleSourceEssentials(input as any);
    case "compare_shortage_burden":
      return await compareShortageBurden(input as any);
    case "get_class_concentration_risk":
      return await getClassConcentrationRisk(input as any);
    case "get_resolution_time_stats":
      return await getResolutionTimeStats(input as any);
    case "get_predictive_signals":
      return await getPredictiveSignals(input as any);
    // Sprint 2 PR 3 — eligibility lookup
    case "get_eligibility_status":
      return await getEligibilityStatus(input as any);
    // Sprint 2 PR 1 — 11 remaining typed tools
    case "get_recurring_shortages":
      return await getRecurringShortages(input as any);
    case "get_shortage_history":
      return await getShortageHistory(input as any);
    case "get_available_brands":
      return await getAvailableBrands(input as any);
    case "get_recent_deregistrations":
      return await getRecentDeregistrations(input as any);
    case "get_dose_conversion":
      return await getDoseConversion(input as any);
    case "get_therapeutic_equivalents":
      return await getTherapeuticEquivalents(input as any);
    case "get_supplier_shortage_record":
      return await getSupplierShortageRecord(input as any);
    case "get_facility_distress_signals":
      return await getFacilityDistressSignals(input as any);
    case "get_price_around_shortage":
      return await getPriceAroundShortage(input as any);
    case "get_management_guidance":
      return await getManagementGuidance(input as any);
    case "get_recall_links":
      return await getRecallLinks(input as any);
    // Sprint 3 PR 2 — demand signals
    case "get_demand_signal_summary":
      return await getDemandSignalSummary(input as any);
    // Sprint 4 PR 2 — auth-required portfolio tools
    case "get_my_portfolio_status":
      return await getMyPortfolioStatus(input as any, ctx);
    case "get_watchlist_demand":
      return await getWatchlistDemand(input as any, ctx);
    case "set_portfolio_alert":
      return await setPortfolioAlert(input as any, ctx);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
