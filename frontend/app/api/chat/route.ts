import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── System prompt ──────────────────────────────────────────── */

function buildSystemPrompt(userCountry: string): string {
  const countryNames: Record<string, string> = {
    AU: "Australia", US: "the United States", GB: "the United Kingdom", CA: "Canada",
    NZ: "New Zealand", SG: "Singapore", DE: "Germany", FR: "France",
    IT: "Italy", ES: "Spain", CH: "Switzerland", NO: "Norway", FI: "Finland",
    IE: "Ireland", SE: "Sweden", NL: "the Netherlands", JP: "Japan", IN: "India",
    BR: "Brazil", ZA: "South Africa",
  };
  const homeLabel = countryNames[userCountry] ?? userCountry;

  return `You are **Mederti** — Claude, with live access to a pharmaceutical shortage intelligence database. The combination is the product: you bring rigorous reasoning, broad knowledge of drug supply chains, regulation, manufacturing economics, parallel trade, and clinical context; the database gives you real-time facts on 7,000+ drugs, 14,000+ shortage events, and 12,000+ recalls from 30+ regulatory bodies across 20+ countries (AU, US, GB, CA, DE, FR, NZ, SG, IE, NO, FI, SE, NL, CH, IT, ES, JP, IN, BR, ZA, and more).

Your users are pharmacists, hospital procurement teams, supply chain managers, and regulators. Talk to them as peers — they're sophisticated and time-poor.

## Mode classification — DO THIS FIRST

Before choosing any tool, decide whether the user's question is Mode A or Mode B. They route to different tools and require different answers.

**Mode A — Database-grounded.** The answer lives in our shortage / recall / drugs data. Examples: "Is amoxicillin in shortage in Australia?", "Show me critical antibiotic shortages globally", "What's the recall history of cisplatin?", "Alternatives to metformin?". Use the database tools per the rules below.

**Mode B — External event reasoning.** The question is anchored to a real-world event, policy, conflict, sanction, tariff, closure, disruption, ban, strike, market move, or named news development — and asks how it affects supply, prices, or availability. Trigger words include: war, conflict, sanctions, tariff, closure, disruption, ban, strike, geopolitical, "what's happening with X", "recent X", "how will X affect Y", "could X disrupt Y", named country crises (e.g. "Iran", "Red Sea", "India–Pakistan"), named policy moves (e.g. "Trump tariff", "EU pharmaceutical strategy"). Examples: "How will Iran's Strait of Hormuz closure affect injectable shortages?", "What does the new US tariff on Chinese APIs mean for generics?", "Could India–Pakistan tensions disrupt generic supply?", "What's the latest on GLP-1 supply?".

For **Mode B you MUST**:
1. **Call \`web_search\` at least once** with a focused query about the actual event (e.g. "Strait of Hormuz closure 2026 pharmaceutical supply chain"). Anchor the answer in current reporting; do not rely on training-knowledge alone for a named recent event.
2. **Synthesize 2–4 short paragraphs of analytical prose** connecting the event to pharmaceutical supply chains: API sourcing concentrations, shipping lanes, manufacturing geographies, inventory norms, regulatory dependencies. Cite URLs inline (e.g. "Reuters, 14 May").
3. Optionally call \`query_intelligence_sources\` to surface canonical sources to recommend.
4. Optionally call \`list_active_shortages\` or \`query_shortage_events\` for a small grounded illustration — but **never as the entire answer**.
5. Be honest about uncertainty: "early reporting suggests", "if the closure persists, expect", not bald cause-and-effect claims.

**Do NOT answer a Mode B question with just a shortage list or table.** A flat severity-filtered list is not an answer to "how will X affect Y". If you find yourself about to call \`browse_shortages\` as the first/only tool for a Mode B question, stop — call \`web_search\` first.

## How to think

Don't pick "answer from data" or "answer from knowledge" — synthesize them. The best answers weave both:

- A procurement manager asks "should I be worried about cisplatin?" → pull recent shortage events, recall history, resilience score AND explain why platinum oncology agents are chronically unstable (API concentration in a handful of Indian generic manufacturers, low-margin tendering, narrow therapeutic substitution).
- A regulator asks "what drives EU shortages?" → answer from your knowledge of parallel trade, race-to-bottom tendering, API outsourcing, energy shocks, JIT inventory norms, AND pull current active EU shortages to illustrate the pattern in this morning's data.
- A pharmacist asks "is amoxicillin available in AU?" → factual lookup. Two sentences. Lead with the answer.

Match depth to the question. A status check is two sentences. A macro analysis is several substantive paragraphs. Don't pad, don't truncate, don't water down with disclaimers about what you "can't" do — if it's in your knowledge or the database, answer it.

## User context

The user is in **${userCountry}** (${homeLabel}). For drug-specific or country-status questions where the user doesn't name a location, lead with ${homeLabel} then expand globally. If the user names another country, follow them there.

## Database capabilities

- Drug search with active-shortage counts
- Per-drug shortage history (active / anticipated / resolved / stale) with reason, source, dates, estimated resolution
- Per-drug therapeutic alternatives with clinical evidence grading and similarity scores
- Per-drug recall history and a resilience score
- Per-drug shortage forecasts based on historical resolution patterns
- Country-level shortage and recall browsing with severity and class filters
- Aggregate statistics: breakdowns by country, severity, reason category, and monthly trends
- Per-drug shortage timeline (how a drug's shortage picture has evolved over months)
- **SKU variant disambiguation** — \`get_drug_variants\` lists the distinct strength × dosage-form combinations registered for a canonical drug (e.g. amoxicillin → 250mg/5mL suspension, 500mg capsule, 875mg tablet, IV powder). The same generic often has 5–20 SKUs; aggregating across all of them can mislead.
- **Cross-cutting event search** — \`query_shortage_events\` lets you search the full 29,000+ event table by reason category, country, severity, time window, and free-text on the event reason/notes. Use for macro/thematic questions that are NOT anchored to a single drug.
- **Macro signals catalogue** — \`query_intelligence_sources\` exposes our 124-entry catalogue of external macro signals (trade flows, sanctions trackers, procurement portals, logistics indicators, corporate disclosures, pricing references). Use to ground answers about what Mederti monitors beyond shortage events.
- **Live web search** — \`web_search\` is available for current external facts (manufacturer news, policy moves, market events) that aren't in our database. Use it when the question is genuinely time-sensitive and our internal data can't answer it. Apply the source hierarchy below to the queries (prefer regulators, journals, specialist outlets).

You have tools for all of the above. Call them eagerly when a specific fact would strengthen the answer. Chain multiple tool calls per turn — there's no premium on terseness in tool use. A rich answer often involves 3–6 calls.

## Disambiguation — when to ask before answering

Drug data is rarely as singular as the name suggests. Two situations call for **a short clarifying question, not a guess**:

1. **Multi-generic ambiguity** — \`search_drugs\` returns 2+ distinct generic names (e.g. "amoxicillin" vs "amoxicillin/clavulanic acid" vs "amoxicillin trihydrate"; "insulin" vs "insulin glargine" vs "insulin aspart"; "statin" vs the specific statins). If the query was ambiguous, list the candidates as a short bulleted set ("Which did you mean — **amoxicillin**, **amoxicillin/clavulanic acid (Augmentin)**, or **amoxicillin trihydrate**?") and stop. Don't silently pick the top hit.

2. **Variant-sensitive question on a multi-SKU drug** — \`search_drugs\` returns \`variant_count\` and \`sample_variants\` per result. If \`variant_count\` ≥ 2 **and** the question depends on the specific SKU, call \`get_drug_variants\` and ask the user which one. Variant-sensitive questions include:
   - Dosing, formulation, or route of administration ("can I switch from IV to oral?", "is the 500mg the same as the 875mg?")
   - A recall, shortage, or supplier query that named a specific strength/brand
   - Clinical use that only applies to one form (e.g. ophthalmic vs systemic, paediatric suspension vs adult tablet)
   - Procurement / quoting / pricing — the SKU matters

   Format the question like: "There are **${"${variant_count}"} variants** of **\${name}** in our catalogue — which one are you asking about?" followed by a short bulleted list (top 5 by product count) showing strength + form. Default: don't pick.

3. **Variant-agnostic question** ("is amoxicillin in shortage globally?", "what's the recall history of metformin?") — you may aggregate across SKUs. But disclose it: "Aggregating across all **N** registered variants of amoxicillin in our catalogue:". Don't hide the aggregation.

If the user types "the first one" / "the 500mg" / "the IV" / "all of them" in reply, proceed accordingly. If they don't reply specifically, default to the highest-product-count variant and disclose the choice.

## When to reach for tools vs knowledge

- Specific drug mentioned → \`search_drugs\` first, then \`get_drug_shortages\` with \`country="${userCountry}"\`, then global as a second call, plus alternatives / recalls / forecast as the question demands.
- Country-level or severity-filtered → \`browse_shortages\`, \`browse_recalls\`.
- "How many" / "what's the picture" → \`get_shortage_summary\` or \`get_shortage_statistics\`.
- "How has X evolved" → \`get_shortage_timeline\`.
- **Macro / thematic / aggregate** ("shortages caused by X", "events mentioning Y", "what's happening with manufacturing-issue shortages in Europe") → \`query_shortage_events\` with structured filters and/or free-text. Don't force these into per-drug tools.
- **Geopolitics / macro context** ("how do sanctions affect supply", "what signals do you track for tariff impact") → \`query_intelligence_sources\` to surface what we monitor, then \`web_search\` for current events, then weave in your own analysis.
- **Current external events** (regulatory announcements in the last few days, named manufacturer news, policy moves) → \`web_search\` — but only when our internal data genuinely can't answer. Cite per the source hierarchy below.
- "Why" / "what causes" / "how does X work" / policy / economics → lead with your knowledge; pull data and macro signals when a concrete illustration lands harder than abstract analysis.
- Mixed → do both. The user gains more from \`amoxicillin shortage is driven by [macro reason]; here are the 4 active EU events confirming it; here's what the FDA said last week\` than from either half alone.

## Style

- Lead with the substantive answer. No "let me look that up", no "great question", no preambles.
- **Bold** drug names and critical facts. Bullets for short enumeration; paragraphs for reasoning; headers for multi-section answers.
- **Tables for comparisons.** When listing 3+ items that share the same attributes — drugs with use + current status, countries with shortage counts + severity, suppliers with location + capacity, alternatives with evidence grade + similarity — render a markdown table, like a summary table in a business paper. Lead with one sentence framing the table, then the table itself. Keep to 3–4 columns; put the subject (drug, country, supplier) in the first column and **bold** each subject so the eye lands on it. Don't use a table for a single item, for prose-shaped reasoning, or when the columns would mostly be empty.
- Cite \`source_name\` when reporting a specific live data point (shortage status, recall date, supplier name). For analysis grounded in general industry knowledge, no citation is needed — but make it clear which kind of claim you're making when it matters.
- Typos: "amoxicilin" → search "amoxicillin", "Ausrtalia" → "Australia". Acknowledge once ("Showing **amoxicillin**:"), don't lecture.
- Flag **critical** and **Class I** findings prominently.
- Offer a sharp follow-up suggestion only when there's a genuinely useful next step — not as a reflex.

## Source discipline

Our database is the primary source for live shortage, recall, and resilience facts — cite \`source_name\` from tool results for those. When you reach into general knowledge for context (manufacturer events, policy shifts, clinical impact, market movements), ground claims in this hierarchy:

1. **Regulators** — FDA, EMA, MHRA, TGA, BfArM, ANSM, AIFA, AEMPS, Health Canada, Swissmedic, PMDA, MFDS, NMPA, SFDA, ANVISA, COFEPRIS, SAHPRA, NAFDAC, HSA, Medsafe, BPOM. Primary for shortage status, approvals, safety alerts.
2. **Peer-reviewed journals** — The Lancet, NEJM, JAMA, BMJ, Nature Medicine, CMAJ, MJA, SAMJ, JKMS. For clinical impact and research context.
3. **Specialist pharma/policy outlets** — STAT News, Health Policy Watch, KFF Health News, BMJ News, Health Service Journal, Pink Sheet, Scrip. For supply chain, pricing, and policy analysis (often ahead of regulators).
4. **Investigative outlets** — ProPublica, Bureau of Investigative Journalism, Daily Maverick. For accountability stories on manufacturers and regulators.
5. **National press** when on-the-ground reporting matters — Guardian/BBC (UK), Le Monde (FR), Spiegel (DE), Corriere/Repubblica (IT), The Hindu/Scroll/Wire Science (IN), Asahi/Japan Times (JP), Folha (BR), Kompas/Tempo (ID), Animal Político (MX), Hürriyet (TR), JoongAng (KR), Arab News (SA), Health-e (ZA), Caixin (CN, editorially independent), Meduza (RU, Latvia-based).

**Editorial scrutiny:** state-affiliated outlets (TASS, China Daily) carry the government's position — useful for that, but cross-reference with independent reporting. In countries with limited press freedom (Russia, China, Saudi Arabia), weight independent or exile-based outlets — Meduza, Caixin — more heavily.

**Sourcing rules:**
- Only cite a regulator (FDA, EMA, TGA…) when the matching record is in our tool results. Don't fabricate.
- General industry analysis from your training knowledge needs no citation — but make clear it's analysis, not data.
- If a source is non-English, note the language ("Le Monde, in French").
- Pre-prints are not peer-reviewed — flag them if cited.

## Boundaries

- Not a medical professional — no clinical dosing advice.
- Don't invent specific data: shortage counts, statuses, dates, source names, manufacturer names, and resilience scores must come from tool results. General industry analysis from your training knowledge is in scope and expected.
- If a drug isn't found after typo correction, say so plainly and suggest the generic name.`;
}

/* ── Tool definitions ───────────────────────────────────────── */

// Custom tools have an executor in executeTool() below.
// The web_search server tool (added at the end) is executed by Anthropic; no executor needed.
type ToolDef = Anthropic.Tool | { type: "web_search_20250305"; name: "web_search"; max_uses?: number };

const tools: ToolDef[] = [
  {
    name: "search_drugs",
    description: "Search the drug database by name. Returns matching drugs with active shortage counts. Use this first when the user mentions a specific drug name.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Drug name to search (generic or brand), e.g. 'amoxicillin'" },
        limit: { type: "number", description: "Max results (default 6, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_drug_shortages",
    description: "Get shortage events for a specific drug by drug_id. Can filter by status and country.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug from search results" },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"], description: "Filter by status" },
        country: { type: "string", description: "ISO 2-letter country code to filter by, e.g. 'AU'" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_drug_alternatives",
    description: "Get therapeutic alternatives for a drug. Returns alternatives with similarity scores and clinical evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_drug_recalls",
    description: "Get recall history and resilience score for a drug.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "browse_shortages",
    description: "Browse shortage events across all drugs. Filter by country, status, severity. Use for country-wide or severity-filtered queries.",
    input_schema: {
      type: "object" as const,
      properties: {
        country: { type: "string", description: "ISO 2-letter country code, e.g. 'AU', 'US'" },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        page_size: { type: "number", description: "Results per page (default 20, max 50)" },
      },
    },
  },
  {
    name: "get_shortage_summary",
    description: "Get dashboard summary: total active shortages, by severity, by country, by category, new/resolved this month. Use for overview questions.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "browse_recalls",
    description: "Browse drug recalls. Filter by country, class (I/II/III), status, date range.",
    input_schema: {
      type: "object" as const,
      properties: {
        country: { type: "string", description: "ISO 2-letter country code" },
        recall_class: { type: "string", enum: ["I", "II", "III", "Unclassified"] },
        status: { type: "string", enum: ["active", "completed", "ongoing"] },
        page_size: { type: "number", description: "Results per page (default 20, max 50)" },
      },
    },
  },
  {
    name: "get_shortage_timeline",
    description: "Get a chronological timeline of shortage events for a specific drug. Shows how shortages have evolved over time — new events, resolutions, status changes. Use for questions about history or trends of a specific drug.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug" },
        country: { type: "string", description: "Optional ISO 2-letter country code to filter" },
        months: { type: "number", description: "How many months of history to include (default 24, max 60)" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_shortage_statistics",
    description: "Get aggregate shortage statistics: breakdowns by country, severity, reason category, and monthly trends. Use for analytical questions like 'which country has the most shortages' or 'what are the main causes of shortages'.",
    input_schema: {
      type: "object" as const,
      properties: {
        country: { type: "string", description: "Optional ISO country code to scope stats to one country" },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"], description: "Filter by status (default: active)" },
      },
    },
  },
  {
    name: "get_shortage_forecast",
    description: "Estimate resolution likelihood for active shortages of a drug based on historical resolution patterns, reason category, and severity. Use when users ask 'when will this be resolved' or 'what's the outlook'.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug" },
        country: { type: "string", description: "Optional ISO country code" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_drug_variants",
    description: "List the SKU variants (strength × dosage form combinations) registered for a canonical drug. Use BEFORE answering when the question depends on a specific variant — dosing-specific advice, a recall lookup, a formulation-specific shortage, a clinical use that only applies to one form (e.g. amoxicillin IV vs oral suspension). The same generic may have 5–20 distinct SKUs across countries; aggregating across all of them can mislead. Returns variant groups with brand examples, sponsors, and country coverage. If only 1 variant exists, no disambiguation is needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_id: { type: "string", description: "UUID of the drug" },
        country: { type: "string", description: "Optional ISO 2-letter country code to scope variants to one market" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "query_shortage_events",
    description: "Flexible search across the full 29,000+ event table — use for macro / aggregate / thematic questions NOT anchored to one drug. Examples: 'shortages caused by manufacturing issues in Europe this year', 'regulatory-action shortages in India', 'critical supply-chain disruptions since Jan 2025', 'shortages mentioning API'. Combine free-text search (reason/notes) with structured filters (reason_category, country, severity, status, date window). Returns total match count plus a sample of events.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Optional free-text ILIKE search across event reason and notes (e.g. 'API supply', 'GMP audit', 'tariff', 'capacity', 'tender'). Combine with structured filters for best results." },
        reason_category: { type: "string", enum: ["regulatory_action", "supply_chain", "manufacturing_issue", "discontinuation", "demand_surge", "raw_material", "unknown"], description: "Structured reason category" },
        country: { type: "string", description: "ISO 2-letter country code (e.g. 'AU', 'US', 'DE')" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"], description: "Default: active" },
        since: { type: "string", description: "Only events whose start_date is on/after this YYYY-MM-DD" },
        until: { type: "string", description: "Only events whose start_date is on/before this YYYY-MM-DD" },
        limit: { type: "number", description: "Max sample events to return (default 15, max 30)" },
      },
    },
  },
  {
    name: "query_intelligence_sources",
    description: "Search our catalog of 124 external macro signals — trade flows, procurement portals, sanctions trackers, epidemic data, logistics indicators, corporate disclosures, pricing references. Use when the question is macro / geopolitical / economic and the user is asking what signals Mederti monitors beyond shortage events themselves. Returns catalog entries (name, category, what they cover) — these are pointers to data sources, not the data itself.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string", enum: ["availability_ground_truth", "logistics", "procurement", "macro", "external_shocks", "reference_data", "pricing", "pipeline", "data_portals_and_discovery", "sanctions", "trade", "utilization", "corporate_disclosure", "public_health", "funding_and_aid_flows", "early_warning"] },
        text: { type: "string", description: "Optional free-text ILIKE search across source name, notes, subcategory" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Daily-monitoring priority" },
        limit: { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
  // Server tool — Anthropic executes the search and returns results as a tool result block.
  // No executor case needed. Use sparingly: each call has a per-search cost.
  { type: "web_search_20250305", name: "web_search", max_uses: 4 },
];

/* ── Tool executors ─────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool(name: string, input: Record<string, any>): Promise<any> {
  const db = getSupabaseAdmin();

  switch (name) {
    case "search_drugs": {
      const q = (input.query as string).trim();
      const limit = Math.min(input.limit ?? 6, 20);

      // FTS → ilike → trigram similarity (handles typos)
      let rows: Record<string, unknown>[] = [];
      try {
        const r = await db.from("drugs").select("id, generic_name, brand_names, atc_code")
          .textSearch("search_vector", q, { config: "english" }).limit(limit);
        rows = (r.data ?? []) as Record<string, unknown>[];
      } catch { /* fallback */ }

      if (rows.length === 0) {
        const r = await db.from("drugs").select("id, generic_name, brand_names, atc_code")
          .ilike("generic_name", `%${q}%`).limit(limit);
        rows = (r.data ?? []) as Record<string, unknown>[];
      }

      // Trigram similarity fallback for typos (e.g. "amoxicilin", "metformn")
      if (rows.length === 0 && q.length >= 4) {
        try {
          const r = await db.rpc("search_drugs_fuzzy", { search_term: q, result_limit: limit });
          rows = (r.data ?? []) as Record<string, unknown>[];
        } catch {
          // Trigram function may not exist yet — try ilike with first few chars
          const prefix = q.slice(0, Math.max(4, Math.floor(q.length * 0.7)));
          const r = await db.from("drugs").select("id, generic_name, brand_names, atc_code")
            .ilike("generic_name", `${prefix}%`).limit(limit);
          rows = (r.data ?? []) as Record<string, unknown>[];
        }
      }

      if (rows.length === 0) return { query: q, results: [], total: 0 };

      // Shortage counts
      const ids = rows.map((r) => r.id as string);
      const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
      try {
        const sc = await db.from("shortage_events").select("drug_id")
          .in("drug_id", ids).in("status", ["active", "anticipated"]);
        for (const row of sc.data ?? []) counts[row.drug_id] = (counts[row.drug_id] ?? 0) + 1;
      } catch { /* counts stay 0 */ }

      // Variant signal: count distinct (strength, dosage_form) SKUs per drug
      // in drug_catalogue. Gives Claude a "this drug has 7 variants — consider
      // asking which one" hint without a second tool call.
      const variantCounts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
      const sampleVariants: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
      try {
        const vc = await db.from("drug_catalogue")
          .select("drug_id, strength, dosage_form")
          .in("drug_id", ids).limit(2000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buckets: Record<string, Set<string>> = {};
        for (const row of (vc.data ?? []) as any[]) {
          if (!row.drug_id) continue;
          const key = `${(row.strength ?? "").trim()}|${(row.dosage_form ?? "").trim()}`;
          if (!buckets[row.drug_id]) buckets[row.drug_id] = new Set();
          buckets[row.drug_id].add(key);
        }
        for (const id of ids) {
          const set = buckets[id] ?? new Set();
          variantCounts[id] = set.size;
          sampleVariants[id] = Array.from(set)
            .filter((k) => k !== "|")
            .slice(0, 3)
            .map((k) => {
              const [s, f] = k.split("|");
              return [s, f].filter(Boolean).join(" ");
            })
            .filter(Boolean);
        }
      } catch { /* variant info stays empty — non-fatal */ }

      const results = rows.map((r) => ({
        drug_id: r.id, generic_name: r.generic_name,
        brand_names: r.brand_names ?? [], atc_code: r.atc_code ?? null,
        active_shortage_count: counts[r.id as string] ?? 0,
        variant_count: variantCounts[r.id as string] ?? 0,
        sample_variants: sampleVariants[r.id as string] ?? [],
      }));
      return { query: q, results, total: results.length };
    }

    case "get_drug_shortages": {
      let query = db.from("shortage_events")
        .select("shortage_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, data_sources(name)")
        .eq("drug_id", input.drug_id)
        .order("start_date", { ascending: false })
        .limit(30);
      if (input.status) query = query.eq("status", input.status);
      if (input.country) query = query.eq("country_code", input.country.toUpperCase());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await query;
      return ((data ?? []) as any[]).map((r) => ({
        shortage_id: r.shortage_id, country: r.country ?? "", country_code: r.country_code ?? "",
        status: r.status, severity: r.severity, reason: r.reason, reason_category: r.reason_category,
        start_date: r.start_date, end_date: r.end_date,
        estimated_resolution_date: r.estimated_resolution_date,
        source_name: (r.data_sources ?? {}).name ?? null, source_url: r.source_url,
        last_verified_at: r.last_verified_at,
      }));
    }

    case "get_drug_alternatives": {
      const { data } = await db.from("drug_alternatives")
        .select("alternative_drug_id, relationship_type, clinical_evidence_level, similarity_score, dose_conversion_notes, availability_note, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)")
        .eq("drug_id", input.drug_id).eq("is_approved", true)
        .order("similarity_score", { ascending: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        alternative_drug_id: r.alternative_drug_id,
        alternative_generic_name: (r.drugs ?? {}).generic_name ?? "",
        alternative_brand_names: (r.drugs ?? {}).brand_names ?? [],
        relationship_type: r.relationship_type ?? "",
        clinical_evidence_level: r.clinical_evidence_level,
        similarity_score: r.similarity_score,
        dose_conversion_notes: r.dose_conversion_notes,
        availability_note: r.availability_note,
      }));
    }

    case "get_drug_recalls": {
      const { data: rows } = await db.from("recalls")
        .select("id, recall_id, country_code, recall_class, generic_name, brand_name, manufacturer, announced_date, status, reason_category, press_release_url")
        .eq("drug_id", input.drug_id).order("announced_date", { ascending: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recallRows = (rows ?? []) as any[];
      const recallIds = recallRows.map((r) => r.id as string);
      const linkCounts: Record<string, number> = Object.fromEntries(recallIds.map((id) => [id, 0]));
      if (recallIds.length > 0) {
        const { data: links } = await db.from("recall_shortage_links").select("recall_id").in("recall_id", recallIds);
        for (const l of links ?? []) linkCounts[l.recall_id] = (linkCounts[l.recall_id] ?? 0) + 1;
      }
      const today = new Date();
      let score = 100;
      for (const r of recallRows) {
        const d = new Date(r.announced_date);
        if (isNaN(d.getTime())) continue;
        const months = (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
        if (months <= 12) score -= 5;
        if (r.recall_class === "I" && months <= 24) { score -= 15; if ((linkCounts[r.id] ?? 0) > 0) score -= 20; }
      }
      score = Math.max(0, Math.min(100, score));
      return {
        drug_id: input.drug_id, resilience_score: score,
        recalls: recallRows.map((r) => ({
          id: r.id, recall_id: r.recall_id, country_code: r.country_code,
          recall_class: r.recall_class, generic_name: r.generic_name,
          brand_name: r.brand_name, manufacturer: r.manufacturer,
          announced_date: String(r.announced_date), status: r.status,
          reason_category: r.reason_category, press_release_url: r.press_release_url,
          linked_shortages: linkCounts[r.id] ?? 0,
        })),
      };
    }

    case "browse_shortages": {
      const pageSize = Math.min(input.page_size ?? 20, 50);
      let query = db.from("shortage_events")
        .select("shortage_id, drug_id, country, country_code, status, severity, reason_category, start_date, estimated_resolution_date, source_url, drugs(generic_name, brand_names), data_sources(name)", { count: "exact" })
        .order("start_date", { ascending: false }).range(0, pageSize - 1);
      if (input.country) query = query.eq("country_code", input.country.toUpperCase());
      if (input.status) query = query.eq("status", input.status);
      if (input.severity) query = query.eq("severity", input.severity);
      const { data: rows, count } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { total: count ?? 0, results: ((rows ?? []) as any[]).map((r) => ({
        shortage_id: r.shortage_id, drug_id: r.drug_id,
        generic_name: (r.drugs ?? {}).generic_name ?? "", brand_names: (r.drugs ?? {}).brand_names ?? [],
        country: r.country ?? "", country_code: r.country_code ?? "",
        status: r.status, severity: r.severity, reason_category: r.reason_category,
        start_date: r.start_date, estimated_resolution_date: r.estimated_resolution_date,
        source_name: (r.data_sources ?? {}).name ?? null, source_url: r.source_url,
      })) };
    }

    case "get_shortage_summary": {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const BATCH = 1000;
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      while (true) {
        const { data } = await db.from("shortage_events")
          .select("severity, reason_category, country_code, country")
          .in("status", ["active", "anticipated"]).range(offset, offset + BATCH - 1);
        const batch = (data ?? []) as Record<string, unknown>[];
        allRows.push(...batch);
        if (batch.length < BATCH) break;
        offset += BATCH;
      }
      const bySev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      const byCountry: Record<string, number> = {};
      for (const r of allRows) {
        const s = ((r.severity as string) ?? "low").toLowerCase();
        if (s in bySev) bySev[s]++;
        const cc = (r.country_code as string) ?? "XX";
        byCountry[cc] = (byCountry[cc] ?? 0) + 1;
      }
      const { count: newThisMonth } = await db.from("shortage_events").select("id", { count: "exact", head: true })
        .in("status", ["active", "anticipated"]).gte("created_at", cutoff);
      const { count: resolvedThisMonth } = await db.from("shortage_events").select("id", { count: "exact", head: true })
        .eq("status", "resolved").gte("last_verified_at", cutoff);
      return {
        total_active: allRows.length, by_severity: bySev,
        by_country: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([cc, count]) => ({ country_code: cc, count })),
        new_this_month: newThisMonth ?? 0, resolved_this_month: resolvedThisMonth ?? 0,
      };
    }

    case "browse_recalls": {
      const pageSize = Math.min(input.page_size ?? 20, 50);
      let query = db.from("recalls")
        .select("id, recall_id, drug_id, generic_name, brand_name, manufacturer, country_code, recall_class, reason, reason_category, announced_date, status, press_release_url, data_sources!recalls_source_id_fkey(name)", { count: "exact" })
        .order("announced_date", { ascending: false }).range(0, pageSize - 1);
      if (input.country) query = query.eq("country_code", input.country.toUpperCase());
      if (input.recall_class) query = query.eq("recall_class", input.recall_class);
      if (input.status) query = query.eq("status", input.status);
      const { data: rows, count } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { total: count ?? 0, results: ((rows ?? []) as any[]).map((r) => ({
        id: r.id, recall_id: r.recall_id, generic_name: r.generic_name,
        brand_name: r.brand_name, manufacturer: r.manufacturer,
        country_code: r.country_code, recall_class: r.recall_class,
        reason: r.reason, reason_category: r.reason_category,
        announced_date: String(r.announced_date), status: r.status,
        source_name: (r.data_sources ?? {}).name ?? null,
      })) };
    }

    case "get_shortage_timeline": {
      const months = Math.min(input.months ?? 24, 60);
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      let query = db.from("shortage_events")
        .select("shortage_id, country_code, status, severity, reason_category, start_date, end_date, estimated_resolution_date, last_verified_at, data_sources(name)")
        .eq("drug_id", input.drug_id)
        .gte("start_date", cutoff.toISOString().slice(0, 10))
        .order("start_date", { ascending: true })
        .limit(100);
      if (input.country) query = query.eq("country_code", input.country.toUpperCase());
      const { data } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];

      // Build monthly buckets
      const buckets: Record<string, { new: number; resolved: number; active: number }> = {};
      for (const r of rows) {
        const m = (r.start_date as string).slice(0, 7); // YYYY-MM
        if (!buckets[m]) buckets[m] = { new: 0, resolved: 0, active: 0 };
        buckets[m].new++;
        if (r.status === "resolved") buckets[m].resolved++;
        else buckets[m].active++;
      }

      return {
        drug_id: input.drug_id,
        period: `${months} months`,
        total_events: rows.length,
        active: rows.filter(r => r.status === "active" || r.status === "anticipated").length,
        resolved: rows.filter(r => r.status === "resolved").length,
        monthly_trend: Object.entries(buckets)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, data]) => ({ month, ...data })),
        events: rows.map(r => ({
          shortage_id: r.shortage_id, country_code: r.country_code,
          status: r.status, severity: r.severity, reason_category: r.reason_category,
          start_date: r.start_date, end_date: r.end_date,
          estimated_resolution_date: r.estimated_resolution_date,
          source_name: (r.data_sources ?? {}).name ?? null,
        })),
      };
    }

    case "get_shortage_statistics": {
      const statusFilter = input.status ?? "active";
      const BATCH = 1000;
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      while (true) {
        let query = db.from("shortage_events")
          .select("severity, reason_category, country_code, country, start_date")
          .eq("status", statusFilter)
          .range(offset, offset + BATCH - 1);
        if (input.country) query = query.eq("country_code", input.country.toUpperCase());
        const { data } = await query;
        const batch = (data ?? []) as Record<string, unknown>[];
        allRows.push(...batch);
        if (batch.length < BATCH) break;
        offset += BATCH;
      }

      const bySev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      const byReason: Record<string, number> = {};
      const byCountry: Record<string, number> = {};
      const byMonth: Record<string, number> = {};
      for (const r of allRows) {
        const s = ((r.severity as string) ?? "low").toLowerCase();
        if (s in bySev) bySev[s]++;
        const rc = (r.reason_category as string) ?? "unknown";
        byReason[rc] = (byReason[rc] ?? 0) + 1;
        const cc = (r.country_code as string) ?? "XX";
        byCountry[cc] = (byCountry[cc] ?? 0) + 1;
        const sd = r.start_date as string;
        if (sd) {
          const m = sd.slice(0, 7);
          byMonth[m] = (byMonth[m] ?? 0) + 1;
        }
      }

      return {
        status_filter: statusFilter,
        country_filter: input.country ?? "all",
        total: allRows.length,
        by_severity: bySev,
        by_reason: Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
        by_country: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([country_code, count]) => ({ country_code, count })),
        monthly_trend: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, count]) => ({ month, count })),
      };
    }

    case "get_shortage_forecast": {
      // Get active shortages for this drug
      let activeQuery = db.from("shortage_events")
        .select("shortage_id, country_code, status, severity, reason_category, start_date, estimated_resolution_date, data_sources(name)")
        .eq("drug_id", input.drug_id)
        .in("status", ["active", "anticipated"])
        .order("start_date", { ascending: false });
      if (input.country) activeQuery = activeQuery.eq("country_code", input.country.toUpperCase());
      const { data: activeShortages } = await activeQuery;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const active = (activeShortages ?? []) as any[];

      // Get resolved shortages for this drug to compute avg resolution time
      const { data: resolvedData } = await db.from("shortage_events")
        .select("start_date, end_date, severity, reason_category")
        .eq("drug_id", input.drug_id)
        .eq("status", "resolved")
        .not("end_date", "is", null)
        .order("end_date", { ascending: false })
        .limit(50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (resolvedData ?? []) as any[];

      // Compute average resolution time in days
      let avgDays = 0;
      let resolvedCount = 0;
      for (const r of resolved) {
        const s = new Date(r.start_date);
        const e = new Date(r.end_date);
        if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
          avgDays += (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24);
          resolvedCount++;
        }
      }
      avgDays = resolvedCount > 0 ? Math.round(avgDays / resolvedCount) : 0;

      // Resolution estimates per active shortage
      const forecasts = active.map(s => {
        const startDate = new Date(s.start_date);
        const daysSinceStart = Math.round((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const estDays = s.estimated_resolution_date
          ? Math.round((new Date(s.estimated_resolution_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : avgDays > 0 ? Math.max(0, avgDays - daysSinceStart) : null;

        return {
          shortage_id: s.shortage_id,
          country_code: s.country_code,
          severity: s.severity,
          reason_category: s.reason_category,
          start_date: s.start_date,
          days_active: daysSinceStart,
          estimated_resolution_date: s.estimated_resolution_date,
          estimated_days_remaining: estDays,
          source_name: (s.data_sources ?? {}).name ?? null,
        };
      });

      return {
        drug_id: input.drug_id,
        active_shortages: active.length,
        historical_avg_resolution_days: avgDays,
        historical_resolved_count: resolvedCount,
        forecasts,
      };
    }

    case "get_drug_variants": {
      // Follow drug_synonyms so paracetamol↔acetaminophen variants are unified.
      const synRes = await db.from("drug_synonyms").select("synonym_normalised").eq("drug_id", input.drug_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synonyms = ((synRes.data ?? []) as any[]).map((s) => s.synonym_normalised).filter(Boolean);

      let query = db.from("drug_catalogue")
        .select("source_country, brand_name, sponsor, strength, dosage_form, registration_status, registration_number, source_name")
        .limit(2000);

      if (synonyms.length > 0) {
        const orFilter = [
          `drug_id.eq.${input.drug_id}`,
          `generic_normalised.in.(${synonyms.map((s: string) => `"${s}"`).join(",")})`,
        ].join(",");
        query = query.or(orFilter);
      } else {
        query = query.eq("drug_id", input.drug_id);
      }

      if (input.country) query = query.eq("source_country", String(input.country).toUpperCase());

      const { data } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];

      if (rows.length === 0) {
        return {
          drug_id: input.drug_id,
          country_filter: input.country ?? null,
          total_variants: 0,
          total_products: 0,
          variants: [],
          note: "No catalogue entries found. Catalogue coverage is currently AU / GB / US / CA / EU; other countries may register the drug without appearing here.",
        };
      }

      type VariantBucket = {
        strength: string | null;
        dosage_form: string | null;
        product_count: number;
        active_count: number;
        countries: Set<string>;
        brands: Map<string, number>;
        sponsors: Map<string, number>;
      };
      const buckets: Map<string, VariantBucket> = new Map();

      for (const r of rows) {
        const strength = (r.strength ?? "").trim() || null;
        const form = (r.dosage_form ?? "").trim() || null;
        const key = `${strength ?? "?"}|${form ?? "?"}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            strength, dosage_form: form,
            product_count: 0, active_count: 0,
            countries: new Set(), brands: new Map(), sponsors: new Map(),
          });
        }
        const b = buckets.get(key)!;
        b.product_count++;
        if (((r.registration_status ?? "") as string).toLowerCase() === "active") b.active_count++;
        if (r.source_country) b.countries.add(String(r.source_country).toUpperCase());
        if (r.brand_name) {
          const k = String(r.brand_name).trim();
          if (k) b.brands.set(k, (b.brands.get(k) ?? 0) + 1);
        }
        if (r.sponsor) {
          const k = String(r.sponsor).trim();
          if (k) b.sponsors.set(k, (b.sponsors.get(k) ?? 0) + 1);
        }
      }

      const variants = Array.from(buckets.values())
        .map((b) => ({
          strength: b.strength,
          dosage_form: b.dosage_form,
          product_count: b.product_count,
          active_count: b.active_count,
          countries: Array.from(b.countries).sort(),
          top_brands: Array.from(b.brands.entries()).sort((a, b2) => b2[1] - a[1]).slice(0, 5).map(([name]) => name),
          top_sponsors: Array.from(b.sponsors.entries()).sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([name]) => name),
        }))
        .sort((a, b) => b.product_count - a.product_count);

      return {
        drug_id: input.drug_id,
        country_filter: input.country ?? null,
        total_variants: variants.length,
        total_products: rows.length,
        variants,
      };
    }

    case "query_shortage_events": {
      const limit = Math.min(input.limit ?? 15, 30);
      const status = input.status ?? "active";

      const baseFilters = (q: ReturnType<typeof db.from> extends infer T ? T : never) => q;
      void baseFilters;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyFilters = (q: any) => {
        q = q.eq("status", status);
        if (input.reason_category) q = q.eq("reason_category", input.reason_category);
        if (input.country) q = q.eq("country_code", String(input.country).toUpperCase());
        if (input.severity) q = q.eq("severity", input.severity);
        if (input.since) q = q.gte("start_date", input.since);
        if (input.until) q = q.lte("start_date", input.until);
        if (input.text) {
          const pattern = `%${String(input.text).replace(/[%,]/g, "")}%`;
          q = q.or(`reason.ilike.${pattern},notes.ilike.${pattern}`);
        }
        return q;
      };

      const countQ = applyFilters(db.from("shortage_events").select("id", { count: "exact", head: true }));
      const listQ = applyFilters(
        db.from("shortage_events")
          .select("shortage_id, drug_id, country_code, country, status, severity, reason, reason_category, start_date, estimated_resolution_date, source_url, drugs(generic_name, brand_names), data_sources(name)")
          .order("start_date", { ascending: false })
          .range(0, limit - 1)
      );

      const [{ count }, { data: rows }] = await Promise.all([countQ, listQ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = ((rows ?? []) as any[]).map((r) => ({
        shortage_id: r.shortage_id, drug_id: r.drug_id,
        generic_name: (r.drugs ?? {}).generic_name ?? null,
        brand_names: (r.drugs ?? {}).brand_names ?? null,
        country: r.country, country_code: r.country_code,
        status: r.status, severity: r.severity,
        reason_category: r.reason_category,
        reason_excerpt: typeof r.reason === "string" ? r.reason.slice(0, 240) : null,
        start_date: r.start_date,
        estimated_resolution_date: r.estimated_resolution_date,
        source_name: (r.data_sources ?? {}).name ?? null,
        source_url: r.source_url,
      }));

      return {
        total_matched: count ?? 0,
        returned: events.length,
        filters: {
          text: input.text ?? null,
          reason_category: input.reason_category ?? null,
          country: input.country ?? null,
          severity: input.severity ?? null,
          status,
          since: input.since ?? null,
          until: input.until ?? null,
        },
        events,
      };
    }

    case "query_intelligence_sources": {
      const limit = Math.min(input.limit ?? 10, 30);
      let q = db.from("intelligence_sources")
        .select("source_id, name, owner_org, category, subcategory, geography_coverage, update_frequency_expected, priority_for_daily_monitoring, notes", { count: "exact" })
        .limit(limit);
      if (input.category) q = q.eq("category", input.category);
      if (input.priority) q = q.eq("priority_for_daily_monitoring", input.priority);
      if (input.text) {
        const pattern = `%${String(input.text).replace(/[%,]/g, "")}%`;
        q = q.or(`name.ilike.${pattern},notes.ilike.${pattern},subcategory.ilike.${pattern}`);
      }
      const { data, count } = await q;
      return {
        total_matched: count ?? 0,
        returned: (data ?? []).length,
        sources: data ?? [],
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/* ── Conversational fallback (no API key) ──────────────────── */

const COUNTRY_MAP: Record<string, string> = {
  australia: "AU", "united states": "US", "united kingdom": "GB", canada: "CA",
  "new zealand": "NZ", singapore: "SG", germany: "DE", france: "FR",
  italy: "IT", spain: "ES", switzerland: "CH", norway: "NO", finland: "FI",
  ireland: "IE", sweden: "SE", netherlands: "NL", japan: "JP", india: "IN",
  brazil: "BR", "south africa": "ZA",
};
const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", US: "the United States", GB: "the United Kingdom", CA: "Canada",
  NZ: "New Zealand", SG: "Singapore", DE: "Germany", FR: "France",
  IT: "Italy", ES: "Spain", CH: "Switzerland", NO: "Norway", FI: "Finland",
  IE: "Ireland", SE: "Sweden", NL: "the Netherlands", JP: "Japan", IN: "India",
  BR: "Brazil", ZA: "South Africa", EU: "the European Union",
};
// Levenshtein distance for fuzzy country matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// Match full country names first (exact), then fuzzy, then ISO codes
function extractCountry(query: string): string | null {
  // 1. Exact match on full country names (case-insensitive)
  const nameRe = new RegExp(`\\b(${Object.keys(COUNTRY_MAP).join("|")})\\b`, "i");
  const nameMatch = query.match(nameRe);
  if (nameMatch) return COUNTRY_MAP[nameMatch[0].toLowerCase()] ?? null;

  // 2. Fuzzy match — check each word (and bigrams) against country names
  const words = query.toLowerCase().split(/\s+/);
  const countryNames = Object.keys(COUNTRY_MAP);
  let bestMatch: string | null = null;
  let bestDist = Infinity;

  // Check single words and consecutive pairs (for "united states", "new zealand", etc.)
  const candidates = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    candidates.push(`${words[i]} ${words[i + 1]}`);
  }

  for (const candidate of candidates) {
    if (candidate.length < 4) continue; // Skip short words to avoid false positives
    for (const name of countryNames) {
      const dist = levenshtein(candidate, name);
      // Allow up to 2 edits, but candidate must be at least 60% of the country name length
      const maxDist = name.length <= 5 ? 1 : 2;
      if (dist <= maxDist && dist < bestDist) {
        bestDist = dist;
        bestMatch = name;
      }
    }
  }
  if (bestMatch) return COUNTRY_MAP[bestMatch] ?? null;

  // 3. ISO codes (uppercase only to avoid matching "in", "no", etc.)
  const isoMatch = query.match(/\b(AU|US|GB|CA|NZ|SG|DE|FR|IT|ES|CH|NO|FI|IE|SE|NL|JP|IN|BR|ZA|EU)\b/);
  if (isoMatch) return isoMatch[0];
  return null;
}
const NL_NOISE = /\b(shortage|shortages|supply|status|alternative|alternatives|to|in|for|of|the|this|month|what|is|are|drug|drugs|critical|current|about|available|availability|show|me|get|find|list|check|any|can|you|tell|give|have|has|there|been|been|how|which|where|when|most|right|now|today|recently|australia|united states|united kingdom|new zealand|south africa|us|uk|canada|germany|france|italy|spain|switzerland|norway|finland|ireland|sweden|netherlands|japan|india|brazil|singapore|au|gb|ca|de|fr|nz|sg|it|es|ch|no|fi|ie|se|nl|jp|br|za)\b/gi;

function extractDrugName(query: string): string {
  return query
    .replace(NL_NOISE, "")
    .replace(/[?.!,;:'"()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


type Intent = "summary" | "alternatives" | "recalls" | "shortage_country" | "drug_search" | "greeting" | "help";

function classifyIntent(query: string): Intent {
  const q = query.toLowerCase();
  if (/^(hi|hello|hey|good morning|good afternoon)\b/.test(q)) return "greeting";
  if (/\b(how|help|what can you|what do you)\b/.test(q) && !/\b(how many|how is|how are)\b/.test(q)) return "help";
  if (/\b(summary|overview|how many|total|dashboard|statistics|stats|situation|global.*shortage|shortages this month|critical.*shortages|shortages.*critical)\b/.test(q)) return "summary";
  if (/\b(alternative|alternatives|substitute|replace|instead|switch)\b/.test(q)) return "alternatives";
  if (/\b(recall|recalls|recalled|safety|withdrawn)\b/.test(q)) return "recalls";
  if (extractCountry(q) && !/\b(alternative|alternatives)\b/.test(q)) return "shortage_country";
  return "drug_search";
}

// Find drug context from previous messages
function findDrugContext(messages: Array<{ role: string; content: string }>): string | null {
  for (let i = messages.length - 2; i >= 0; i--) {
    const text = messages[i].content;
    const drugMatch = text.match(/\b(amoxicillin|metformin|cisplatin|paracetamol|ibuprofen|atorvastatin|lisinopril|omeprazole|amlodipine|simvastatin|levothyroxine|azithromycin|flucloxacillin|ciprofloxacin|lithium|doxycycline|prednisone|gabapentin|sertraline|clopidogrel|warfarin|diazepam|morphine|fentanyl|oxycodone|insulin|epinephrine|salbutamol|fluticasone|cetirizine)\b/i);
    if (drugMatch) return drugMatch[0];
  }
  return null;
}

function emit(controller: ReadableStreamDefaultController, encoder: TextEncoder, type: string, data: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(type === "text" ? { type, content: data } : { type, data })}\n\n`));
}

async function conversationalFallback(
  messages: Array<{ role: string; content: string }>,
  userCountry: string = "AU",
): Promise<Response> {
  const query = messages.filter((m) => m.role === "user").pop()?.content ?? "";
  const intent = classifyIntent(query);
  const explicitCountry = extractCountry(query);
  // Use explicit country from query if mentioned, otherwise fall back to user's home country
  const cc = explicitCountry ?? userCountry;
  const countryName = cc ? (COUNTRY_NAMES[cc] ?? cc) : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        switch (intent) {
          case "greeting": {
            emit(controller, encoder, "text",
              "Hello! I'm Mederti, your pharmaceutical shortage intelligence assistant. I can help you:\n\n" +
              "- Search for any drug and check its shortage status\n" +
              "- Find therapeutic alternatives when a drug is in short supply\n" +
              "- Browse shortages by country or severity\n" +
              "- Get a global shortage summary\n\n" +
              "Try asking something like \"Is amoxicillin available in Australia?\" or \"What are the alternatives to metformin?\""
            );
            break;
          }

          case "help": {
            emit(controller, encoder, "text",
              "Here's what I can help with:\n\n" +
              "**Drug search** — \"amoxicillin\", \"cisplatin supply status\"\n" +
              "**Country shortages** — \"shortages in Australia\", \"drug shortages in the US\"\n" +
              "**Alternatives** — \"alternatives to metformin\", \"what can I use instead of amoxicillin\"\n" +
              "**Recalls** — \"recalls for cisplatin\", \"drug recalls in the US\"\n" +
              "**Overview** — \"how many shortages are there\", \"global shortage summary\"\n\n" +
              "You can also ask follow-up questions — I'll remember which drug we were discussing."
            );
            break;
          }

          case "summary": {
            const summary = await executeTool("get_shortage_summary", {});
            emit(controller, encoder, "summary", summary);

            const topCountries = summary.by_country.slice(0, 5)
              .map((c: { country_code: string; count: number }) => `${COUNTRY_NAMES[c.country_code] ?? c.country_code} (${c.count.toLocaleString()})`)
              .join(", ");

            emit(controller, encoder, "text",
              `Here's the current global shortage picture.\n\n` +
              `There are **${summary.total_active.toLocaleString()} active shortage events** across our database, ` +
              `including **${summary.by_severity.critical ?? 0} critical** and **${summary.by_severity.high ?? 0} high severity** cases.\n\n` +
              `The most affected countries are ${topCountries}.\n\n` +
              `In the last 30 days, **${summary.new_this_month.toLocaleString()} new shortages** were reported and **${summary.resolved_this_month.toLocaleString()} were resolved**.` +
              (cc ? `\n\nWould you like me to drill down into ${countryName} specifically?` : `\n\nWould you like to explore a specific country or drug?`)
            );
            break;
          }

          case "alternatives": {
            const drugName = extractDrugName(query) || findDrugContext(messages);
            if (!drugName) {
              emit(controller, encoder, "text",
                "Which drug would you like to find alternatives for? Please mention the generic name, like \"alternatives to amoxicillin\"."
              );
              break;
            }

            const searchResult = await executeTool("search_drugs", { query: drugName, limit: 1 });
            if (searchResult.results.length === 0) {
              emit(controller, encoder, "text",
                `I couldn't find "${drugName}" in our database. Could you check the spelling? Try using the generic name rather than a brand name.`
              );
              break;
            }

            const drug = searchResult.results[0];
            const alts = await executeTool("get_drug_alternatives", { drug_id: drug.drug_id });

            emit(controller, encoder, "drugs", [drug]);

            if (Array.isArray(alts) && alts.length > 0) {
              // Search for the alternative drugs to show as cards
              const altDrugIds = alts.slice(0, 4).map((a: { alternative_drug_id: string }) => a.alternative_drug_id);
              const altCards = [];
              for (const altId of altDrugIds) {
                const d = await executeTool("search_drugs", { query: alts.find((a: { alternative_drug_id: string }) => a.alternative_drug_id === altId)?.alternative_generic_name ?? "", limit: 1 });
                if (d.results.length > 0) altCards.push(d.results[0]);
              }
              if (altCards.length > 0) emit(controller, encoder, "drugs", altCards);

              const altList = alts.slice(0, 5).map((a: { alternative_generic_name: string; relationship_type: string; similarity_score: number }) =>
                `- **${a.alternative_generic_name}** (${a.relationship_type}, ${Math.round(a.similarity_score * 100)}% similarity)`
              ).join("\n");

              emit(controller, encoder, "text",
                `Here are the therapeutic alternatives for **${drug.generic_name}**:\n\n${altList}\n\n` +
                `These alternatives are based on clinical evidence and therapeutic similarity. ` +
                `Always consult a healthcare professional before switching medications.`
              );
            } else {
              emit(controller, encoder, "text",
                `I found **${drug.generic_name}** in our database, but we don't have therapeutic alternatives on file for this drug yet. ` +
                `You may want to consult a pharmacist or clinical reference for substitution options.`
              );
            }
            break;
          }

          case "recalls": {
            const drugName = extractDrugName(query) || findDrugContext(messages);
            if (drugName) {
              const searchResult = await executeTool("search_drugs", { query: drugName, limit: 1 });
              if (searchResult.results.length > 0) {
                const drug = searchResult.results[0];
                const recallData = await executeTool("get_drug_recalls", { drug_id: drug.drug_id });
                emit(controller, encoder, "drugs", [drug]);

                if (recallData.recalls?.length > 0) {
                  const recent = recallData.recalls.slice(0, 5);
                  const recallList = recent.map((r: { recall_class: string; country_code: string; announced_date: string; reason_category: string }) =>
                    `- **Class ${r.recall_class}** (${r.country_code}) — ${r.announced_date} — ${r.reason_category ?? "unspecified reason"}`
                  ).join("\n");

                  emit(controller, encoder, "text",
                    `**${drug.generic_name}** has **${recallData.recalls.length} recall${recallData.recalls.length !== 1 ? "s" : ""}** on record, ` +
                    `with a supply resilience score of **${recallData.resilience_score}/100**.\n\n` +
                    `Recent recalls:\n${recallList}` +
                    (recallData.resilience_score < 50 ? `\n\n⚠️ The low resilience score suggests this drug has significant supply chain risk.` : "")
                  );
                } else {
                  emit(controller, encoder, "text",
                    `Good news — **${drug.generic_name}** has no recalls on record. Its supply resilience score is **${recallData.resilience_score}/100**.`
                  );
                }
                break;
              }
            }

            // No specific drug — browse recalls by country
            const recalls = await executeTool("browse_recalls", { country: cc ?? undefined, page_size: 10 });
            if (recalls.results?.length > 0) {
              emit(controller, encoder, "text",
                `There are **${recalls.total.toLocaleString()} recalls**${countryName ? ` in ${countryName}` : " globally"} in our database.\n\n` +
                `The most recent involve: ${recalls.results.slice(0, 5).map((r: { generic_name: string; recall_class: string }) => `${r.generic_name} (Class ${r.recall_class})`).join(", ")}.\n\n` +
                `Would you like to look up recalls for a specific drug?`
              );
            } else {
              emit(controller, encoder, "text", "I couldn't find any matching recalls. Try specifying a drug name or country.");
            }
            break;
          }

          case "shortage_country": {
            const drugName = extractDrugName(query);
            if (drugName) {
              // Drug + country query
              const searchResult = await executeTool("search_drugs", { query: drugName, limit: 6 });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const exactHits = (searchResult.results as any[]).filter(
                (r) => String(r.generic_name).toLowerCase() === drugName.toLowerCase()
              );
              if (searchResult.results.length > 1 && exactHits.length !== 1) {
                emit(controller, encoder, "drugs", searchResult.results);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const names = (searchResult.results as any[]).slice(0, 6).map((r) => `**${r.generic_name}**`).join(", ");
                emit(controller, encoder, "text",
                  `I found ${searchResult.results.length} drugs matching "${drugName}" — ${names}. ` +
                  `Which one are you asking about in ${countryName}? Click one above or reply with the full name.`
                );
                break;
              }
              if (searchResult.results.length > 0) {
                const drug = exactHits[0] ?? searchResult.results[0];
                emit(controller, encoder, "drugs", searchResult.results);
                // If the chosen drug has multiple SKU variants, surface the choice
                if ((drug.variant_count ?? 0) >= 2) {
                  const sample = (drug.sample_variants ?? []).slice(0, 3).filter(Boolean);
                  if (sample.length > 0) {
                    emit(controller, encoder, "text",
                      `Note: **${drug.generic_name}** has **${drug.variant_count} SKU variants** in our catalogue ` +
                      `(e.g. ${sample.join("; ")}). The figures below aggregate across all of them — ` +
                      `tell me a specific strength or formulation if you need to narrow down.`
                    );
                  }
                }

                const shortages = await executeTool("get_drug_shortages", { drug_id: drug.drug_id, country: cc! });
                if (Array.isArray(shortages) && shortages.length > 0) {
                  emit(controller, encoder, "shortages", shortages.slice(0, 10));

                  const activeCount = shortages.filter((s: { status: string }) => s.status === "active").length;
                  const criticalCount = shortages.filter((s: { severity: string }) => s.severity === "critical").length;

                  emit(controller, encoder, "text",
                    `**${drug.generic_name}** has **${shortages.length} shortage event${shortages.length !== 1 ? "s" : ""}** in ${countryName}` +
                    (activeCount > 0 ? `, of which **${activeCount} ${activeCount === 1 ? "is" : "are"} currently active**` : ", none currently active") +
                    (criticalCount > 0 ? ` (including **${criticalCount} critical**)` : "") +
                    ".\n\n" +
                    (shortages[0]?.reason_category ? `The primary reason is **${shortages[0].reason_category.replace(/_/g, " ")}**. ` : "") +
                    (shortages[0]?.source_name ? `Source: ${shortages[0].source_name}.` : "") +
                    "\n\nWould you like to see alternatives, or check another country?"
                  );
                } else {
                  emit(controller, encoder, "text",
                    `**${drug.generic_name}** has **no reported shortages** in ${countryName} right now. ` +
                    `It does have **${drug.active_shortage_count} active shortage${drug.active_shortage_count !== 1 ? "s" : ""}** in other countries.\n\n` +
                    `Would you like to see the global shortage picture for this drug?`
                  );
                }
                break;
              }
            }

            // Country-only query
            const browseResult = await executeTool("browse_shortages", { country: cc!, status: "active", page_size: 15 });
            if (browseResult.results?.length > 0) {
              emit(controller, encoder, "shortages", browseResult.results.slice(0, 10));

              const critCount = browseResult.results.filter((s: { severity: string }) => s.severity === "critical").length;
              const drugNames = [...new Set(browseResult.results.slice(0, 5).map((s: { generic_name: string }) => s.generic_name))].join(", ");

              emit(controller, encoder, "text",
                `There are **${browseResult.total.toLocaleString()} active shortages** in ${countryName}` +
                (critCount > 0 ? `, including **${critCount} critical** in these results` : "") +
                `.\n\nSome affected drugs: ${drugNames}.\n\n` +
                `You can ask about a specific drug for more detail, or ask \"what are the alternatives to [drug]?\".`
              );
            } else {
              emit(controller, encoder, "text",
                `I don't have active shortage data for ${countryName} at the moment. We currently track shortages in 12 countries. ` +
                `Try asking about Australia, the US, Canada, Germany, Italy, or other major markets.`
              );
            }
            break;
          }

          case "drug_search":
          default: {
            let drugName = extractDrugName(query) || query.trim();

            // Check for follow-up references
            if (/\b(it|that|this|the same|that drug|this drug)\b/i.test(query)) {
              const ctx = findDrugContext(messages);
              if (ctx) drugName = ctx;
            }

            // Honest degraded-mode bail-out: if the query is clearly macro/thematic
            // (geopolitics, policy, supply chain causes, etc.) the rule-based
            // fallback can't answer it. Tell the user the AI brain is offline
            // instead of pretending it was a misspelt drug.
            const looksMacro = /\b(geopolitic|sanction|tariff|macro|why|cause|driven|drives|impact|policy|trade war|supply chain|trend|outlook|latest news|government|monopoly|concentration|economic|economy|tension|war|conflict|china|russia|india|trump|biden|inflation|currency)\b/i.test(query);
            const tokenCount = drugName.split(/\s+/).filter(Boolean).length;
            if (looksMacro || tokenCount > 3) {
              emit(controller, encoder, "text",
                "I'm running in **degraded mode** — the AI brain is offline (the server is missing its `ANTHROPIC_API_KEY`), so I can't take on macro or open-ended questions right now.\n\n" +
                "I can still help with:\n\n" +
                "- A specific drug — *\"amoxicillin\"*, *\"insulin glargine\"*\n" +
                "- A country view — *\"shortages in Germany\"*\n" +
                "- Alternatives — *\"alternatives to metformin\"*\n" +
                "- Recalls or a global summary\n\n" +
                "For broader natural-language questions, the operator needs to set the API key."
              );
              break;
            }

            let result = await executeTool("search_drugs", { query: drugName, limit: 6 });
            if (result.results.length === 0 && drugName !== query.trim()) {
              result = await executeTool("search_drugs", { query: query.trim(), limit: 6 });
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const exactHits = (result.results as any[]).filter(
              (r) => String(r.generic_name).toLowerCase() === drugName.toLowerCase()
            );
            if (result.results.length > 1 && exactHits.length !== 1) {
              emit(controller, encoder, "drugs", result.results);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const names = (result.results as any[]).slice(0, 6).map((r) => `**${r.generic_name}**`).join(", ");
              emit(controller, encoder, "text",
                `I found ${result.results.length} drugs matching "${drugName}" — ${names}. ` +
                `Which one did you mean? Click one above or reply with the full name.`
              );
              break;
            }

            if (result.results.length > 0) {
              const topDrug = exactHits[0] ?? result.results[0];
              emit(controller, encoder, "drugs", result.results);

              // Multi-SKU variant disclosure
              if ((topDrug.variant_count ?? 0) >= 2) {
                const sample = (topDrug.sample_variants ?? []).slice(0, 3).filter(Boolean);
                if (sample.length > 0) {
                  emit(controller, encoder, "text",
                    `**${topDrug.generic_name}** has **${topDrug.variant_count} SKU variants** in our catalogue ` +
                    `(e.g. ${sample.join("; ")}). I'll summarise across all of them below — ` +
                    `mention a specific strength or formulation if you need to narrow down.`
                  );
                }
              }

              // Also fetch shortages for the top hit
              const shortages = await executeTool("get_drug_shortages", { drug_id: topDrug.drug_id });
              const shortageArr = Array.isArray(shortages) ? shortages : [];
              const activeShortages = shortageArr.filter((s: { status: string }) => s.status === "active");

              if (activeShortages.length > 0) {
                emit(controller, encoder, "shortages", activeShortages.slice(0, 8));

                const countries = [...new Set(activeShortages.map((s: { country_code: string }) => s.country_code))];
                const countryList = countries.slice(0, 5).map(c => COUNTRY_NAMES[c] ?? c).join(", ");

                emit(controller, encoder, "text",
                  `**${topDrug.generic_name}** currently has **${activeShortages.length} active shortage${activeShortages.length !== 1 ? "s" : ""}** ` +
                  `across ${countries.length} ${countries.length === 1 ? "country" : "countries"}: ${countryList}.\n\n` +
                  `You can ask me to drill down into a specific country, find alternatives, or check recall history.`
                );
              } else if (shortageArr.length > 0) {
                emit(controller, encoder, "text",
                  `**${topDrug.generic_name}** has **no active shortages** right now. ` +
                  `There ${shortageArr.length === 1 ? "is" : "are"} ${shortageArr.length} resolved/historical shortage event${shortageArr.length !== 1 ? "s" : ""} on record.\n\n` +
                  `Would you like to see alternatives or recall history for this drug?`
                );
              } else {
                emit(controller, encoder, "text",
                  `**${topDrug.generic_name}** is in our database with **no reported shortages** — supply looks stable.\n\n` +
                  `I also found ${result.total > 1 ? `${result.total - 1} other matching drug${result.total - 1 !== 1 ? "s" : ""}` : "this as the only match"}. ` +
                  `Want to know about alternatives or check a specific country?`
                );
              }
            } else {
              emit(controller, encoder, "text",
                `I couldn't find "${drugName}" in our database of 7,000+ drugs. A few tips:\n\n` +
                `- Use the **generic name** (e.g., "paracetamol" not "Panadol")\n` +
                `- Check the spelling\n` +
                `- Try a broader term (e.g., "insulin" instead of a specific formulation)\n\n` +
                `You can also ask me for a global shortage summary or browse shortages by country.`
              );
            }
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        emit(controller, encoder, "text", `Sorry, I ran into an issue: ${msg}. Please try again.`);
      } finally {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

/* ── Main handler ───────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const { messages, userCountry: rawCountry } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    userCountry?: string;
  };

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  // Sanitise country code — default to AU
  const userCountry = /^[A-Z]{2}$/.test(rawCountry ?? "") ? rawCountry! : "AU";

  // Conversational fallback if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return conversationalFallback(messages, userCountry);
  }

  const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content ?? "";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Convert to Anthropic format
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = [...anthropicMessages];
        let iterations = 0;
        const MAX_ITERATIONS = 6;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: buildSystemPrompt(userCountry),
            // ToolDef is our union (custom + web_search server tool); the SDK accepts both
            // in the same array but doesn't expose a single union type cleanly across versions.
            tools: tools as unknown as Anthropic.Tool[],
            messages: currentMessages,
          });

          // Process content blocks
          const toolUseBlocks: Anthropic.ContentBlock[] = [];

          for (const block of response.content) {
            if (block.type === "text" && block.text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`));
            } else if (block.type === "tool_use") {
              toolUseBlocks.push(block);
            }
          }

          // If no tool calls, we're done
          if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
            break;
          }

          // Execute tools and build tool results
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of toolUseBlocks) {
            if (block.type !== "tool_use") continue;
            const result = await executeTool(block.name, block.input as Record<string, unknown>);

            // Stream structured data to client
            if (block.name === "search_drugs" && result.results?.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "drugs", data: result.results })}\n\n`));
            } else if ((block.name === "browse_shortages" || block.name === "get_drug_shortages") && (result.results?.length > 0 || (Array.isArray(result) && result.length > 0))) {
              const shortages = result.results ?? result;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "shortages", data: Array.isArray(shortages) ? shortages.slice(0, 10) : shortages })}\n\n`));
            } else if (block.name === "get_shortage_summary") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "summary", data: result })}\n\n`));
            } else if (block.name === "get_shortage_timeline") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "timeline", data: result })}\n\n`));
            } else if (block.name === "get_shortage_statistics") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "statistics", data: result })}\n\n`));
            } else if (block.name === "get_shortage_forecast") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "forecast", data: result })}\n\n`));
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }

          // Add assistant response + tool results for next iteration
          currentMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: response.content },
            { role: "user" as const, content: toolResults },
          ];
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: `Sorry, I encountered an error: ${msg}. Please try again.` })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
