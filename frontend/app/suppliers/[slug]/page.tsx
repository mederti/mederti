import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { ShieldCheck, Globe, Package, ExternalLink, Mail, Phone, ArrowLeft } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const admin = getSupabaseAdmin();
  const { data: supplier } = await admin
    .from("supplier_profiles")
    .select("company_name, description, countries_served")
    .eq("slug", slug)
    .maybeSingle();

  if (!supplier) {
    return { title: "Supplier not found — Mederti" };
  }

  const countriesText = ((supplier.countries_served as string[]) ?? []).slice(0, 5).join(", ");
  const title = `${supplier.company_name} — Pharmaceutical Wholesaler | Mederti`;
  const description =
    supplier.description ||
    `${supplier.company_name} is a registered pharmaceutical supplier${countriesText ? ` serving ${countriesText}` : ""}. View available stock, contact details, and request quotes.`;

  return {
    title,
    description,
    alternates: { canonical: `https://mederti.vercel.app/suppliers/${slug}` },
    openGraph: { title, description, url: `https://mederti.vercel.app/suppliers/${slug}`, type: "website" },
  };
}

interface InventoryItem {
  id: string;
  drug_id: string;
  drug_name: string;
  countries: string[];
  quantity_available: string | null;
  unit_price: number | null;
  currency: string;
  pack_size: string | null;
  notes: string | null;
  status: string;
  available_until: string | null;
}

interface SupplierDetail {
  id: string;
  slug: string;
  company_name: string;
  description: string | null;
  website: string | null;
  contact_email: string;
  contact_phone: string | null;
  countries_served: string[];
  verified: boolean;
  tier: string;
  year_founded: number | null;
  specialties: string[];
}

export default async function SupplierPublicProfilePage({ params }: Props) {
  const { slug } = await params;
  const admin = getSupabaseAdmin();

  const { data: supplier } = await admin
    .from("supplier_profiles")
    .select("id, slug, company_name, description, website, contact_email, contact_phone, countries_served, verified, tier, year_founded, specialties")
    .eq("slug", slug)
    .maybeSingle();

  if (!supplier) notFound();

  const s = supplier as SupplierDetail;

  // Inventory
  const { data: invRaw } = await admin
    .from("supplier_inventory")
    .select("id, drug_id, countries, quantity_available, unit_price, currency, pack_size, notes, status, available_until")
    .eq("supplier_id", s.id)
    .neq("status", "depleted")
    .order("updated_at", { ascending: false });

  const drugIds = (invRaw ?? []).map((i) => i.drug_id);
  const nameMap = new Map<string, string>();
  if (drugIds.length > 0) {
    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIds);
    for (const d of drugs ?? []) {
      nameMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  const inventory: InventoryItem[] = (invRaw ?? []).map((i) => ({
    ...i,
    drug_name: nameMap.get(i.drug_id) ?? "Unknown",
  }));

  const tierBadge: Record<string, { label: string; bg: string; color: string }> = {
    enterprise: { label: "ENTERPRISE", bg: "#E0E7FF", color: "#4338CA" },
    pro:        { label: "PRO",        bg: "var(--teal-bg)", color: "var(--teal)" },
    free:       { label: "",           bg: "", color: "" },
  };
  const tb = tierBadge[s.tier];

  // JSON-LD for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: s.company_name,
    description: s.description ?? undefined,
    url: `https://mederti.vercel.app/suppliers/${s.slug}`,
    email: s.contact_email,
    telephone: s.contact_phone ?? undefined,
    sameAs: s.website ? [s.website] : undefined,
    foundingDate: s.year_founded ? String(s.year_founded) : undefined,
    areaServed: s.countries_served,
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", display: "flex", flexDirection: "column" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteNav />

      {/* Back link */}
      <div style={{ borderBottom: "1px solid var(--app-border)", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "12px 24px" }}>
          <Link href="/suppliers/directory" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ArrowLeft size={13} /> Back to directory
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: "white", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
          {/* Badges */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {s.verified && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px",
                background: "var(--low-bg)", color: "var(--low)",
                borderRadius: 4, letterSpacing: "0.04em",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
                <ShieldCheck size={12} /> VERIFIED SUPPLIER
              </span>
            )}
            {tb && tb.label && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px",
                background: tb.bg, color: tb.color,
                borderRadius: 4, letterSpacing: "0.04em",
              }}>
                {tb.label}
              </span>
            )}
          </div>

          <h1 style={{ fontSize: "clamp(28px, 4vw, 38px)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", marginBottom: 12 }}>
            {s.company_name}
          </h1>

          {s.description && (
            <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.6, maxWidth: 720, marginBottom: 20 }}>
              {s.description}
            </p>
          )}

          {/* Meta row */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "var(--app-text-4)", marginBottom: 20 }}>
            {s.year_founded && <span><strong style={{ color: "var(--app-text)" }}>Est.</strong> {s.year_founded}</span>}
            <span>
              <strong style={{ color: "var(--app-text)" }}>{inventory.length}</strong> active stock listing{inventory.length === 1 ? "" : "s"}
            </span>
            <span>
              <strong style={{ color: "var(--app-text)" }}>{s.countries_served.length}</strong> countries served
            </span>
          </div>

          {/* Contact buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={`mailto:${s.contact_email}`}
              style={{
                padding: "10px 18px", fontSize: 14, fontWeight: 600,
                background: "var(--teal)", color: "white",
                borderRadius: 6, textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 8,
              }}
            >
              <Mail size={14} /> Contact supplier
            </a>
            {s.website && (
              <a
                href={s.website}
                target="_blank"
                rel="noopener"
                style={{
                  padding: "10px 18px", fontSize: 14, fontWeight: 600,
                  background: "white", color: "var(--app-text)",
                  border: "1px solid var(--app-border)",
                  borderRadius: 6, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <ExternalLink size={14} /> Website
              </a>
            )}
            {s.contact_phone && (
              <a
                href={`tel:${s.contact_phone}`}
                style={{
                  padding: "10px 18px", fontSize: 14, fontWeight: 600,
                  background: "white", color: "var(--app-text)",
                  border: "1px solid var(--app-border)",
                  borderRadius: 6, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <Phone size={14} /> {s.contact_phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, maxWidth: 1100, margin: "0 auto", padding: "32px 24px", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 32, alignItems: "flex-start" }}>
          {/* Inventory list */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 14 }}>
              Available stock ({inventory.length})
            </div>

            {inventory.length === 0 ? (
              <div style={{ padding: "60px 24px", textAlign: "center", background: "white", borderRadius: 10, border: "1px solid var(--app-border)" }}>
                <Package size={28} color="var(--app-text-4)" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>No active stock listings</div>
                <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
                  This supplier has not posted any current inventory.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {inventory.map((item) => (
                  <div key={item.id} style={{
                    padding: 16, background: "white", border: "1px solid var(--app-border)", borderRadius: 10,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
                      <Link href={`/drugs/${item.drug_id}`} style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", textDecoration: "none" }}>
                        {item.drug_name}
                      </Link>
                      {item.unit_price && (
                        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-dm-mono), monospace" }}>
                          {item.currency} {item.unit_price.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--app-text-4)", flexWrap: "wrap", marginBottom: item.notes ? 8 : 0 }}>
                      {item.quantity_available && <span>📦 {item.quantity_available}</span>}
                      {item.pack_size && <span>· {item.pack_size}</span>}
                      <span>· Available in {item.countries.length === 0 ? "global" : item.countries.map(c => FLAGS[c] ?? c).join(" ")}</span>
                    </div>
                    {item.notes && (
                      <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--app-border)", fontStyle: "italic" }}>
                        {item.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Countries served */}
            <div style={{ padding: 16, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 10 }}>
                Countries served
              </div>
              <div style={{ fontSize: 18, lineHeight: 1.6 }}>
                {s.countries_served.length === 0 ? "Global" : s.countries_served.map(c => FLAGS[c] ?? c).join(" ")}
              </div>
            </div>

            {/* Specialties */}
            {s.specialties && s.specialties.length > 0 && (
              <div style={{ padding: 16, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 10 }}>
                  Specialties
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {s.specialties.map(sp => (
                    <span key={sp} style={{
                      fontSize: 12, padding: "4px 10px",
                      background: "var(--app-bg)", color: "var(--app-text)",
                      border: "1px solid var(--app-border)", borderRadius: 4,
                    }}>
                      {sp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Trust block */}
            {s.verified && (
              <div style={{ padding: 16, background: "var(--low-bg)", border: "1px solid var(--low-b)", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--low)" }}>
                  <ShieldCheck size={16} />
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>VERIFIED BY MEDERTI</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.5 }}>
                  Wholesale licence and business registration verified. Updated quarterly.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
