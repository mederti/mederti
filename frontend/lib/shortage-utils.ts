/**
 * S19A detection utilities.
 *
 * Section 19A of the Therapeutic Goods Act 1989 (AU) allows the TGA to approve
 * supply of overseas-registered medicines when no adequate local alternative exists.
 * This information is stored in the `notes` field of shortage_events by the TGA scraper
 * (prefixed with "TGA guidance:").
 */

export function detectS19A(notes: string | null | undefined): boolean {
  if (!notes) return false;
  const text = notes.toLowerCase();
  return (
    text.includes("section 19") ||
    text.includes("s19a") ||
    (text.includes("overseas") && text.includes("approved for supply")) ||
    (text.includes("unregistered") && text.includes("approved for supply"))
  );
}

/**
 * Extract the S19A-relevant portion from the notes field.
 * Returns the "TGA guidance:" paragraph if it contains S19A language,
 * otherwise the full notes trimmed.
 */
export function getS19AText(notes: string | null | undefined): string | null {
  if (!detectS19A(notes)) return null;

  // Try to extract just the TGA guidance paragraph
  const parts = (notes ?? "").split("\n\n");
  const guidancePart = parts.find(
    (p) => p.startsWith("TGA guidance:") && detectS19A(p),
  );
  if (guidancePart) {
    return guidancePart.replace(/^TGA guidance:\s*/i, "").trim();
  }

  return notes?.trim() ?? null;
}
