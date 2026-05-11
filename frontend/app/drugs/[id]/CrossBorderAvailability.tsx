"use client";

import { useEffect, useState } from "react";
import { Globe2, Building2 } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU:"🇦🇺", GB:"🇬🇧", US:"🇺🇸", CA:"🇨🇦", EU:"🇪🇺", NZ:"🇳🇿", IE:"🇮🇪",
  DE:"🇩🇪", FR:"🇫🇷", IT:"🇮🇹", ES:"🇪🇸", NL:"🇳🇱", BE:"🇧🇪", SE:"🇸🇪",
  DK:"🇩🇰", FI:"🇫🇮", NO:"🇳🇴", CH:"🇨🇭", AT:"🇦🇹", JP:"🇯🇵", SG:"🇸🇬",
  IN:"🇮🇳", AE:"🇦🇪",
};

interface Sponsor {
  name: string;
  products: number;
}

interface Country {
  code: string;
  name: string;
  total_products: number;
  active_products: number;
  top_sponsors: Sponsor[];
  brand_examples: string[];
  source_name: string | null;
}

interface GlobalSponsor {
  name: string;
  products: number;
  countries: string[];
}

interface AvailabilityData {
  drug_id: string;
  drug_name: string;
  total_countries: number;
  total_products: number;
  countries: Country[];
  top_global_sponsors: GlobalSponsor[];
  coverage_note: string;
}

export default function CrossBorderAvailability({ drugId }: { drugId: string }) {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/drugs/${drugId}/availability`)
      .then((r) => r.json())
      .then((d) => setData(d?.countries ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [drugId]);

  if (loading || !data || data.countries.length === 0) return null;

  return (
    <section style={{ marginTop: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          fontSize: 12, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.07em", color: "var(--app-text-3)",
        }}>
          Available elsewhere
        </span>
        <span style={{
          fontSize: 11, color: "var(--app-text-4)",
          fontFamily: "var(--font-dm-mono), monospace",
        }}>
          {data.total_countries} countr{data.total_countries === 1 ? "y" : "ies"} · {data.total_products.toLocaleString()} registration{data.total_products === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{
        background: "#fff", border: "1px solid var(--app-border)",
        borderRadius: 12, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--app-bg-2)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <Globe2 size={14} color="var(--teal)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>
            Where {data.drug_name} is registered
          </span>
        </div>

        {/* Country list */}
        <div>
          {data.countries.map((c) => (
            <CountryRow key={c.code} country={c} />
          ))}
        </div>

        {/* Footer note + global MAH summary */}
        {data.top_global_sponsors.length > 0 && (
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--app-bg-2)",
            background: "var(--app-bg)",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
            }}>
              <Building2 size={12} color="var(--app-text-3)" />
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--app-text-3)",
              }}>
                Top marketing-authorisation holders
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.top_global_sponsors.slice(0, 6).map((s) => (
                <span key={s.name} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 10px",
                  background: "#fff", border: "1px solid var(--app-border)",
                  borderRadius: 999, fontSize: 11.5,
                  color: "var(--app-text)",
                }}>
                  <span style={{ fontWeight: 500 }}>{s.name}</span>
                  <span style={{
                    fontFamily: "var(--font-dm-mono), monospace",
                    color: "var(--app-text-4)",
                  }}>
                    {s.countries.map((cc) => FLAGS[cc] ?? cc).join(" ")}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Coverage caveat */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid var(--app-bg-2)",
          background: "var(--app-bg)",
          fontSize: 11, color: "var(--app-text-4)", lineHeight: 1.5,
        }}>
          {data.coverage_note}
        </div>
      </div>
    </section>
  );
}

function CountryRow({ country }: { country: Country }) {
  const [expanded, setExpanded] = useState(false);
  const flag = FLAGS[country.code] ?? "🌐";

  return (
    <div style={{ borderBottom: "1px solid var(--app-bg-2)" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", display: "grid",
          gridTemplateColumns: "32px 1fr auto auto",
          gap: 12, alignItems: "center",
          padding: "12px 20px",
          background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
          fontFamily: "var(--font-inter), sans-serif",
        }}
      >
        <span style={{ fontSize: 18 }}>{flag}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--app-text)" }}>
            {country.name}
          </div>
          {country.top_sponsors.length > 0 && (
            <div style={{
              fontSize: 11.5, color: "var(--app-text-4)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              marginTop: 1,
            }}>
              {country.top_sponsors.slice(0, 2).map((s) => s.name).join(", ")}
              {country.top_sponsors.length > 2 && ` +${country.top_sponsors.length - 2} more`}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 12, fontFamily: "var(--font-dm-mono), monospace",
          color: "var(--app-text-3)",
        }}>
          {country.active_products.toLocaleString()}
          <span style={{ color: "var(--app-text-4)" }}> active</span>
        </span>
        <span style={{
          fontSize: 11, color: "var(--app-text-4)",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 0.15s",
        }}>
          ▶
        </span>
      </button>

      {expanded && (
        <div style={{
          padding: "0 20px 14px 64px",
          fontSize: 12, color: "var(--app-text-3)",
          lineHeight: 1.55,
        }}>
          {country.top_sponsors.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--app-text-4)", marginBottom: 6,
              }}>
                Marketing-authorisation holders
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {country.top_sponsors.map((s) => (
                  <div key={s.name} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: 12.5, color: "var(--app-text)",
                  }}>
                    <span>{s.name}</span>
                    <span style={{
                      fontFamily: "var(--font-dm-mono), monospace",
                      color: "var(--app-text-4)", fontSize: 11,
                    }}>
                      {s.products} product{s.products === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {country.brand_examples.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--app-text-4)", marginBottom: 6,
              }}>
                Brand examples
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {country.brand_examples.map((b) => (
                  <span key={b} style={{
                    fontSize: 11.5, padding: "3px 8px",
                    background: "var(--app-bg)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 999, color: "var(--app-text)",
                  }}>
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {country.source_name && (
            <div style={{
              fontSize: 10.5, color: "var(--app-text-4)",
              marginTop: 8,
              fontFamily: "var(--font-dm-mono), monospace",
            }}>
              Source: {country.source_name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
