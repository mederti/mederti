// Plain-language copy for shortage substitution pathways (regulatory_eligibility
// schemes, migration 040). The schemes mean different things — some grant real
// permission to supply a substitute, others are informational notices — so each
// gets its own copy instead of a generic "✓ Yes". `permission` marks pathways
// that themselves authorise substitute supply, and drives the ✓/green styling.
export type SchemeCopy = { headline: string; detail: string; permission: boolean };

export const SCHEME_COPY: Record<string, SchemeCopy> = {
  tga_s19a: {
    headline: "Yes — approved substitute available",
    detail: "TGA s19A: overseas-registered product authorised",
    permission: true,
  },
  mhra_ssp: {
    headline: "Yes — pharmacist may substitute",
    detail: "Serious Shortage Protocol — no new prescription needed",
    permission: true,
  },
  dhsc_msn: {
    headline: "Supply notice issued",
    detail: "DHSC guidance — prescriber may need to act",
    permission: false,
  },
  fda_503b: {
    headline: "Compounded supply permitted",
    detail: "FDA 503B — outsourcing facilities may compound",
    permission: true,
  },
  fda_shortage: {
    headline: "On FDA shortage list",
    detail: "enables emergency pathways — not itself a substitution approval",
    permission: false,
  },
  eu_art_5_2: {
    headline: "Yes — national exemption active",
    detail: "EU Art 5(2) — authority-approved emergency supply",
    permission: true,
  },
};

export const FALLBACK_SCHEME_COPY: SchemeCopy = {
  headline: "Substitution pathway on record",
  detail: "see reference for scope",
  permission: false,
};
