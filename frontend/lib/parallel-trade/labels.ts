/**
 * Human-readable labels for parallel-trade match confidence.
 *
 * A pharmacist doesn't read "0.90" — they read "strong match". This maps the
 * numeric confidence (and the corroborated fields) to plain English, shared by
 * every parallel-trade surface so the wording stays consistent.
 */

export type MatchTone = "ok" | "good" | "low";

export function confidenceLabel(confidence: number): { label: string; tone: MatchTone } {
  if (confidence >= 0.9) return { label: "Strong match", tone: "ok" };
  if (confidence >= 0.65) return { label: "Likely match", tone: "good" };
  return { label: "Possible match", tone: "low" };
}

const BASIS_LABEL: Record<string, string> = {
  inn: "molecule",
  brand: "brand",
  strength: "strength",
  dosage_form: "form",
  pack_size: "pack",
  ma_number: "MA number",
};

/** "brand + strength + form" from ["inn","brand","strength","dosage_form"]. */
export function basisText(basis: string[] | null | undefined): string {
  if (!basis || basis.length === 0) return "molecule";
  return basis.map((b) => BASIS_LABEL[b] ?? b).join(" + ");
}

/** A concise, persona-useful headline for the licence panel. */
export function paralleltradeVerdict(s: {
  ema_count: number;
  national_count: number;
  countries: number;
}): string {
  const parts: string[] = [];
  if (s.national_count > 0) {
    parts.push(
      `imported under ${s.national_count} national licence${s.national_count !== 1 ? "s" : ""} across ${s.countries} market${s.countries !== 1 ? "s" : ""}`
    );
  }
  if (s.ema_count > 0) {
    parts.push(`${s.ema_count} EMA parallel-distribution notice${s.ema_count !== 1 ? "s" : ""}`);
  }
  if (parts.length === 0) return "No parallel-trade routes recorded for this molecule yet.";
  return `Actively parallel-traded — ${parts.join(" · ")}.`;
}
