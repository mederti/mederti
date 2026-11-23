import { COUNTRY_NAMES, countrySlug } from "@/lib/geo/country-names";

/**
 * Detects generic "what's short in <country>?" queries and resolves them to the
 * country landing page (/country/<slug>/medicine-shortages).
 *
 * Only *generic* queries route there: once the country name is removed, every
 * remaining word must be shortage/filler vocabulary. "drugs in short supply in
 * india", "india shortages", "what medicines are short in Belgium?" and a bare
 * "iceland" all match; "amoxicillin shortage india" does NOT (a drug is named,
 * so it belongs in the product results, scoped to that market).
 */

// Extra spellings people actually type, beyond COUNTRY_NAMES' display names.
const ALIASES: Record<string, string> = {
  uk: "GB",
  "u.k.": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  us: "US",
  america: "US",
  "united states of america": "US",
  holland: "NL",
  "the netherlands": "NL",
  uae: "AE",
  emirates: "AE",
  korea: "KR",
  "republic of korea": "KR",
  czechia: "CZ",
  turkiye: "TR",
  türkiye: "TR",
  bosnia: "BA",
  "hong kong sar": "HK",
  eu: "EU",
  europe: "EU",
  // Demonyms — "indian drug shortages", "australian medicine shortages".
  indian: "IN",
  australian: "AU",
  american: "US",
  british: "GB",
  canadian: "CA",
  belgian: "BE",
  icelandic: "IS",
  colombian: "CO",
  dutch: "NL",
  swiss: "CH",
  german: "DE",
  french: "FR",
  italian: "IT",
  spanish: "ES",
  irish: "IE",
  japanese: "JP",
  chinese: "CN",
  "new zealand's": "NZ",
  kiwi: "NZ",
  singaporean: "SG",
  malaysian: "MY",
  thai: "TH",
  taiwanese: "TW",
  brazilian: "BR",
  mexican: "MX",
  peruvian: "PE",
  argentinian: "AR",
  argentine: "AR",
  "south african": "ZA",
  nigerian: "NG",
  saudi: "SA",
  turkish: "TR",
  greek: "GR",
  portuguese: "PT",
  polish: "PL",
  danish: "DK",
  swedish: "SE",
  norwegian: "NO",
  finnish: "FI",
  austrian: "AT",
  czech: "CZ",
  slovak: "SK",
  hungarian: "HU",
  slovenian: "SI",
  croatian: "HR",
  romanian: "RO",
  latvian: "LV",
  lithuanian: "LT",
  estonian: "EE",
  "sri lankan": "LK",
  senegalese: "SN",
};

// Words that carry no drug identity — shortage vocabulary, filler, and the
// question scaffolding people wrap around "what's short in X".
const GENERIC = new Set(
  (
    "a an the in of for on at to from with by and or which what whats what's are is were was " +
    "there any all current currently now today right latest recent new live list lists show me " +
    "tell give find see check get my our this that these those how many much do does have has " +
    "drug drugs medicine medicines medication medications pharmaceutical pharmaceuticals " +
    "pharmacy pharmacies product products prescription prescriptions rx " +
    "shortage shortages short supply supplies shortfall shortfalls scarce scarcity " +
    "unavailable unavailability availability available out stock stocks discontinued discontinuation " +
    "discontinuations problem problems issue issues register registry database data tracker " +
    "national country nationwide wide crisis update updates status report reports " +
    "running low"
  ).split(/\s+/),
);

// Forward-looking / procurement vocabulary. A country query that uses these is
// still country-level (no drug named) but is a real question — it lands on the
// country page AND is asked in that page's grounded chat.
const FORWARD = new Set(
  (
    "will be going gonna next coming months month weeks week year years quarter soon upcoming " +
    "expected expect expecting future forecast forecasts predicted predict prediction likely " +
    "risk risks at should could i we buy order stock up stockpile stockpiling procure purchase " +
    "need plan prepare ahead worst most critical severe affected impacted why cause causes " +
    "one two three four five six seven eight nine ten eleven twelve half"
  ).split(/\s+/),
);
const isForward = (t: string) => FORWARD.has(t) || /^\d{1,3}$/.test(t);

type Entry = { tokens: string[]; code: string };

// Longest names first so "south africa" wins over "africa"-style partials and
// "united states of america" over "united states".
const ENTRIES: Entry[] = (() => {
  const raw: [string, string][] = [
    ...Object.entries(COUNTRY_NAMES).map(([code, name]) => [name.toLowerCase(), code] as [string, string]),
    ...Object.entries(ALIASES),
  ];
  return raw
    .map(([name, code]) => ({ tokens: tokenize(name), code }))
    .sort((a, b) => b.tokens.length - a.tokens.length);
})();

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']s\b/g, "") // "india's" → "india"
    .replace(/[^\p{L}\p{N}.\s-]/gu, " ")
    .replace(/(^|\s)\.|\.(\s|$)/g, " ") // stray full stops, keep "u.k."
    .split(/[\s-]+/)
    .filter(Boolean);
}

export interface CountryIntent {
  code: string;
  /** Set when the query is a question to answer on the page (forward-looking,
   *  procurement), not just "show me the list". */
  ask: string | null;
}

/** Country-level shortage intent (no specific drug named), else null. */
export function countryIntent(q: string): CountryIntent | null {
  const tokens = tokenize(q);
  if (tokens.length === 0 || tokens.length > 14) return null;

  for (const { tokens: name, code } of ENTRIES) {
    for (let i = 0; i + name.length <= tokens.length; i++) {
      let hit = true;
      for (let j = 0; j < name.length; j++) {
        if (tokens[i + j] !== name[j]) { hit = false; break; }
      }
      if (!hit) continue;
      const rest = [...tokens.slice(0, i), ...tokens.slice(i + name.length)];
      // Bare "us" is too ambiguous on its own ("tell us…"); require it to be
      // the whole query's subject with shortage vocabulary around it.
      if (name.length === 1 && name[0] === "us" && rest.length === 0) return null;
      if (!rest.every((t) => GENERIC.has(t) || isForward(t))) return null;
      const asks = rest.some((t) => !GENERIC.has(t)) || q.includes("?") && rest.some((t) => t === "which" || t === "how");
      return { code, ask: asks ? q.trim() : null };
    }
  }
  return null;
}

/**
 * Landing-page URL for a country-level query, or null. Questions carry
 * `?ask=` so the page's chat answers them in place.
 */
export function countryLandingPath(q: string): string | null {
  const hit = countryIntent(q);
  if (!hit || hit.code === "EU") return null;
  const base = `/country/${countrySlug(hit.code)}/medicine-shortages`;
  return hit.ask ? `${base}?ask=${encodeURIComponent(hit.ask)}` : base;
}
