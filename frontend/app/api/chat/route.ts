import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── System prompt ──────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are Mederti, a pharmaceutical shortage intelligence assistant. You help pharmacists, procurement teams, and regulators understand drug shortage situations globally.

You have access to a live database of 7,000+ drugs, 14,000+ shortage events, and 12,000+ recalls from 30+ regulatory sources across 20+ countries including Australia (AU), United States (US), United Kingdom (GB), Canada (CA), Germany (DE), France (FR), New Zealand (NZ), Singapore (SG), Ireland (IE), Norway (NO), Finland (FI), Sweden (SE), Netherlands (NL), Switzerland (CH), Italy (IT), Spain (ES), Japan (JP), India (IN), Brazil (BR), and South Africa (ZA).

GUIDELINES:
- Always search for the drug first when the user mentions a specific drug name.
- For country-specific questions, use the appropriate ISO country code filter.
- When asked about alternatives, first search for the drug, then call get_drug_alternatives with the drug_id.
- For overview questions ("how many shortages", "what's the situation"), use get_shortage_summary.
- For "shortages in [country]" without a specific drug, use browse_shortages with the country filter.
- When a user asks a follow-up like "what about in the US?", use context from the conversation to determine which drug they mean.
- Always cite the data source when available (source_name field).
- If severity is critical or high, emphasize this.
- Keep responses concise — 2-4 short paragraphs maximum.
- You are not a medical professional. Do not provide clinical advice.`;

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
];

/* ── Tool executors ─────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool(name: string, input: Record<string, any>): Promise<any> {
  const db = getSupabaseAdmin();

  switch (name) {
    case "search_drugs": {
      const q = (input.query as string).trim();
      const limit = Math.min(input.limit ?? 6, 20);

      // FTS then ilike fallback
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

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/* ── Fallback (no API key) ──────────────────────────────────── */

// Strip common NL phrases to extract a searchable drug name
const NL_NOISE = /\b(shortage|shortages|supply|status|alternative|alternatives|to|in|for|of|the|this|month|what|is|are|drug|drugs|critical|current|about|australia|united states|us|uk|canada|germany|france|au|gb|ca|de|fr|nz|sg)\b/gi;
function extractDrugName(query: string): string {
  return query.replace(NL_NOISE, "").replace(/\s+/g, " ").trim();
}

async function fallbackSearch(query: string): Promise<Response> {
  // Try the raw query first, then the extracted drug name
  let result = await executeTool("search_drugs", { query, limit: 6 });
  const extracted = extractDrugName(query);
  if (result.results.length === 0 && extracted && extracted !== query) {
    result = await executeTool("search_drugs", { query: extracted, limit: 6 });
  }

  // If we found a drug and the query mentions a country, also fetch shortages
  let shortages: unknown[] = [];
  const countryMatch = query.match(/\b(AU|US|GB|CA|NZ|SG|DE|FR|IT|ES|CH|NO|FI|IE|SE|NL|JP|IN|BR|ZA|australia|united states|united kingdom|canada|new zealand|singapore|germany|france|italy|spain|switzerland|norway|finland|ireland|sweden|netherlands|japan|india|brazil|south africa)\b/i);
  if (result.results.length > 0 && countryMatch) {
    const codeMap: Record<string, string> = {
      australia: "AU", "united states": "US", "united kingdom": "GB", canada: "CA",
      "new zealand": "NZ", singapore: "SG", germany: "DE", france: "FR",
      italy: "IT", spain: "ES", switzerland: "CH", norway: "NO", finland: "FI",
      ireland: "IE", sweden: "SE", netherlands: "NL", japan: "JP", india: "IN",
      brazil: "BR", "south africa": "ZA",
    };
    const cc = codeMap[countryMatch[0].toLowerCase()] ?? countryMatch[0].toUpperCase();
    const drugId = result.results[0].drug_id;
    shortages = await executeTool("get_drug_shortages", { drug_id: drugId, country: cc });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (result.results.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "drugs", data: result.results })}\n\n`));
        if (Array.isArray(shortages) && shortages.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "shortages", data: shortages.slice(0, 10) })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: `I found ${result.total} drug${result.total !== 1 ? "s" : ""} matching your search, with ${shortages.length} shortage event${shortages.length !== 1 ? "s" : ""} in the specified country. Click any drug for full details.` })}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: `I found ${result.total} result${result.total !== 1 ? "s" : ""} for "${extracted || query}". Click any drug to see full shortage details.` })}\n\n`));
        }
      } else {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: `No drugs matched "${query}" in our database. Try searching for a generic drug name like "amoxicillin" or "metformin".` })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

/* ── Main handler ───────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content ?? "";

  // Fallback if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackSearch(lastUserMsg);
  }

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
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
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
