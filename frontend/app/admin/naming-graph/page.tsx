/**
 * Naming Graph — internal demo/debug tool that visualises how Mederti
 * reconciles drug naming across markets.
 *
 * For any input term (brand name, INN, USAN, generic, etc.) the page
 * walks the 5 resolution layers and shows what matched at each step:
 *
 *   1. Regulator-local catalogue   (drug_catalogue)
 *   2. Synonym resolution           (drug_synonyms)
 *   3. Composite normalised key     (generic + strength + form)
 *   4. ATC universal classification (drugs.atc_code + atc_codes if applied)
 *   5. RxNorm canonical (US)        (drug_rxnorm if applied)
 *
 * Public route under /admin/* but does no auth check — this is intended
 * for demos and team debugging. Lock down with a middleware check if
 * we ever surface PII through it.
 */
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ drug?: string }>;
}

interface SynonymRow {
  drug_id: string;
  synonym: string;
  source: string;
}

interface CatalogueRow {
  source_country: string | null;
  source_name: string | null;
  brand_name: string | null;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  registration_number: string | null;
}

interface AtcChainRow {
  atc_substance: string | null;
  atc_chemical_subgroup: string | null;
  atc_pharmacological_subgroup: string | null;
  atc_therapeutic_subgroup: string | null;
  atc_anatomical_group: string | null;
  ddd_value: number | null;
  ddd_unit: string | null;
  ddd_route: string | null;
}

interface RxNormRow {
  rxcui: string;
  rxnorm_name: string | null;
  ingredient_rxcuis: string[] | null;
  atc_from_rxnorm: string | null;
}

interface DrugRow {
  id: string;
  generic_name: string;
  brand_names: string[] | null;
  atc_code: string | null;
  atc_description: string | null;
  drug_class: string | null;
}

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪",
  FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪", FI: "🇫🇮",
  NO: "🇳🇴", SE: "🇸🇪", DK: "🇩🇰", NL: "🇳🇱", BE: "🇧🇪",
  CH: "🇨🇭", AT: "🇦🇹", PT: "🇵🇹", PL: "🇵🇱", JP: "🇯🇵",
  KR: "🇰🇷", IN: "🇮🇳", BR: "🇧🇷", MX: "🇲🇽", NZ: "🇳🇿",
  HU: "🇭🇺", CZ: "🇨🇿", IL: "🇮🇱", SG: "🇸🇬", MY: "🇲🇾",
  HK: "🇭🇰", CN: "🇨🇳", AR: "🇦🇷", TR: "🇹🇷", AE: "🇦🇪",
  SA: "🇸🇦", NG: "🇳🇬", ZA: "🇿🇦", EU: "🇪🇺",
};

const flag = (cc: string | null | undefined) => (cc ? (FLAGS[cc] ?? "🏳️") : "🏳️");

export default async function NamingGraphPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = (sp.drug ?? "").trim();
  const sb = getSupabaseAdmin();

  // ── Resolution layers (all queries gracefully degrade if tables absent) ──
  let drug: DrugRow | null = null;
  let synonyms: SynonymRow[] = [];
  let catalogue: CatalogueRow[] = [];
  let atcChain: AtcChainRow | null = null;
  let rxnorm: RxNormRow | null = null;
  let resolvedVia: string = "";

  if (query) {
    const q = query.toLowerCase();

    // Step 1: try drugs.generic_name (exact or brand-array match)
    {
      const r = await sb
        .from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class")
        .ilike("generic_name", q)
        .limit(1)
        .maybeSingle();
      if (r.data) {
        drug = r.data as DrugRow;
        resolvedVia = "drugs.generic_name";
      }
    }
    // Step 2: try drug_synonyms
    if (!drug) {
      const r = await sb
        .from("drug_synonyms")
        .select("drug_id, synonym, source")
        .ilike("synonym_normalised", q)
        .limit(1)
        .maybeSingle();
      if (r.data) {
        resolvedVia = `drug_synonyms (synonym → canonical, source: ${r.data.source})`;
        const dr = await sb
          .from("drugs")
          .select("id, generic_name, brand_names, atc_code, atc_description, drug_class")
          .eq("id", (r.data as { drug_id: string }).drug_id)
          .maybeSingle();
        if (dr.data) drug = dr.data as DrugRow;
      }
    }
    // Step 3: try brand_names array contains
    if (!drug) {
      const r = await sb
        .from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class")
        .contains("brand_names", [query])
        .limit(1)
        .maybeSingle();
      if (r.data) {
        drug = r.data as DrugRow;
        resolvedVia = "drugs.brand_names[]";
      }
    }
    // Step 4: fuzzy fallback
    if (!drug) {
      const r = await sb
        .from("drugs")
        .select("id, generic_name, brand_names, atc_code, atc_description, drug_class")
        .ilike("generic_name", `%${q}%`)
        .limit(1)
        .maybeSingle();
      if (r.data) {
        drug = r.data as DrugRow;
        resolvedVia = "drugs.generic_name (fuzzy ILIKE)";
      }
    }

    if (drug) {
      // Pull all sibling synonyms
      const syn = await sb
        .from("drug_synonyms")
        .select("drug_id, synonym, source")
        .eq("drug_id", drug.id);
      synonyms = (syn.data as SynonymRow[] | null) ?? [];

      // Pull regulator-local catalogue entries
      try {
        const cat = await sb
          .from("drug_catalogue")
          .select("source_country, source_name, brand_name, generic_name, strength, dosage_form, registration_number")
          .eq("drug_id", drug.id)
          .limit(50);
        catalogue = (cat.data as CatalogueRow[] | null) ?? [];
      } catch { /* table or column absent */ }

      // ATC chain via v_drug_atc_enriched (only present if migration 031 applied)
      try {
        const atc = await sb
          .from("v_drug_atc_enriched")
          .select("atc_substance, atc_chemical_subgroup, atc_pharmacological_subgroup, atc_therapeutic_subgroup, atc_anatomical_group, ddd_value, ddd_unit, ddd_route")
          .eq("drug_id", drug.id)
          .maybeSingle();
        if (atc.data) atcChain = atc.data as AtcChainRow;
      } catch { /* migration 031 not yet applied */ }

      // RxNorm (only present if migration 032 applied + importer run)
      try {
        const rx = await sb
          .from("drug_rxnorm")
          .select("rxcui, rxnorm_name, ingredient_rxcuis, atc_from_rxnorm")
          .eq("drug_id", drug.id)
          .limit(1)
          .maybeSingle();
        if (rx.data) rxnorm = rx.data as RxNormRow;
      } catch { /* migration 032 not yet applied */ }
    }
  }

  // ── Layout primitives ──
  const layerCard = (
    n: number, title: string, status: "live" | "live-empty" | "pending", body: React.ReactNode
  ) => (
    <div style={{
      background: "var(--app-bg)",
      border: "1px solid var(--app-border)",
      borderRadius: 14,
      padding: "20px 22px",
      position: "relative",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 28, height: 28, borderRadius: "50%",
            background: status === "pending" ? "var(--app-bg-2)" : "var(--app-text)",
            color: status === "pending" ? "var(--app-text-4)" : "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-dm-mono), monospace",
            fontSize: 12, fontWeight: 600,
          }}>{n}</span>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</div>
        </div>
        <span style={{
          fontSize: 10, padding: "3px 8px", borderRadius: 5,
          fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
          fontFamily: "var(--font-dm-mono), monospace",
          background: status === "live" ? "var(--low-bg)"
            : status === "live-empty" ? "var(--med-bg)"
            : "var(--app-bg-2)",
          color:      status === "live" ? "var(--low)"
            : status === "live-empty" ? "var(--med)"
            : "var(--app-text-4)",
          border: `1px solid ${
            status === "live" ? "var(--low-b)"
            : status === "live-empty" ? "var(--med-b)"
            : "var(--app-border)"
          }`,
        }}>
          {status === "live" ? "Matched" : status === "live-empty" ? "No data" : "Awaiting ingest"}
        </span>
      </div>
      <div>{body}</div>
    </div>
  );

  const arrow = () => (
    <div style={{
      textAlign: "center", margin: "8px 0",
      color: "var(--app-text-4)", fontSize: 18, lineHeight: 1,
    }}>↓</div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg-2)", color: "var(--app-text)" }}>
      <SiteNav />

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Header */}
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.08em", color: "var(--teal)",
          fontFamily: "var(--font-dm-mono), monospace", marginBottom: 8,
        }}>
          Mederti · Internal · Naming reconciliation
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em", marginBottom: 10 }}>
          How a name becomes a drug
        </h1>
        <p style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.6, marginBottom: 28, maxWidth: 720 }}>
          A single molecule can have 5+ official names depending on which regulator is talking, plus
          dozens of brand names per market. Mederti reconciles all of that into one canonical drug
          entity. Type any name below to see the resolution path.
        </p>

        {/* Search form */}
        <form action="/admin/naming-graph" method="get" style={{ marginBottom: 36 }}>
          <div style={{
            display: "flex", gap: 10, alignItems: "stretch",
            background: "var(--app-bg)", border: "1px solid var(--app-border)",
            borderRadius: 10, padding: 6,
          }}>
            <input
              type="text" name="drug" defaultValue={query}
              placeholder='Try: "Tylenol", "Panadol", "salbutamol", "albuterol", "epinephrine"…'
              style={{
                flex: 1, padding: "10px 14px", fontSize: 14,
                border: 0, background: "transparent", color: "var(--app-text)",
                outline: "none", fontFamily: "var(--font-inter), sans-serif",
              }}
            />
            <button type="submit" style={{
              padding: "10px 18px", background: "var(--app-text)", color: "#fff",
              border: 0, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "var(--font-inter), sans-serif",
            }}>Resolve</button>
          </div>
          {/* Quick links */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {["paracetamol", "Tylenol", "salbutamol", "epinephrine", "Panadol", "metformin", "dipyrone"].map(t => (
              <Link key={t} href={`/admin/naming-graph?drug=${encodeURIComponent(t)}`} style={{
                fontSize: 11, padding: "5px 11px", borderRadius: 5,
                background: "var(--app-bg)", border: "1px solid var(--app-border)",
                color: "var(--app-text-3)", textDecoration: "none",
                fontFamily: "var(--font-dm-mono), monospace",
              }}>{t}</Link>
            ))}
          </div>
        </form>

        {/* Empty state */}
        {!query && (
          <div style={{
            padding: "60px 30px", textAlign: "center",
            background: "var(--app-bg)", border: "1px dashed var(--app-border)",
            borderRadius: 14, color: "var(--app-text-3)",
          }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>Enter a drug name above to see the 5-layer resolution.</div>
            <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
              Brand · INN · USAN · BAN · JAN · synonyms · ATC · RxNorm — all reconciled.
            </div>
          </div>
        )}

        {/* No match */}
        {query && !drug && (
          <div style={{
            padding: "40px 24px", textAlign: "center",
            background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
            borderRadius: 14, color: "var(--crit)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No match for &ldquo;{query}&rdquo;</div>
            <div style={{ fontSize: 12 }}>Not in drugs, drug_synonyms, or drugs.brand_names[].</div>
          </div>
        )}

        {/* Resolution journey */}
        {drug && (
          <div>
            {/* Canonical entity header */}
            <div style={{
              background: "var(--app-text)", color: "#fff",
              borderRadius: 14, padding: "22px 24px", marginBottom: 20,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.08em", opacity: 0.6, marginBottom: 8,
                fontFamily: "var(--font-dm-mono), monospace",
              }}>Resolved canonical drug</div>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 6 }}>
                {drug.generic_name}
              </div>
              <div style={{
                fontSize: 12, opacity: 0.75, fontFamily: "var(--font-dm-mono), monospace",
              }}>
                {drug.atc_code ?? "no ATC"} · {resolvedVia}
              </div>
            </div>

            {/* Layer 1 — regulator-local */}
            {layerCard(1, "Regulator-local catalogue", catalogue.length > 0 ? "live" : "live-empty", (
              catalogue.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {catalogue.slice(0, 8).map((c, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 10px", borderRadius: 7,
                      background: "var(--app-bg-2)", fontSize: 12,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ fontSize: 16 }}>{flag(c.source_country)}</span>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <strong style={{ color: "var(--app-text)" }}>{c.brand_name ?? c.generic_name ?? "?"}</strong>
                          {(c.strength || c.dosage_form) && (
                            <span style={{ color: "var(--app-text-3)" }}>
                              {" · "}{[c.strength, c.dosage_form].filter(Boolean).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, color: "var(--app-text-4)",
                        fontFamily: "var(--font-dm-mono), monospace",
                      }}>{c.source_name ?? c.source_country}</span>
                    </div>
                  ))}
                  {catalogue.length > 8 && (
                    <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 4 }}>
                      + {catalogue.length - 8} more catalogue entries…
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
                  No drug_catalogue rows for this drug yet. The catalogue is populated by
                  the regulator-feed linker; some drugs are matched directly from
                  shortage events without a catalogue entry.
                </div>
              )
            ))}
            {arrow()}

            {/* Layer 2 — synonyms */}
            {layerCard(2, "Synonym resolution (INN ↔ USAN ↔ BAN ↔ aliases)", synonyms.length > 0 ? "live" : "live-empty", (
              <div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600, padding: "5px 10px",
                    background: "var(--teal-bg)", color: "var(--teal)",
                    borderRadius: 6, border: "1px solid var(--teal-b)",
                  }}>{drug.generic_name}</span>
                  {synonyms.length > 0 && <span style={{ color: "var(--app-text-4)" }}>⇄</span>}
                  {synonyms.map(s => (
                    <span key={s.synonym} style={{
                      fontSize: 12, padding: "4px 9px", borderRadius: 6,
                      background: "var(--app-bg-2)", color: "var(--app-text-2)",
                      border: "1px solid var(--app-border)",
                    }}>
                      {s.synonym}
                      <span style={{ marginLeft: 6, fontSize: 9, color: "var(--app-text-4)",
                        fontFamily: "var(--font-dm-mono), monospace" }}>
                        {s.source}
                      </span>
                    </span>
                  ))}
                </div>
                {synonyms.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 6 }}>
                    No synonyms recorded — this drug name is consistent across markets.
                  </div>
                )}
                {(drug.brand_names ?? []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: "0.06em", color: "var(--app-text-4)", marginBottom: 6,
                    }}>Brand names captured</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {(drug.brand_names ?? []).slice(0, 24).map(bn => (
                        <span key={bn} style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 5,
                          background: "var(--app-bg)", border: "1px solid var(--app-border)",
                          color: "var(--app-text-3)",
                        }}>{bn}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {arrow()}

            {/* Layer 3 — composite key */}
            {layerCard(3, "Composite normalised key", "live", (
              <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 13 }}>
                <span style={{ color: "var(--app-text-4)" }}>(</span>
                <span style={{ color: "var(--teal)" }}>{drug.generic_name.toLowerCase()}</span>
                <span style={{ color: "var(--app-text-4)" }}>, strength_value, strength_unit, form_normalised)</span>
                <div style={{ fontSize: 11, color: "var(--app-text-3)", marginTop: 8, fontFamily: "var(--font-inter), sans-serif", lineHeight: 1.6 }}>
                  Every regulator-local row gets parsed into this tuple at link-time, then
                  joined via an indexed composite key. &ldquo;500mg tablet&rdquo;,
                  &ldquo;0.5 g tab&rdquo; and &ldquo;500 milligrams, film-coated tablet&rdquo;
                  all normalise to (500, mg, tablet).
                </div>
              </div>
            ))}
            {arrow()}

            {/* Layer 4 — ATC universal */}
            {layerCard(4, "ATC universal classification (WHO)", drug.atc_code ? "live" : "live-empty", (
              drug.atc_code ? (
                <div>
                  <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 14, fontWeight: 600 }}>
                    {drug.atc_code} <span style={{ color: "var(--app-text-3)", fontWeight: 400 }}>—
                      {" "}{atcChain?.atc_substance ?? drug.atc_description ?? drug.generic_name}
                    </span>
                  </div>
                  {atcChain ? (
                    <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7 }}>
                      <div>↳ <code style={{ background: "var(--app-bg-2)", padding: "1px 5px", borderRadius: 3 }}>{drug.atc_code.slice(0, 5)}</code> {atcChain.atc_chemical_subgroup}</div>
                      <div>↳ <code style={{ background: "var(--app-bg-2)", padding: "1px 5px", borderRadius: 3 }}>{drug.atc_code.slice(0, 4)}</code> {atcChain.atc_pharmacological_subgroup}</div>
                      <div>↳ <code style={{ background: "var(--app-bg-2)", padding: "1px 5px", borderRadius: 3 }}>{drug.atc_code.slice(0, 3)}</code> {atcChain.atc_therapeutic_subgroup}</div>
                      <div>↳ <code style={{ background: "var(--app-bg-2)", padding: "1px 5px", borderRadius: 3 }}>{drug.atc_code.slice(0, 1)}</code> {atcChain.atc_anatomical_group}</div>
                      {atcChain.ddd_value !== null && atcChain.ddd_value !== undefined && (
                        <div style={{ marginTop: 8, fontSize: 11, color: "var(--app-text-3)" }}>
                          DDD: {atcChain.ddd_value} {atcChain.ddd_unit ?? ""} {atcChain.ddd_route ?? ""}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--app-text-4)" }}>
                      Full ATC chain shown after migration 031 + WHO ATC importer activate.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--app-text-3)" }}>
                  No ATC code on this drug yet — assigned by the regulator-feed linker
                  or backfilled from WHO INN ingest.
                </div>
              )
            ))}
            {arrow()}

            {/* Layer 5 — RxNorm */}
            {layerCard(5, "RxNorm canonical (US universal ID)", rxnorm ? "live" : "pending", (
              rxnorm ? (
                <div>
                  <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 13 }}>
                    RxCUI {rxnorm.rxcui} — {rxnorm.rxnorm_name ?? drug.generic_name}
                  </div>
                  {rxnorm.atc_from_rxnorm && rxnorm.atc_from_rxnorm !== drug.atc_code && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--med)" }}>
                      ⚠️ ATC mismatch — drugs.atc_code: {drug.atc_code ?? "(none)"} vs RxNorm: {rxnorm.atc_from_rxnorm}
                    </div>
                  )}
                  {(rxnorm.ingredient_rxcuis ?? []).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--app-text-3)" }}>
                      Ingredient RxCUIs: {(rxnorm.ingredient_rxcuis ?? []).slice(0, 6).join(" · ")}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.6 }}>
                  Not yet linked. RxNorm backfill importer is ready (Path A · 2/3) —
                  apply migration 032 and run{" "}
                  <code style={{ background: "var(--app-bg-2)", padding: "1px 5px", borderRadius: 3 }}>
                    python3 -m backend.importers.rxnorm_backfill
                  </code>
                  {" "}to populate.
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
