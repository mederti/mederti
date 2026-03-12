"use client";

import { useState, useRef, useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Search, X, Loader2 } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}",
  US: "\u{1F1FA}\u{1F1F8}",
  GB: "\u{1F1EC}\u{1F1E7}",
  CA: "\u{1F1E8}\u{1F1E6}",
  DE: "\u{1F1E9}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}",
  IT: "\u{1F1EE}\u{1F1F9}",
  NZ: "\u{1F1F3}\u{1F1FF}",
  EU: "\u{1F1EA}\u{1F1FA}",
  FI: "\u{1F1EB}\u{1F1EE}",
};

const SEV: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  high: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  medium: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a" },
  low: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  shortage: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  available: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  limited: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a" },
  recalled: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
};

interface DrugResult {
  id: string;
  name: string;
  source: "drugs" | "drug_products";
  brands: string[];
  availability: { country: string; status: string; severity: string | null }[];
}

export default function MedicineSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const supabase = sbRef.current;

      async function search() {
        try {
          setLoading(true);
          const term = `%${query.toLowerCase()}%`;

          const [drugsRes, productsRes] = await Promise.allSettled([
            supabase
              .from("drugs")
              .select("id, generic_name, brand_names")
              .ilike("generic_name", term)
              .limit(8),
            supabase
              .from("drug_products")
              .select("id, product_name, trade_name, country, source")
              .ilike("product_name", term)
              .limit(8),
          ]);

          console.log("[MedicineSearch] drugsRes:", drugsRes, "productsRes:", productsRes);

          const combined: DrugResult[] = [];

          if (drugsRes.status === "fulfilled" && drugsRes.value.data) {
            const drugIds = drugsRes.value.data.map((d) => d.id);
            const { data: shortages } =
              drugIds.length > 0
                ? await supabase
                    .from("shortage_events")
                    .select("drug_id, country_code, status, severity")
                    .in("drug_id", drugIds)
                    .eq("status", "active")
                : { data: [] };

            for (const d of drugsRes.value.data) {
              const drugShortages = (shortages ?? []).filter(
                (s) => s.drug_id === d.id
              );
              combined.push({
                id: d.id,
                name: d.generic_name,
                source: "drugs",
                brands: d.brand_names ?? [],
                availability: drugShortages.map((s) => ({
                  country: s.country_code ?? "",
                  status: s.status,
                  severity: s.severity,
                })),
              });
            }
          }

          if (productsRes.status === "fulfilled" && productsRes.value.data) {
            const productIds = productsRes.value.data.map((p) => p.id);
            const { data: avail } =
              productIds.length > 0
                ? await supabase
                    .from("drug_availability")
                    .select("product_id, country, status, severity")
                    .in("product_id", productIds)
                    .neq("status", "available")
                : { data: [] };

            for (const p of productsRes.value.data) {
              if (
                combined.some(
                  (c) =>
                    c.name.toLowerCase() === p.product_name.toLowerCase()
                )
              )
                continue;
              const prodAvail = (avail ?? []).filter(
                (a) => a.product_id === p.id
              );
              combined.push({
                id: p.id,
                name: p.product_name,
                source: "drug_products",
                brands: p.trade_name ? [p.trade_name] : [],
                availability: prodAvail.map((a) => ({
                  country: a.country ?? "",
                  status: a.status,
                  severity: a.severity,
                })),
              });
            }
          }

          setResults(combined.slice(0, 10));
          setLoading(false);
        } catch (err) {
          console.error("[MedicineSearch] search error:", err);
          setLoading(false);
        }
      }

      search();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "rgba(13,148,136,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Search
              style={{ width: 14, height: 14, strokeWidth: 1.5 }}
              color="#0d9488"
            />
          </div>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}
          >
            Medicine Search
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
          }}
        >
          drug_products + drugs
        </span>
      </div>

      {/* Search input */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ position: "relative" }}>
          <Search
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 16,
              height: 16,
              strokeWidth: 1.5,
              color: "#94a3b8",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            placeholder="Search by drug name or active ingredient…"
            style={{
              width: "100%",
              padding: "10px 36px 10px 38px",
              borderRadius: 8,
              border: `1.5px solid ${focused ? "#0d9488" : "#e2e8f0"}`,
              fontSize: 14,
              color: "#0f172a",
              background: "#f8fafc",
              outline: "none",
              fontFamily: "var(--font-inter), sans-serif",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X
                style={{ width: 14, height: 14, strokeWidth: 1.5 }}
                color="#94a3b8"
              />
            </button>
          )}
          {loading && (
            <Loader2
              style={{
                position: "absolute",
                right: query ? 30 : 10,
                top: "50%",
                transform: "translateY(-50%)",
                width: 14,
                height: 14,
                strokeWidth: 2,
                color: "#0d9488",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div>
          {results.map((r, i) => (
            <Link
              key={`${r.source}-${r.id}`}
              href={r.source === "drugs" ? `/drugs/${r.id}` : `/search?q=${encodeURIComponent(r.name)}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderBottom:
                  i < results.length - 1 ? "1px solid #f1f5f9" : "none",
                textDecoration: "none",
                transition: "background 0.1s",
              }}
              className="db-search-row"
            >
              {/* Drug name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </div>
                {r.brands.length > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#94a3b8",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.brands.slice(0, 2).join(", ")}
                  </div>
                )}
              </div>

              {/* Availability flags */}
              {r.availability.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  {r.availability.slice(0, 4).map((a, j) => {
                    const s =
                      SEV[(a.severity ?? a.status).toLowerCase()] ?? SEV.low;
                    return (
                      <div
                        key={j}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                          padding: "2px 7px",
                          borderRadius: 6,
                          background: s.bg,
                          border: `1px solid ${s.border}`,
                        }}
                      >
                        <span style={{ fontSize: 13 }}>
                          {FLAGS[a.country] ?? "\u{1F310}"}
                        </span>
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: s.color,
                          }}
                        />
                      </div>
                    );
                  })}
                  {r.availability.length > 4 && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        fontFamily: "var(--font-dm-mono), monospace",
                      }}
                    >
                      +{r.availability.length - 4}
                    </span>
                  )}
                </div>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    color: "#16a34a",
                    fontWeight: 500,
                    padding: "3px 8px",
                    borderRadius: 20,
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                  }}
                >
                  Available
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <div
          style={{
            padding: "28px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          No medicines found for &ldquo;{query}&rdquo;
        </div>
      )}

      <style>{`
        .db-search-row:hover { background: #f8fafc !important; }
        @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </div>
  );
}
