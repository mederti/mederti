import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/* ── Tool definitions (same as global chat) ──────────────────── */

const tools: Anthropic.Tool[] = [
  {
    name: "search_drugs",
    description: "Search the drug database by name. Returns matching drugs with active shortage counts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Drug name to search" },
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
        drug_id: { type: "string", description: "UUID of the drug" },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"] },
        country: { type: "string", description: "ISO 2-letter country code" },
      },
      required: ["drug_id"],
    },
  },
  {
    name: "get_drug_alternatives",
    description: "Get therapeutic alternatives for a drug.",
    input_schema: {
      type: "object" as const,
      properties: { drug_id: { type: "string", description: "UUID of the drug" } },
      required: ["drug_id"],
    },
  },
  {
    name: "get_drug_recalls",
    description: "Get recall history and resilience score for a drug.",
    input_schema: {
      type: "object" as const,
      properties: { drug_id: { type: "string", description: "UUID of the drug" } },
      required: ["drug_id"],
    },
  },
  {
    name: "browse_shortages",
    description: "Browse shortage events across all drugs. Filter by country, status, severity.",
    input_schema: {
      type: "object" as const,
      properties: {
        country: { type: "string", description: "ISO 2-letter country code" },
        status: { type: "string", enum: ["active", "anticipated", "resolved", "stale"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        page_size: { type: "number", description: "Results per page (default 20, max 50)" },
      },
    },
  },
  {
    name: "get_shortage_summary",
    description: "Get dashboard summary: total active shortages, by severity/country.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "browse_recalls",
    description: "Browse drug recalls. Filter by country, class, status.",
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
    name: "navigate_to_drug_page",
    description: "Navigate the user to a DIFFERENT drug's page. Call this when the user clearly wants to look at a different drug than the current one (e.g. 'tell me about ibuprofen', 'show me metformin', 'switch to paracetamol'). Do NOT call this for the current drug — only when the user names a different drug.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_name: { type: "string", description: "Name of the drug to navigate to" },
      },
      required: ["drug_name"],
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
      const ids = rows.map((r) => r.id as string);
      const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
      try {
        const sc = await db.from("shortage_events").select("drug_id")
          .in("drug_id", ids).in("status", ["active", "anticipated"]);
        for (const row of sc.data ?? []) counts[row.drug_id] = (counts[row.drug_id] ?? 0) + 1;
      } catch { /* counts stay 0 */ }
      return { query: q, results: rows.map((r) => ({
        drug_id: r.id, generic_name: r.generic_name, brand_names: r.brand_names ?? [],
        atc_code: r.atc_code ?? null, active_shortage_count: counts[r.id as string] ?? 0,
      })), total: rows.length };
    }

    case "get_drug_shortages": {
      let query = db.from("shortage_events")
        .select("shortage_id, country, country_code, status, severity, reason, reason_category, start_date, end_date, estimated_resolution_date, source_url, last_verified_at, data_sources(name)")
        .eq("drug_id", input.drug_id).order("start_date", { ascending: false }).limit(30);
      if (input.status) query = query.eq("status", input.status);
      if (input.country) query = query.eq("country_code", input.country.toUpperCase());
      const { data } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        shortage_id: r.shortage_id, country: r.country ?? "", country_code: r.country_code ?? "",
        status: r.status, severity: r.severity, reason: r.reason, reason_category: r.reason_category,
        start_date: r.start_date, end_date: r.end_date, estimated_resolution_date: r.estimated_resolution_date,
        source_name: (r.data_sources ?? {}).name ?? null, source_url: r.source_url, last_verified_at: r.last_verified_at,
      }));
    }

    case "get_drug_alternatives": {
      const { data } = await db.from("drug_alternatives")
        .select("alternative_drug_id, relationship_type, clinical_evidence_level, similarity_score, dose_conversion_notes, availability_note, drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)")
        .eq("drug_id", input.drug_id).eq("is_approved", true).order("similarity_score", { ascending: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        alternative_drug_id: r.alternative_drug_id, alternative_generic_name: (r.drugs ?? {}).generic_name ?? "",
        alternative_brand_names: (r.drugs ?? {}).brand_names ?? [], relationship_type: r.relationship_type ?? "",
        clinical_evidence_level: r.clinical_evidence_level, similarity_score: r.similarity_score,
        dose_conversion_notes: r.dose_conversion_notes, availability_note: r.availability_note,
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
          id: r.id, recall_id: r.recall_id, country_code: r.country_code, recall_class: r.recall_class,
          generic_name: r.generic_name, brand_name: r.brand_name, manufacturer: r.manufacturer,
          announced_date: String(r.announced_date), status: r.status, reason_category: r.reason_category,
          press_release_url: r.press_release_url, linked_shortages: linkCounts[r.id] ?? 0,
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
      const BATCH = 1000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRows: any[] = [];
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
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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

    case "navigate_to_drug_page": {
      const q = (input.drug_name as string).trim();
      const limit = 3;
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
      if (rows.length > 0) {
        const best = rows[0];
        return { found: true, drug_id: best.id, generic_name: best.generic_name, brand_names: best.brand_names ?? [] };
      }
      return { found: false, drug_name: q };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/* ── Conversational fallback (no API key) ──────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emit(controller: ReadableStreamDefaultController, encoder: TextEncoder, type: string, data: any) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(type === "text" ? { type, content: data } : { type, data })}\n\n`));
}

async function conversationalFallback(
  messages: Array<{ role: string; content: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drugContext: any,
): Promise<Response> {
  const query = messages.filter((m) => m.role === "user").pop()?.content ?? "";
  const q = query.toLowerCase();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Detect if the user is asking about a DIFFERENT drug ──
        const pivotMatch = q.match(/\b(?:about|show|tell me about|look up|switch to|what about|how about|find)\s+(.+?)(?:\?|$)/i);
        if (pivotMatch) {
          const candidate = pivotMatch[1].trim().replace(/\?$/, "").trim();
          const currentName = (drugContext.generic_name ?? "").toLowerCase();
          if (candidate.length >= 3 && !currentName.includes(candidate) && !candidate.includes(currentName)) {
            const result = await executeTool("navigate_to_drug_page", { drug_name: candidate });
            if (result.found && result.drug_id !== drugContext.id) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "pivot", drug_id: result.drug_id, generic_name: result.generic_name })}\n\n`));
              emit(controller, encoder, "text", `Taking you to **${result.generic_name}**\u2026`);
              // Let the finally block emit "done" and close the controller
              return;
            }
          }
        }

        if (/\b(alternative|alternatives|substitute|replace|instead|switch)\b/.test(q)) {
          const alts = await executeTool("get_drug_alternatives", { drug_id: drugContext.id });
          if (Array.isArray(alts) && alts.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const altList = alts.slice(0, 5).map((a: any) =>
              `- **${a.alternative_generic_name}** (${a.relationship_type}, ${Math.round(a.similarity_score * 100)}% similarity)`
            ).join("\n");
            emit(controller, encoder, "text",
              `Here are the therapeutic alternatives for **${drugContext.generic_name}**:\n\n${altList}\n\nAlways consult a healthcare professional before switching medications.`
            );
          } else {
            emit(controller, encoder, "text",
              `We don't have therapeutic alternatives on file for **${drugContext.generic_name}** yet. Consult a pharmacist for substitution options.`
            );
          }
        } else if (/\b(recall|recalls|recalled|safety|withdrawn)\b/.test(q)) {
          const recallData = await executeTool("get_drug_recalls", { drug_id: drugContext.id });
          if (recallData.recalls?.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const recent = recallData.recalls.slice(0, 5).map((r: any) =>
              `- **Class ${r.recall_class}** (${r.country_code}) \u2014 ${r.announced_date} \u2014 ${r.reason_category ?? "unspecified"}`
            ).join("\n");
            emit(controller, encoder, "text",
              `**${drugContext.generic_name}** has **${recallData.recalls.length} recall${recallData.recalls.length !== 1 ? "s" : ""}** on record (resilience score: **${recallData.resilience_score}/100**).\n\nRecent recalls:\n${recent}`
            );
          } else {
            emit(controller, encoder, "text",
              `Good news \u2014 **${drugContext.generic_name}** has no recalls on record. Resilience score: **${recallData.resilience_score}/100**.`
            );
          }
        } else if (/\b(when|return|resolve|available|back|stock|supply)\b/.test(q)) {
          const shortages = await executeTool("get_drug_shortages", { drug_id: drugContext.id, status: "active" });
          const arr = Array.isArray(shortages) ? shortages : [];
          if (arr.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const withDates = arr.filter((s: any) => s.estimated_resolution_date);
            if (withDates.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dateList = withDates.slice(0, 3).map((s: any) =>
                `- **${s.country_code}**: estimated ${new Date(s.estimated_resolution_date).toLocaleDateString("en-AU", { month: "short", year: "numeric" })} (${s.source_name ?? "regulator"})`
              ).join("\n");
              emit(controller, encoder, "text",
                `Here are the estimated resolution dates for **${drugContext.generic_name}**:\n\n${dateList}\n\nThese dates are based on regulatory estimates and may change.`
              );
            } else {
              emit(controller, encoder, "text",
                `There are **${arr.length} active shortage${arr.length !== 1 ? "s" : ""}** for **${drugContext.generic_name}**, but no estimated resolution dates are available from regulators yet. Supply disruptions of this type typically take 3\u20139 months to resolve.`
              );
            }
          } else {
            emit(controller, encoder, "text",
              `**${drugContext.generic_name}** has no active shortages right now. Supply looks stable.`
            );
          }
        } else if (/\b(country|countries|where|affected|global)\b/.test(q)) {
          emit(controller, encoder, "text",
            drugContext.activeShortageCount > 0
              ? `**${drugContext.generic_name}** is currently in shortage in **${drugContext.affectedCountries.length} countr${drugContext.affectedCountries.length !== 1 ? "ies" : "y"}**: ${drugContext.affectedCountries.join(", ")}.\n\nWorst severity: **${drugContext.worstSeverity}**. Supply risk score: **${drugContext.riskScore}/100** (${drugContext.riskLevel}).`
              : `**${drugContext.generic_name}** has no active shortages in any monitored country. We track 20+ countries across 40+ regulatory sources.`
          );
        } else {
          // General response about the drug — prioritise user's country
          const uc = drugContext.userCountryName ?? drugContext.userCountry ?? "your country";
          const ucStatus = drugContext.userCountryStatus ?? "no data";
          const ucSev = drugContext.userCountrySeverity ?? "unknown";
          const ucLine = ucStatus !== "no data" ? ` In **${uc}**, status is **${ucStatus}** (severity: ${ucSev}).` : ` No data for ${uc}.`;
          emit(controller, encoder, "text",
            drugContext.activeShortageCount > 0
              ? `**${drugContext.generic_name}** currently has **${drugContext.activeShortageCount} active shortage${drugContext.activeShortageCount !== 1 ? "s" : ""}** across ${drugContext.affectedCountries.length} countr${drugContext.affectedCountries.length !== 1 ? "ies" : "y"} (worst severity: ${drugContext.worstSeverity}).${ucLine}\n\nSupply risk score: **${drugContext.riskScore}/100** (${drugContext.riskLevel}).${drugContext.alternativeCount > 0 ? ` ${drugContext.alternativeCount} therapeutic alternative${drugContext.alternativeCount !== 1 ? "s" : ""} available.` : ""}${drugContext.recallCount > 0 ? ` ${drugContext.recallCount} recall${drugContext.recallCount !== 1 ? "s" : ""} on record.` : ""} Ask me anything specific about this drug.`
              : `**${drugContext.generic_name}** has **no active shortages**. Supply looks stable across all monitored markets.\n\n${drugContext.alternativeCount > 0 ? `${drugContext.alternativeCount} therapeutic alternative${drugContext.alternativeCount !== 1 ? "s" : ""} are on file. ` : ""}${drugContext.recallCount > 0 ? `${drugContext.recallCount} historical recall${drugContext.recallCount !== 1 ? "s" : ""}. ` : ""}Ask me anything about this drug.`
          );
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messages, drugContext } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drugContext?: any;
  };

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  // Fallback mode
  if (!process.env.ANTHROPIC_API_KEY) {
    return conversationalFallback(messages, drugContext ?? { id, generic_name: "this drug", activeShortageCount: 0, affectedCountries: [], riskScore: 0, riskLevel: "WATCH", alternativeCount: 0, recallCount: 0 });
  }

  // Build drug-specific system prompt
  const ctx = drugContext ?? {};
  const SYSTEM_PROMPT = `You are Mederti, a pharmaceutical shortage intelligence assistant. You are currently helping with a specific drug: **${ctx.generic_name ?? "Unknown"}**${ctx.strength ? ` ${ctx.strength}` : ""} (${ctx.form ?? ""}).

DRUG CONTEXT:
- Drug ID: ${id}
- Generic name: ${ctx.generic_name ?? "Unknown"}
- Brand names: ${(ctx.brand_names ?? []).join(", ") || "None listed"}
- ATC code: ${ctx.atc_code ?? "N/A"}
- Active shortages: ${ctx.activeShortageCount ?? 0} across ${(ctx.affectedCountries ?? []).length} countries${(ctx.affectedCountries ?? []).length > 0 ? ` (${(ctx.affectedCountries ?? []).join(", ")})` : ""}
- Worst severity: ${ctx.worstSeverity ?? "none"}
- Supply risk score: ${ctx.riskScore ?? 0}/100 (${ctx.riskLevel ?? "WATCH"})
- User's country: ${ctx.userCountryName ?? ctx.userCountry ?? "Australia"} (${ctx.userCountry ?? "AU"})
- ${ctx.userCountry ?? "AU"} shortage status: ${ctx.userCountryStatus ?? "no data"}
- ${ctx.userCountry ?? "AU"} severity: ${ctx.userCountrySeverity ?? "unknown"}
- Alternatives on file: ${ctx.alternativeCount ?? 0}
- Recalls on record: ${ctx.recallCount ?? 0}
${(ctx.shortagesByCountry ?? []).length > 0 ? `- Shortage breakdown: ${ctx.shortagesByCountry.map((c: { country: string; severity: string }) => `${c.country} (${c.severity})`).join(", ")}` : ""}

GUIDELINES:
- You start focused on THIS drug, but the user may ask about ANY drug, country, or shortage topic.
- The user is in **${ctx.userCountryName ?? ctx.userCountry ?? "Australia"}** — always prioritise ${ctx.userCountry ?? "AU"} data first when answering about shortages or availability, unless they ask about a specific country.
- When the user asks about shortages, alternatives, or recalls without specifying a drug, use the drug_id "${id}" for the current drug.
- If the user asks about a different drug (e.g. "what about ibuprofen?", "show me metformin", "switch to paracetamol"), call navigate_to_drug_page to take them there. The page will automatically update. Then briefly introduce the new drug using search_drugs or get_drug_shortages with the new drug_id.
- If the user asks a general question (e.g. "which country has the most shortages?"), answer it using browse_shortages or get_shortage_summary.
- Keep responses concise — 2-3 short paragraphs maximum.
- Always cite the data source when available.
- If severity is critical or high, emphasize this.
- You are not a medical professional. Do not provide clinical advice.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

          const toolUseBlocks: Anthropic.ContentBlock[] = [];
          for (const block of response.content) {
            if (block.type === "text" && block.text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`));
            } else if (block.type === "tool_use") {
              toolUseBlocks.push(block);
            }
          }

          if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            if (block.type !== "tool_use") continue;
            const result = await executeTool(block.name, block.input as Record<string, unknown>);
            // Emit pivot event when navigating to a different drug
            if (block.name === "navigate_to_drug_page" && result.found && result.drug_id !== id) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "pivot", drug_id: result.drug_id, generic_name: result.generic_name })}\n\n`));
            }
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });

            // Emit pivot event when navigating to a different drug
            if (block.name === "navigate_to_drug_page" && result.found && result.drug_id !== id) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "pivot", drug_id: result.drug_id, generic_name: result.generic_name })}\n\n`));
            }
          }

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
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
