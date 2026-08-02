/**
 * Centralised SEO helpers.
 *
 * - SITE_URL: the canonical origin. Set NEXT_PUBLIC_SITE_URL in prod to
 *   the final domain (e.g. https://mederti.com). Falls back to the
 *   Vercel preview URL or localhost.
 * - drugJsonLd: emits schema.org JSON-LD for a drug detail page, the
 *   single highest-leverage rich-results unlock for B2B pharma search.
 */

// Env vars pasted into the Vercel dashboard can carry stray whitespace or a
// trailing newline. That newline survived string interpolation and shipped
// literal "https://www.mederti.com\n/drugs/..." URLs in the live sitemap and
// canonicals — sanitise every origin before use, whatever its source.
function cleanOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function siteUrl(): string {
  if (typeof window !== "undefined") {
    // Client-side: prefer the env var; fall back to the actual host.
    return cleanOrigin(
      process.env.NEXT_PUBLIC_SITE_URL ??
      window.location.origin
    );
  }
  // In production, ALWAYS anchor to the canonical domain — never the
  // per-deployment VERCEL_URL (e.g. mederti-abc123-...vercel.app), which
  // would leak into canonical/OG/sitemap URLs and wreck SEO + link sharing.
  // NEXT_PUBLIC_SITE_URL still wins if set; VERCEL_URL is only used for
  // preview/branch deploys so their metadata self-references correctly.
  if (process.env.NEXT_PUBLIC_SITE_URL) return cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (process.env.VERCEL_ENV === "production") return "https://mederti.com";
  if (process.env.VERCEL_URL) return cleanOrigin(`https://${process.env.VERCEL_URL}`);
  return "https://mederti.com";
}

export function canonicalUrl(path: string): string {
  const base = siteUrl().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Serialise an object for safe injection into a <script type="application/ld+json">
 * via dangerouslySetInnerHTML.
 *
 * JSON.stringify does NOT escape `<`, `>` or `&`, so any user/registry-sourced
 * string containing `</script>` would break out of the script element and the
 * remainder would parse as live HTML — a stored-XSS vector. Escaping these three
 * characters to their \uXXXX form keeps the JSON semantically identical while
 * making `</script>` and HTML-entity breakouts impossible. Use this at EVERY
 * JSON-LD sink instead of bare JSON.stringify.
 */
export function jsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

// ─── JSON-LD generators ─────────────────────────────────────────────────────

interface DrugForJsonLd {
  id: string;
  generic_name: string;
  brand_names?: string[] | null;
  atc_code?: string | null;
  atc_description?: string | null;
  drug_class?: string | null;
  is_controlled_substance?: boolean | null;
  who_essential_medicine?: boolean | null;
  rxcui?: string | null;
}

interface ShortageForJsonLd {
  country: string;          // ISO-2
  severity: string;
  status: string;
  start_date?: string | null;
}

/**
 * schema.org Drug + (optional) MedicalCondition payload for a drug page.
 *
 * Returns a plain JSON object — caller wraps it in <script type=...>.
 * Google reads this for the "About this drug" knowledge panel.
 */
export function drugJsonLd(
  drug: DrugForJsonLd,
  activeShortages: ShortageForJsonLd[],
  countriesCount: number,
  pagePath?: string,
): Record<string, unknown> {
  const url = canonicalUrl(pagePath ?? `/drugs/${drug.id}`);

  const sameAs: string[] = [];
  if (drug.rxcui) {
    sameAs.push(`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${drug.rxcui}`);
  }
  if (drug.atc_code) {
    sameAs.push(`https://www.whocc.no/atc_ddd_index/?code=${drug.atc_code}`);
  }

  // The base Drug entity
  const drugNode: Record<string, unknown> = {
    "@type": "Drug",
    "@id": `${url}#drug`,
    "name": drug.generic_name,
    "nonProprietaryName": drug.generic_name,
    "url": url,
    "description": buildDrugDescription(drug),
    ...(drug.brand_names && drug.brand_names.length > 0
      ? { "alternateName": drug.brand_names.slice(0, 5) }
      : {}),
    ...(drug.atc_code ? { "code": { "@type": "MedicalCode", "codingSystem": "ATC", "codeValue": drug.atc_code } } : {}),
    ...(drug.is_controlled_substance ? { "isProprietary": false } : {}),
    ...(sameAs.length > 0 ? { "sameAs": sameAs } : {}),
  };

  // The page itself (WebPage describing the drug)
  const pageNode: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": url,
    "url": url,
    "name": pageTitle(drug, activeShortages[0]),
    "description": pageDescription(drug, activeShortages, countriesCount),
    "isPartOf": {
      "@type": "WebSite",
      "@id": `${siteUrl()}/#website`,
      "name": "Mederti",
      "url": siteUrl(),
    },
    "primaryImageOfPage": {
      "@type": "ImageObject",
      "url": `${siteUrl()}/api/og/drug/${drug.id}`,
    },
    "mainEntity": { "@id": `${url}#drug` },
  };

  // Optional MedicalCondition graph nodes (the shortages themselves)
  const shortageNodes = activeShortages.slice(0, 5).map((s, i) => ({
    "@type": "MedicalCondition",
    "@id": `${url}#shortage-${i}`,
    "name": `${drug.generic_name} shortage in ${s.country}`,
    "associatedAnatomy": null,
    "status": s.status,
    "severity": s.severity,
  }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      drugNode,
      pageNode,
      ...shortageNodes,
    ],
  };
}

// ─── Title / description helpers ────────────────────────────────────────────

export function pageTitle(
  drug: { generic_name: string; drug_class?: string | null },
  topShortage?: { country: string; severity: string },
): string {
  const name = drug.generic_name;
  if (topShortage) {
    return `${name} shortage — ${topShortage.country} supply status & alternatives | Mederti`;
  }
  return `${name} — supply status, manufacturers & alternatives | Mederti`;
}

export function pageDescription(
  drug: { generic_name: string; drug_class?: string | null; atc_description?: string | null },
  activeShortages: ShortageForJsonLd[],
  countriesCount: number,
): string {
  const name = drug.generic_name;
  const cls = drug.drug_class || drug.atc_description;
  const clsPhrase = cls ? `a ${cls.toLowerCase()}` : "the drug";

  if (activeShortages.length > 0) {
    const sevs = Array.from(new Set(activeShortages.map((s) => s.severity)));
    const countries = Array.from(new Set(activeShortages.map((s) => s.country))).slice(0, 3);
    const severity = sevs.includes("critical") ? "critical" : sevs[0];
    return [
      `${name} is in ${severity} shortage in ${countries.join(", ")}${activeShortages.length > countries.length ? " and more" : ""}.`,
      `See live status, manufacturers, alternatives and registered products across the markets we index.`,
      "Tracked by Mederti from regulatory sources worldwide.",
    ].join(" ");
  }

  return [
    `${name} supply status, registered manufacturers, brand names and clinical alternatives.`,
    `Tracked by Mederti from regulatory sources across major markets worldwide.`,
  ].join(" ");
}

function buildDrugDescription(drug: DrugForJsonLd): string {
  const parts: string[] = [];
  parts.push(drug.generic_name);
  if (drug.drug_class) parts.push(`(${drug.drug_class})`);
  else if (drug.atc_description) parts.push(`(${drug.atc_description})`);
  if (drug.who_essential_medicine) parts.push("— WHO Essential Medicine");
  return parts.join(" ");
}

// ─── Breadcrumb structured data ─────────────────────────────────────────────

/**
 * schema.org BreadcrumbList payload. Pass the trail as ordered tuples
 * from root to leaf. Google renders this as a clickable breadcrumb above
 * the page title in search results.
 */
export function breadcrumbJsonLd(
  trail: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": trail.map((step, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": step.name,
      "item": canonicalUrl(step.path),
    })),
  };
}

// ─── Site-wide entity structured data ───────────────────────────────────────

/**
 * schema.org Organization node for Mederti itself. Emitted once, in the root
 * layout, so Google and AI crawlers can resolve "Mederti" as an entity with a
 * stable @id rather than inferring it per page.
 */
export function organizationJsonLd(): Record<string, unknown> {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organization`,
    "name": "Mederti",
    "url": base,
    "logo": {
      "@type": "ImageObject",
      "url": `${base}/logo-black.png`,
    },
    "description":
      "Mederti is a global medicine shortage intelligence platform. It aggregates, normalises and monitors drug shortage and recall notices published by official medicines regulators across 50+ countries, updated daily.",
    "email": "hello@mederti.com",
    "sameAs": [
      "https://www.linkedin.com/company/mederti",
    ],
    "knowsAbout": [
      "drug shortages",
      "medicine shortages",
      "pharmaceutical supply chain",
      "drug recalls",
      "medicines regulation",
    ],
  };
}

/** schema.org WebSite node, linked to the Organization entity. */
export function webSiteJsonLd(): Record<string, unknown> {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    "url": base,
    "name": "Mederti",
    "publisher": { "@id": `${base}/#organization` },
  };
}

/**
 * schema.org FAQPage node. Pass ONLY questions whose answers are rendered
 * verbatim on the page — Google penalises FAQ markup for invisible content.
 */
export function faqJsonLd(
  faqs: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map((f) => ({
      "@type": "Question",
      "name": f.question,
      "acceptedAnswer": { "@type": "Answer", "text": f.answer },
    })),
  };
}

/**
 * schema.org Dataset node describing a slice of the Mederti shortage dataset
 * (e.g. one country's live shortage register). This is what Google Dataset
 * Search and AI retrieval systems read to understand and cite the data.
 */
export function datasetJsonLd(opts: {
  name: string;
  description: string;
  path: string;
  temporalCoverage?: string;
  spatialName?: string;
  keywords?: string[];
}): Record<string, unknown> {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": opts.name,
    "description": opts.description,
    "url": canonicalUrl(opts.path),
    "creator": { "@id": `${base}/#organization` },
    "license": `${base}/terms`,
    "isAccessibleForFree": true,
    ...(opts.temporalCoverage ? { "temporalCoverage": opts.temporalCoverage } : {}),
    ...(opts.spatialName
      ? { "spatialCoverage": { "@type": "Place", "name": opts.spatialName } }
      : {}),
    ...(opts.keywords && opts.keywords.length > 0 ? { "keywords": opts.keywords } : {}),
  };
}
