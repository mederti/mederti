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

  return `You are Mederti, a pharmaceutical shortage intelligence assistant built for pharmacists, procurement teams, hospital supply managers, and regulators.

DATABASE: 7,000+ drugs, 14,000+ shortage events, 12,000+ recalls from 30+ regulatory sources across 20+ countries (AU, US, GB, CA, DE, FR, NZ, SG, IE, NO, FI, SE, NL, CH, IT, ES, JP, IN, BR, ZA, and more).

USER CONTEXT:
- The user's home country is **${userCountry}** (${homeLabel}).
- When the user asks about a drug without specifying a country, ALWAYS check shortages for ${userCountry} first using the country filter.
- Lead your answer with the status in ${homeLabel}: "In ${homeLabel}, [drug] is/is not currently in shortage." Then add the global picture.
- If the user explicitly asks about a different country, answer for that country instead.
- For overview/summary questions, still lead with ${homeLabel} numbers before global totals.

RESPONSE RULES:
1. Lead with the answer — no preamble, no "Let me look that up."
2. Always start with the user's home country (${userCountry}) status, then expand globally.
3. Cite the data source for every claim (source_name field).
4. Flag critical/high severity shortages prominently.
5. When a shortage is active, always mention the reason and estimated resolution if available.
6. Maximum 600 words. Use markdown: bold for drug names and key facts, bullet lists for multiple items.
7. End with 1-2 specific follow-up suggestions the user can ask next (e.g., "You can ask about alternatives, or check another country.").

TOOL STRATEGY:
- When the user mentions a drug name: always call search_drugs first, then fetch shortages for ${userCountry} specifically (country="${userCountry}"), THEN fetch global shortages as a second call.
- Country questions without a drug: use browse_shortages with the country filter.
- Overview questions ("how many", "what's the situation"): use get_shortage_summary, but also call browse_shortages with country="${userCountry}" to lead with local data.
- Trends over time: use get_shortage_timeline for a specific drug or get_shortage_statistics for aggregate data.
- Follow-ups ("what about in the US?"): infer the drug from conversation context.

TYPO HANDLING:
- Users often misspell drug names and country names. Interpret the likely intended word and search for it.
- Examples: "amoxicilin" → search "amoxicillin", "metformn" → search "metformin", "Ausrtalia" → Australia, "Singpaore" → Singapore.
- When you correct a typo, briefly acknowledge it: "Showing results for **amoxicillin**:" — don't lecture about the spelling.
- If search returns no results for a misspelled term, try a corrected version before giving up.

BOUNDARIES:
- You are not a medical professional. Never provide clinical dosing advice.
- If a drug is not found even after trying corrections, suggest checking the spelling or trying the generic name.
- Do not fabricate shortage data — only report what the tools return.`;
}

/* ── Tool definitions ───────────────────────────────────────── */

const tools: Anthropic.Tool[] = [
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

      const results = rows.map((r) => ({
        drug_id: r.id, generic_name: r.generic_name,
        brand_names: r.brand_names ?? [], atc_code: r.atc_code ?? null,
        active_shortage_count: counts[r.id as string] ?? 0,
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
              const searchResult = await executeTool("search_drugs", { query: drugName, limit: 3 });
              if (searchResult.results.length > 0) {
                const drug = searchResult.results[0];
                emit(controller, encoder, "drugs", searchResult.results);

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

            let result = await executeTool("search_drugs", { query: drugName, limit: 6 });
            if (result.results.length === 0 && drugName !== query.trim()) {
              result = await executeTool("search_drugs", { query: query.trim(), limit: 6 });
            }

            if (result.results.length > 0) {
              const topDrug = result.results[0];
              emit(controller, encoder, "drugs", result.results);

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
        const MAX_ITERATIONS = 3;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: buildSystemPrompt(userCountry),
            tools,
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
