"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Globe, Search, ExternalLink, Package } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Supplier {
  id: string;
  slug: string;
  company_name: string;
  description: string | null;
  website: string | null;
  countries_served: string[];
  verified: boolean;
  tier: string;
  year_founded: number | null;
  specialties: string[];
  inventory_count: number;
}

const TIER_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  enterprise: { label: "ENTERPRISE", bg: "#E0E7FF", color: "#4338CA" },
  pro:        { label: "PRO",        bg: "var(--teal-bg)", color: "var(--teal)" },
  free:       { label: "",           bg: "", color: "" },
};

export default function SupplierDirectoryClient() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (search) params.set("q", search);
    fetch(`/api/suppliers/directory?${params}`)
      .then(r => r.json())
      .then(d => setSuppliers(d.suppliers ?? []))
      .catch(() => setSuppliers([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [country, search]);

  const allCountries = Array.from(new Set(suppliers.flatMap(s => s.countries_served))).sort();

  return (
    <div style={{ flex: 1 }}>
      {/* Hero */}
      <div style={{ background: "white", borderBottom: "1px solid var(--app-border)", padding: "48px 24px 36px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 8 }}>
            Supplier directory
          </div>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 12 }}>
            Pharmaceutical wholesalers across 22 countries.
          </h1>
          <p style={{ fontSize: 16, color: "var(--app-text-3)", lineHeight: 1.5, maxWidth: 720, marginBottom: 28 }}>
            Browse verified suppliers and distributors. Filter by country to find wholesalers serving your market.
          </p>

          {/* Filter row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 280px" }}>
              <Search size={14} color="var(--app-text-4)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search supplier name…"
                style={{ width: "100%", padding: "10px 12px 10px 36px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)", boxSizing: "border-box" }}
              />
            </div>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              style={{ padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)", minWidth: 200 }}
            >
              <option value="">All countries</option>
              {allCountries.map(c => <option key={c} value={c}>{FLAGS[c] ?? c} {c}</option>)}
            </select>
            <Link
              href="/signup?role=supplier&next=/supplier-dashboard/profile"
              style={{
                padding: "10px 18px", fontSize: 13, fontWeight: 600,
                background: "var(--teal)", color: "white", borderRadius: 6,
                textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8,
              }}
            >
              List your company
            </Link>
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 16 }}>
          {loading ? "Loading…" : `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}${country ? ` in ${country}` : ""}`}
        </div>

        {!loading && suppliers.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center", background: "white", borderRadius: 10, border: "1px solid var(--app-border)" }}>
            <Package size={32} color="var(--app-text-4)" style={{ margin: "0 auto 14px" }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>No suppliers match your filters</div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
              Try a different country or search term.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
            {suppliers.map(s => {
              const tier = TIER_BADGE[s.tier];
              return (
                <Link
                  key={s.id}
                  href={`/suppliers/${s.slug}`}
                  style={{
                    display: "block", padding: 20, background: "white",
                    border: `1px solid ${s.verified ? "var(--low-b)" : "var(--app-border)"}`,
                    borderRadius: 12, textDecoration: "none", color: "inherit",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(15,23,42,0.08)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ""; }}
                >
                  {/* Top row: name + badges */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--app-text)", marginBottom: 4 }}>
                        {s.company_name}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {s.verified && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "3px 8px",
                            background: "var(--low-bg)", color: "var(--low)",
                            borderRadius: 4, letterSpacing: "0.04em",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                            <ShieldCheck size={11} /> VERIFIED
                          </span>
                        )}
                        {tier.label && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "3px 8px",
                            background: tier.bg, color: tier.color,
                            borderRadius: 4, letterSpacing: "0.04em",
                          }}>
                            {tier.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  {s.description && (
                    <p style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.5, margin: "8px 0 14px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {s.description}
                    </p>
                  )}

                  {/* Stats row */}
                  <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--app-text-4)", marginBottom: 12, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Package size={12} /> {s.inventory_count} listing{s.inventory_count === 1 ? "" : "s"}
                    </span>
                    {s.year_founded && <span>· Est. {s.year_founded}</span>}
                  </div>

                  {/* Countries */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, paddingTop: 10, borderTop: "1px dashed var(--app-border)" }}>
                    <Globe size={12} color="var(--app-text-4)" />
                    <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>Serves:</span>
                    <span>
                      {s.countries_served.length === 0 ? "Global" : s.countries_served.slice(0, 8).map(c => FLAGS[c] ?? c).join(" ")}
                      {s.countries_served.length > 8 && <span style={{ fontSize: 11, color: "var(--app-text-4)", marginLeft: 4 }}>+{s.countries_served.length - 8}</span>}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
