/**
 * Builds the always-visible AI insight paragraph for a drug detail page.
 *
 * Covers:
 *  - Active (confirmed) shortages
 *  - Anticipated shortages (user country + global)
 *  - Clean "no shortage" fallback
 */

/* ── Types ── */

export interface ShortageRecord {
  country_code?: string;
  status?: string;
  severity?: string;
  reason?: string;
  reason_category?: string;
  start_date?: string;
  end_date?: string;
  estimated_resolution_date?: string;
  data_sources?: { name?: string; abbreviation?: string; country_code?: string };
}

export interface InsightTextParams {
  drugName: string;
  activeShortages: ShortageRecord[];
  userCountry: string;
  affectedCountries: Set<string>;
}

/* ── Helpers ── */

function abbreviateSource(name: string, abbreviation?: string | null): string {
  if (abbreviation) return abbreviation;
  if (name.includes("Food and Drug")) return "FDA";
  if (name.includes("Therapeutic Goods")) return "TGA";
  if (name.includes("European Medicines")) return "EMA";
  if (name.includes("Healthcare products") || name.includes("MHRA")) return "MHRA";
  if (name.includes("Health Canada") || name.includes("Santé Canada")) return "Health Canada";
  if (name.includes("BfArM")) return "BfArM";
  if (name.includes("ANSM")) return "ANSM";
  if (name.includes("AIFA")) return "AIFA";
  if (name.includes("AEMPS")) return "AEMPS";
  if (name.includes("Fimea")) return "Fimea";
  if (name.includes("NoMA")) return "NoMA";
  if (name.includes("Swissmedic")) return "Swissmedic";
  if (name.includes("HPRA")) return "HPRA";
  if (name.includes("Pharmac") || name.includes("Medsafe")) return "Medsafe";
  if (name.includes("HSA")) return "HSA";
  return name.length > 20 ? name.slice(0, 19) + "\u2026" : name;
}

function formatShortageDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/* ── Main ── */

export function buildAiInsightText({
  drugName,
  activeShortages,
  userCountry,
  affectedCountries,
}: InsightTextParams): string {
  const confirmed = activeShortages.filter(
    (s) => s.status?.toLowerCase() !== "anticipated"
  );
  const anticipated = activeShortages.filter(
    (s) => s.status?.toLowerCase() === "anticipated"
  );
  const countryAnticipated = anticipated.filter(
    (s) => s.country_code?.toUpperCase() === userCountry.toUpperCase()
  );

  let text = "";

  /* ── Base text (active / no active) ── */
  if (confirmed.length > 0) {
    const confirmedCountries = new Set(confirmed.map((s) => s.country_code));
    text += `This drug is currently under active shortage in ${confirmedCountries.size} countr${confirmedCountries.size !== 1 ? "ies" : "y"}. `;
    text += `Supply disruptions of this type typically persist for 3\u20139 months based on historical patterns. `;
    text += `Consider therapeutic alternatives where clinically appropriate.`;
  } else {
    text += `No active shortages are currently reported for ${drugName}. Monitor regularly as supply conditions can change rapidly.`;
  }

  /* ── Append anticipated commentary ── */
  if (countryAnticipated.length > 0) {
    const a = countryAnticipated[0];
    const sourceName =
      abbreviateSource(a.data_sources?.name ?? "", a.data_sources?.abbreviation) ||
      "regulatory authority";
    const start = a.start_date ? formatShortageDate(a.start_date) : null;
    const end = a.estimated_resolution_date
      ? formatShortageDate(a.estimated_resolution_date)
      : null;
    const window =
      start && end ? `${start}\u2013${end}` : start ? `from ${start}` : "in the coming months";
    const reasonRaw =
      a.reason && !/^availability:/i.test(a.reason.trim())
        ? a.reason.toLowerCase().replace(/\.+$/, "")
        : "";
    const reason = reasonRaw ? ` due to ${reasonRaw}` : "";

    if (confirmed.length > 0) {
      text += ` Additionally, ${sourceName} has issued an anticipated shortage notice for ${window}${reason}. Early procurement of alternatives is advisable.`;
    } else {
      // Rewrite opening — lead with the anticipated notice
      text = `No active shortage is currently reported, however ${sourceName} has issued an anticipated shortage notice for ${window}${reason}. Monitor regularly as supply conditions can change rapidly. Early procurement of alternatives is advisable.`;
    }
  } else if (anticipated.length > 0) {
    // Anticipated in other countries but not user's country
    const anticipatedCountrySet = new Set(anticipated.map((s) => s.country_code));
    text += ` Note: anticipated shortages have been flagged in ${anticipatedCountrySet.size} other countr${anticipatedCountrySet.size !== 1 ? "ies" : "y"}.`;
  }

  return text;
}
