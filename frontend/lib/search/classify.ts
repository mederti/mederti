import { api } from "@/lib/api";

/**
 * Query intent for the unified /search surface.
 *
 *  - "empty" — nothing typed yet → show the home (prompts + trending).
 *  - "drug"  — a product/drug-name lookup → 3-column results layout.
 *  - "open"  — a natural-language question → conversational answer.
 */
export type QueryIntent = "empty" | "drug" | "open";

// Natural-language openers / analytical cues. If a query starts with one of
// these (or reads like a sentence), it's a question for the answer engine — even
// when it mentions a drug ("Compare insulin trade prices…" is an analysis, not a
// jump to the insulin product page).
const QUESTION_STARTERS =
  /^(what|whats|why|how|when|which|who|whose|whom|where|is|are|am|do|does|did|can|could|should|would|will|may|might|have|has|compare|explain|tell|show|list|find|give|summar|describe|recommend|suggest)\b/i;

/**
 * Cheap, synchronous "does this read like a question?" check. Catches the cases
 * where a drug name appears inside an analytical question so we don't wrongly
 * bounce the user to a product page.
 */
export function looksLikeQuestion(q: string): boolean {
  const t = q.trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  if (QUESTION_STARTERS.test(t)) return true;
  if (/\b(vs|versus)\b/i.test(t)) return true;
  // Long, sentence-like inputs are questions, not product names.
  if (t.split(/\s+/).length > 4) return true;
  return false;
}

/**
 * Classify a query into a product lookup vs an open question.
 *
 * Strategy (per the agreed design): a query that reads like a question goes
 * straight to the answer engine; otherwise we confirm it's a real drug via the
 * existing search/FTS (which also resolves typos like "amoxilcillin" through the
 * `suggestion` fallback). Anything short that isn't a known drug is treated as
 * an open question so the answer engine can handle it.
 */
export async function classifyQuery(q: string, market?: string): Promise<QueryIntent> {
  const t = q.trim();
  if (!t) return "empty";
  if (looksLikeQuestion(t)) return "open";
  try {
    const data = await api.search(t, 1, market ? { market } : undefined);
    if (data.results.length > 0) return "drug";
    if (data.suggestion) return "drug"; // typo of a real drug — results page corrects it
    return "open"; // short but unknown → let the answer engine try
  } catch {
    // Network/classify failure: fall back to the results layout, which degrades
    // gracefully to an honest "no results" rather than an LLM round-trip.
    return "drug";
  }
}
