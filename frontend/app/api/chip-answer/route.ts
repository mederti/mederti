import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/* ── Types ── */

interface AnticipatedDetail {
  country: string;
  source: string;
  startDate: string | null;
  endDate: string | null;
  reason: string | null;
}

interface DrugContext {
  drugName: string;
  genericName: string;
  drugId: string;
  activeShortageCount: number;
  anticipatedCount: number;
  affectedCountries: string[];
  anticipatedCountries: string[];
  worstSeverity: string;
  alternatives: Array<{ name: string; similarityScore: number }>;
  isAnticipatedOnly: boolean;
  anticipatedDetails?: AnticipatedDetail[];
}

/* ── System prompt ── */

function buildSystemPrompt(ctx: DrugContext): string {
  const altList = ctx.alternatives.length > 0
    ? `Known therapeutic alternatives: ${ctx.alternatives.map(a => `${a.name} (${Math.round(a.similarityScore * 100)}% similarity)`).join(", ")}.`
    : "No therapeutic alternatives currently on file.";

  const anticipatedInfo = ctx.anticipatedDetails && ctx.anticipatedDetails.length > 0
    ? `\nAnticipated shortage details: ${ctx.anticipatedDetails.map(d =>
        `${d.country} (${d.source}): ${d.startDate ?? "date unknown"}\u2192${d.endDate ?? "open"}${d.reason ? `, reason: ${d.reason}` : ""}`
      ).join("; ")}`
    : "";

  const shortageDesc = ctx.isAnticipatedOnly
    ? `Shortages are ANTICIPATED (not yet confirmed) in ${ctx.anticipatedCountries.join(", ")}.${anticipatedInfo}`
    : ctx.activeShortageCount > 0
      ? `There are ${ctx.activeShortageCount} active shortage events affecting ${ctx.affectedCountries.join(", ")}. Worst severity: ${ctx.worstSeverity}.${ctx.anticipatedCount > 0 ? ` Additionally, shortages are anticipated in ${ctx.anticipatedCountries.join(", ")}.${anticipatedInfo}` : ""}`
      : `No active shortages currently reported.${anticipatedInfo}`;

  return `You are Mederti, a pharmaceutical shortage intelligence assistant embedded in a drug detail page.

DRUG CONTEXT:
- Drug: ${ctx.genericName} (${ctx.drugName})
- ${shortageDesc}
- ${altList}

GUIDELINES:
- Answer the specific question concisely — 2-4 sentences max.
- Be factual. Base answers on the drug context provided.
- For "When will stock return?" — cite typical shortage durations (3-9 months for manufacturing issues, 1-3 months for supply chain, 6-18 months for regulatory). Note if the shortage is only anticipated.
- For "Which alternatives are safe?" — list the known alternatives with similarity scores. Always note that switching requires clinical oversight.
- For "Is my country affected?" — reference the affected countries list. If none, say supply appears stable.
- For "Historical shortage pattern" — describe the pattern based on shortage count, severity, and whether shortages are recurring or new.
- Do NOT use markdown headers. Use plain text with occasional **bold** for emphasis.
- You are not a medical professional. Include a brief disclaimer when discussing alternatives.
- Keep the tone professional but accessible.`;
}

/* ── Handler ── */

export async function POST(req: NextRequest) {
  const { question, drugContext } = (await req.json()) as {
    question: string;
    drugContext: DrugContext;
  };

  if (!question || !drugContext?.genericName) {
    return new Response(JSON.stringify({ error: "question and drugContext required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      };

      try {
        if (!apiKey) {
          // Fallback: generate a static answer without the API
          const fallback = generateFallback(question, drugContext);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: fallback })}\n\n`));
          finish();
          return;
        }

        const anthropic = new Anthropic({ apiKey });
        const systemPrompt = buildSystemPrompt(drugContext);

        const response = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", content: event.delta.text })}\n\n`
              )
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text", content: `Sorry, I encountered an error: ${msg}` })}\n\n`
          )
        );
      } finally {
        finish();
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

/* ── Fallback for when no API key is set ── */

function generateFallback(question: string, ctx: DrugContext): string {
  const q = question.toLowerCase();

  if (q.includes("stock return") || q.includes("when")) {
    if (ctx.isAnticipatedOnly) {
      return `The shortage for ${ctx.genericName} is currently anticipated but not yet confirmed. If the anticipated shortage materialises, manufacturing-related shortages typically last 3-9 months, while supply chain issues often resolve within 1-3 months. Monitor the affected markets (${ctx.anticipatedCountries.join(", ")}) for updates.`;
    }
    if (ctx.activeShortageCount > 0) {
      return `${ctx.genericName} currently has ${ctx.activeShortageCount} active shortage event${ctx.activeShortageCount !== 1 ? "s" : ""} (worst severity: ${ctx.worstSeverity}). Based on historical patterns, drug shortages of this type typically resolve within 3-9 months for manufacturing issues, or 1-3 months for supply chain disruptions. Resolution timelines vary by country and regulatory response.`;
    }
    return `No active shortages are reported for ${ctx.genericName}. Supply currently appears stable across monitored markets.`;
  }

  if (q.includes("alternative") || q.includes("safe")) {
    if (ctx.alternatives.length > 0) {
      const altText = ctx.alternatives.map(a => `**${a.name}** (${Math.round(a.similarityScore * 100)}% therapeutic similarity)`).join(", ");
      return `Known alternatives for ${ctx.genericName}: ${altText}. These are based on therapeutic class similarity and clinical evidence. Always consult a healthcare professional before switching — dosage adjustments and contraindication checks are essential.`;
    }
    return `We don't currently have therapeutic alternatives on file for ${ctx.genericName}. Consult a pharmacist or clinical reference for substitution options. The prescribing clinician should assess any switch based on the patient's full medication profile.`;
  }

  if (q.includes("country") || q.includes("affected")) {
    if (ctx.affectedCountries.length > 0) {
      return `${ctx.genericName} shortages are currently reported in: ${ctx.affectedCountries.join(", ")}.${ctx.anticipatedCountries.length > 0 ? ` Additional shortages are anticipated in: ${ctx.anticipatedCountries.join(", ")}.` : ""} Countries not listed may still be affected — our database covers 20+ major markets but not all regions.`;
    }
    if (ctx.anticipatedCountries.length > 0) {
      return `While no confirmed shortages exist yet, ${ctx.genericName} shortages are anticipated in: ${ctx.anticipatedCountries.join(", ")}. This early warning comes from regulatory filings and supply intelligence. Monitor closely.`;
    }
    return `No shortages are currently reported for ${ctx.genericName} in any of our monitored markets (20+ countries including AU, US, GB, CA, DE, FR, NZ, and more). Supply appears stable.`;
  }

  if (q.includes("historical") || q.includes("pattern")) {
    if (ctx.activeShortageCount > 0) {
      return `${ctx.genericName} currently has ${ctx.activeShortageCount} active shortage event${ctx.activeShortageCount !== 1 ? "s" : ""} across ${ctx.affectedCountries.length} countr${ctx.affectedCountries.length !== 1 ? "ies" : "y"}. The worst severity level is **${ctx.worstSeverity}**. Pharmaceutical shortages of this nature often follow cyclical patterns tied to manufacturing capacity, raw material availability, and regulatory actions. Recurring shortages in the same therapeutic class may indicate structural supply chain vulnerabilities.`;
    }
    return `${ctx.genericName} has no active shortages in our current data. Historical shortage patterns can be reviewed in the Supply Timeline section below. The absence of current shortages is a positive indicator, though past events may still inform supply chain risk assessment.`;
  }

  return `${ctx.genericName} — ${ctx.activeShortageCount > 0 ? `${ctx.activeShortageCount} active shortage${ctx.activeShortageCount !== 1 ? "s" : ""} reported` : "no active shortages"}. Use the questions above to explore specific aspects of the shortage situation.`;
}
