"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Globe, Package, ExternalLink } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Supplier {
  inventory_id: string;
  supplier_id: string;
  company_name: string;
  website: string | null;
  verified: boolean;
  tier: string;
  countries: string[];
  quantity_available: string | null;
  unit_price: number | null;
  currency: string;
  pack_size: string | null;
  status: string;
  available_until: string | null;
  updated_at: string;
}

interface AvailableSuppliersProps {
  drugId: string;
  drugName: string;
}

export default function AvailableSuppliers({ drugId, drugName }: AvailableSuppliersProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/suppliers/by-drug/${drugId}`)
      .then(r => r.json())
      .then(d => setSuppliers(d.suppliers ?? []))
      .catch(() => setSuppliers([]))
      .finally(() => setLoading(false));
  }, [drugId]);

  if (loading || suppliers.length === 0) return null;

  return (
    <div style={{
      background: "var(--app-card)",
      border: "1px solid var(--app-border)",
      borderRadius: 12,
      padding: 20,
      marginTop: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Package size={16} color="var(--teal)" />
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--app-text-3)" }}>
          Available from {suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suppliers.map(s => (
          <div key={s.inventory_id} style={{
            padding: 14,
            background: "var(--app-bg)",
            border: `1px solid ${s.verified ? "var(--low-b)" : "var(--app-border)"}`,
            borderRadius: 8,
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 14,
            alignItems: "center",
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
                  {s.company_name}
                </span>
                {s.verified && (
                  <span title="Verified supplier" style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 6px",
                    background: "var(--low-bg)", color: "var(--low)",
                    borderRadius: 3, letterSpacing: "0.04em",
                  }}>
                    <ShieldCheck size={10} /> VERIFIED
                  </span>
                )}
                {s.tier === "pro" && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px",
                    background: "var(--teal-bg)", color: "var(--teal)",
                    borderRadius: 3, letterSpacing: "0.04em",
                  }}>PRO</span>
                )}
                {s.tier === "enterprise" && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px",
                    background: "#e0e7ff", color: "#4338ca",
                    borderRadius: 3, letterSpacing: "0.04em",
                  }}>ENTERPRISE</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--app-text-4)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {s.countries.length > 0 && (
                  <span><Globe size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    {s.countries.map(c => FLAGS[c] ?? c).join(" ")}
                  </span>
                )}
                {s.quantity_available && <span>• {s.quantity_available}</span>}
                {s.pack_size && <span>• {s.pack_size}</span>}
              </div>
            </div>

            {s.unit_price ? (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Price</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-dm-mono), monospace" }}>
                  {s.currency} {s.unit_price.toFixed(2)}
                </div>
              </div>
            ) : <div />}

            <div>
              {s.website ? (
                <a
                  href={s.website}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px", fontSize: 13, fontWeight: 600,
                    background: "var(--teal)", color: "white", borderRadius: 6,
                    textDecoration: "none",
                  }}
                >
                  Contact <ExternalLink size={12} />
                </a>
              ) : (
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Enquiry: ${drugName}`)}`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px", fontSize: 13, fontWeight: 600,
                    background: "var(--teal)", color: "white", borderRadius: 6,
                    textDecoration: "none",
                  }}
                >
                  Contact
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Become a supplier CTA */}
      <div style={{
        marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--app-border)",
        fontSize: 12, color: "var(--app-text-4)", textAlign: "center",
      }}>
        Are you a wholesaler? <a href="/suppliers" style={{ color: "var(--teal)", fontWeight: 600, textDecoration: "none" }}>List your stock free →</a>
      </div>
    </div>
  );
}
