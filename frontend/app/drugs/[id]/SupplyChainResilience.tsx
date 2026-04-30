"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Factory, Stamp, Globe, AlertTriangle, CheckCircle2, Star } from "lucide-react";

const FLAGS: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", IN: "🇮🇳", CN: "🇨🇳", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", IE: "🇮🇪", CH: "🇨🇭", CA: "🇨🇦", AU: "🇦🇺", JP: "🇯🇵",
  BE: "🇧🇪", NL: "🇳🇱", PT: "🇵🇹", PL: "🇵🇱", SK: "🇸🇰", HU: "🇭🇺", SI: "🇸🇮",
};

const AUTHORITY_LABEL: Record<string, string> = {
  FDA:  "🇺🇸 FDA", EMA:  "🇪🇺 EMA", MHRA: "🇬🇧 MHRA",
  TGA:  "🇦🇺 TGA", HC:   "🇨🇦 Health Canada", PMDA: "🇯🇵 PMDA", HSA:  "🇸🇬 HSA",
};

const RISK_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  "very high": { color: "var(--crit)", bg: "var(--crit-bg)", label: "Very high" },
  high:        { color: "var(--high)", bg: "var(--high-bg)", label: "High" },
  medium:      { color: "var(--med)",  bg: "var(--med-bg)",  label: "Medium" },
  low:         { color: "var(--low)",  bg: "var(--low-bg)",  label: "Low" },
  unknown:     { color: "var(--app-text-4)", bg: "var(--app-bg)", label: "Unknown" },
};

interface ResilienceData {
  drug: { generic_name: string; who_essential_medicine: boolean; critical_medicine_eu: boolean };
  approvals: Array<{ authority: string; application_number: string; te_code: string | null; approval_date: string | null; brand_name: string | null; status: string; applicant_name: string; source_url: string | null }>;
  api_suppliers: Array<{ manufacturer_name: string; country: string; cep_holder: boolean; dmf_holder: boolean; who_pq: boolean; capabilities: string[] | null }>;
  facilities: Array<{ facility_name: string; country: string; last_inspection_classification: string; last_inspection_date: string | null; oai_count_5y: number; warning_letter_count_5y: number; source_url: string | null }>;
  pricing: Array<{ country: string; price_type: string; pack_price: number; currency: string; pack_description: string; effective_date: string }>;
  resilience_score: {
    api_supplier_count: number;
    supplier_country_count: number;
    concentration_risk: string;
    oai_exposed_facilities: number;
    warning_letters_5y: number;
    who_essential: boolean;
    eu_critical: boolean;
  };
}

export default function SupplyChainResilience({ drugId }: { drugId: string }) {
  const [data, setData] = useState<ResilienceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/drug-resilience/${drugId}`)
      .then(r => r.json())
      .then(d => setData(d.drug ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [drugId]);

  if (loading || !data) return null;

  const { resilience_score: rs, approvals, api_suppliers, facilities, pricing } = data;
  const hasAny = approvals.length > 0 || api_suppliers.length > 0 || facilities.length > 0 || pricing.length > 0 || rs.who_essential;
  if (!hasAny) return null;

  const risk = RISK_STYLE[rs.concentration_risk] ?? RISK_STYLE.unknown;

  return (
    <section style={{ marginTop: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>
          Supply chain resilience
        </span>
        <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
          {rs.api_supplier_count} API supplier{rs.api_supplier_count !== 1 ? "s" : ""} · {rs.supplier_country_count} countr{rs.supplier_country_count !== 1 ? "ies" : "y"}
        </span>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: 20 }}>
        {/* Headline scorecard */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
          <Stat
            label="Concentration risk"
            value={risk.label}
            color={risk.color}
            bg={risk.bg}
          />
          <Stat
            label="OAI-classified facilities"
            value={String(rs.oai_exposed_facilities)}
            color={rs.oai_exposed_facilities > 0 ? "var(--crit)" : "var(--low)"}
            bg={rs.oai_exposed_facilities > 0 ? "var(--crit-bg)" : "var(--low-bg)"}
            sub="last 5 years"
          />
          <Stat
            label="Warning letters"
            value={String(rs.warning_letters_5y)}
            color={rs.warning_letters_5y > 0 ? "var(--high)" : "var(--app-text-4)"}
            bg={rs.warning_letters_5y > 0 ? "var(--high-bg)" : "var(--app-bg)"}
            sub="last 5 years"
          />
          <Stat
            label="Essential medicine"
            value={rs.who_essential || rs.eu_critical ? "Yes" : "No"}
            color={rs.who_essential || rs.eu_critical ? "var(--teal)" : "var(--app-text-4)"}
            bg={rs.who_essential || rs.eu_critical ? "var(--teal-bg)" : "var(--app-bg)"}
            sub={rs.who_essential ? "WHO EML" : rs.eu_critical ? "EU Critical" : "—"}
          />
        </div>

        {/* Approvals */}
        {approvals.length > 0 && (
          <Section title="Regulatory approvals" icon={<Stamp size={12} color="var(--teal)" />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
              {approvals.slice(0, 6).map((a, i) => (
                <a
                  key={i}
                  href={a.source_url ?? undefined}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "block", padding: 10, background: "var(--app-bg)",
                    border: "1px solid var(--app-border)", borderRadius: 6,
                    textDecoration: "none", color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--teal)", letterSpacing: "0.04em", marginBottom: 4 }}>
                    {AUTHORITY_LABEL[a.authority] ?? a.authority}
                    {a.te_code && (
                      <span style={{ marginLeft: 6, padding: "1px 5px", background: "var(--low-bg)", color: "var(--low)", borderRadius: 3, fontFamily: "var(--font-dm-mono), monospace" }}>
                        TE {a.te_code}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {a.brand_name || a.applicant_name || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2, fontFamily: "var(--font-dm-mono), monospace" }}>
                    {a.application_number} · {a.approval_date ?? "?"}
                  </div>
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* API suppliers */}
        {api_suppliers.length > 0 && (
          <Section title="API manufacturers" icon={<Factory size={12} color="var(--teal)" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {api_suppliers.slice(0, 8).map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 6 }}>
                  <span style={{ fontSize: 16 }}>{FLAGS[s.country] ?? s.country}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{s.manufacturer_name}</span>
                  {s.cep_holder && <Pill>CEP</Pill>}
                  {s.dmf_holder && <Pill>DMF</Pill>}
                  {s.who_pq && <Pill green>WHO PQ</Pill>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Manufacturing facilities — quality signals */}
        {facilities.length > 0 && (
          <Section title="Manufacturing facility signals" icon={<AlertTriangle size={12} color={rs.oai_exposed_facilities > 0 ? "var(--crit)" : "var(--app-text-4)"} />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {facilities.slice(0, 5).map((f, i) => {
                const cls = f.last_inspection_classification;
                const clsColor = cls === "OAI" ? "var(--crit)" : cls === "VAI" ? "var(--high)" : "var(--low)";
                const clsBg = cls === "OAI" ? "var(--crit-bg)" : cls === "VAI" ? "var(--high-bg)" : "var(--low-bg)";
                return (
                  <a
                    key={i}
                    href={f.source_url ?? undefined}
                    target="_blank"
                    rel="noopener"
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 6, textDecoration: "none", color: "inherit" }}
                  >
                    <span style={{ fontSize: 16 }}>{FLAGS[f.country] ?? f.country}</span>
                    <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.facility_name}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px",
                      background: clsBg, color: clsColor, borderRadius: 4,
                      letterSpacing: "0.04em", fontFamily: "var(--font-dm-mono), monospace",
                    }}>
                      {cls}
                    </span>
                    {f.last_inspection_date && (
                      <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                        {f.last_inspection_date.slice(0, 7)}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          </Section>
        )}

        {/* Pricing snapshot */}
        {pricing.length > 0 && (
          <Section title="Pricing signals" icon={<Globe size={12} color="var(--teal)" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pricing.slice(0, 5).map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr 100px 80px", gap: 12, alignItems: "center", padding: "8px 10px", background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 6, fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>{FLAGS[p.country] ?? p.country}</span>
                  <span>{p.pack_description ?? "—"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", background: p.price_type === "concession" ? "var(--high-bg)" : "var(--app-bg)", color: p.price_type === "concession" ? "var(--high)" : "var(--app-text-3)", borderRadius: 3, textAlign: "center" }}>
                    {p.price_type.toUpperCase()}
                  </span>
                  <span style={{ fontWeight: 600, fontFamily: "var(--font-dm-mono), monospace", textAlign: "right" }}>
                    {p.currency} {p.pack_price?.toFixed(2) ?? "?"}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, color, bg, sub }: { label: string; value: string; color: string; bg: string; sub?: string }) {
  return (
    <div style={{ padding: 12, background: bg, borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "var(--font-dm-mono), monospace" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--app-text-4)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px dashed var(--app-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--teal)" }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function Pill({ children, green }: { children: React.ReactNode; green?: boolean }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 6px",
      background: green ? "var(--low-bg)" : "var(--teal-bg)",
      color: green ? "var(--low)" : "var(--teal)",
      borderRadius: 3, letterSpacing: "0.04em",
    }}>
      {children}
    </span>
  );
}
