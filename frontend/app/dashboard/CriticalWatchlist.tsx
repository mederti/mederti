"use client";

import { useEffect, useState, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ShieldAlert } from "lucide-react";

const WATCHLIST = [
  "Amoxicillin",
  "Cisplatin",
  "Paracetamol IV",
  "Lithium Carbonate",
  "Atorvastatin",
  "Metformin",
  "Flucloxacillin",
  "Cefalexin",
  "Salbutamol",
  "Prednisolone",
  "Morphine",
  "Insulin (short-acting)",
  "Adrenaline (epinephrine)",
  "Co-amoxiclav",
  "Vancomycin",
];

// Search terms for flexible matching (lower-cased)
const SEARCH_TERMS: Record<string, string[]> = {
  Amoxicillin: ["amoxicillin"],
  Cisplatin: ["cisplatin"],
  "Paracetamol IV": ["paracetamol", "acetaminophen"],
  "Lithium Carbonate": ["lithium"],
  Atorvastatin: ["atorvastatin"],
  Metformin: ["metformin"],
  Flucloxacillin: ["flucloxacillin"],
  Cefalexin: ["cefalexin", "cephalexin"],
  Salbutamol: ["salbutamol", "albuterol"],
  Prednisolone: ["prednisolone"],
  Morphine: ["morphine"],
  "Insulin (short-acting)": ["insulin"],
  "Adrenaline (epinephrine)": ["adrenaline", "epinephrine"],
  "Co-amoxiclav": ["co-amoxiclav", "amoxicillin/clavulanate", "amoxicillin clavulanate"],
  Vancomycin: ["vancomycin"],
};

const SEV: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  critical: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "Critical" },
  high: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "High" },
  medium: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a", label: "Medium" },
  low: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "Low" },
  shortage: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "Shortage" },
  limited: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a", label: "Limited" },
  recalled: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "Recalled" },
  available: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "Available" },
};

interface WatchItem {
  name: string;
  worstStatus: string;
  worstSeverity: string;
  countriesAffected: number;
}

interface CriticalWatchlistProps {
  countryFilter?: string | null;
}

export default function CriticalWatchlist({ countryFilter }: CriticalWatchlistProps) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        const results: WatchItem[] = [];

        const { data: availData } = await supabase
          .from("drug_availability")
          .select("product_id, country, status, severity, drug_products(product_name)")
          .neq("status", "available");

        let shortageQ = supabase
          .from("shortage_events")
          .select("drug_id, country_code, severity, drugs(generic_name)")
          .eq("status", "active");

        if (countryFilter) {
          shortageQ = shortageQ.eq("country_code", countryFilter);
        }

        const { data: shortageData } = await shortageQ;

        for (const name of WATCHLIST) {
          const terms = SEARCH_TERMS[name] ?? [name.toLowerCase()];

          const matchedAvail = (availData ?? []).filter((a) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pName = ((a as any).drug_products?.product_name ?? "").toLowerCase();
            return terms.some((t) => pName.includes(t));
          });

          const matchedShortages = (shortageData ?? []).filter((s) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const gName = ((s as any).drugs?.generic_name ?? "").toLowerCase();
            return terms.some((t) => gName.includes(t));
          });

          const sevOrder = ["critical", "high", "medium", "low"];
          let worstSev = "available";
          let worstStatus = "available";
          const countries = new Set<string>();

          for (const a of matchedAvail) {
            const sev = (a.severity ?? a.status ?? "").toLowerCase();
            countries.add(a.country);
            if (sevOrder.indexOf(sev) >= 0 && (sevOrder.indexOf(sev) < sevOrder.indexOf(worstSev) || worstSev === "available")) {
              worstSev = sev;
              worstStatus = a.status;
            } else if (worstSev === "available" && a.status !== "available") {
              worstSev = a.status.toLowerCase();
              worstStatus = a.status;
            }
          }

          for (const s of matchedShortages) {
            const sev = (s.severity ?? "").toLowerCase();
            countries.add(s.country_code ?? "");
            if (sevOrder.indexOf(sev) >= 0 && (sevOrder.indexOf(sev) < sevOrder.indexOf(worstSev) || worstSev === "available")) {
              worstSev = sev;
              worstStatus = "active";
            }
          }

          results.push({
            name,
            worstStatus,
            worstSeverity: worstSev,
            countriesAffected: countries.size,
          });
        }

        setItems(results);
      } catch (err) {
        console.error("[CriticalWatchlist] load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [countryFilter]);

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
              background: "#eef2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldAlert
              style={{ width: 14, height: 14, strokeWidth: 1.5 }}
              color="#4f46e5"
            />
          </div>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}
          >
            Critical Medicines Watchlist
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
          }}
        >
          {WATCHLIST.length} medicines
        </span>
      </div>

      {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 100px 80px 80px",
          gap: 8,
          padding: "8px 20px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
        }}
      >
        {["Medicine", "Status", "Severity", "Countries"].map((h) => (
          <span
            key={h}
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#94a3b8",
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {loading ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Loading watchlist…
        </div>
      ) : (
        <div>
          {items.map((item, i) => {
            const sev = SEV[item.worstSeverity] ?? SEV.available;
            const isOk = item.worstSeverity === "available";
            return (
              <div
                key={item.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 80px 80px",
                  gap: 8,
                  padding: "10px 20px",
                  alignItems: "center",
                  borderBottom:
                    i < items.length - 1 ? "1px solid #f1f5f9" : "none",
                }}
              >
                {/* Name */}
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name}
                </div>

                {/* Status badge */}
                <div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: 20,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      background: isOk ? "#f0fdf4" : sev.bg,
                      color: isOk ? "#16a34a" : sev.color,
                      border: `1px solid ${isOk ? "#bbf7d0" : sev.border}`,
                    }}
                  >
                    {isOk ? "OK" : item.worstStatus}
                  </span>
                </div>

                {/* Severity dot */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: sev.color,
                      display: "inline-block",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: sev.color,
                      fontWeight: 500,
                    }}
                  >
                    {sev.label}
                  </span>
                </div>

                {/* Countries */}
                <div
                  style={{
                    fontSize: 12,
                    color: item.countriesAffected > 0 ? "#64748b" : "#94a3b8",
                    fontFamily: "var(--font-dm-mono), monospace",
                  }}
                >
                  {item.countriesAffected > 0
                    ? `${item.countriesAffected} ${item.countriesAffected === 1 ? "country" : "countries"}`
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
