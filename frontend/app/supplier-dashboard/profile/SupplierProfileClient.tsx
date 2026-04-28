"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building, Globe, Save, CheckCircle2, ShieldCheck } from "lucide-react";

const COUNTRIES = [
  { code: "AU", name: "Australia" }, { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" }, { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "IT", name: "Italy" }, { code: "ES", name: "Spain" },
  { code: "NZ", name: "New Zealand" }, { code: "SG", name: "Singapore" },
  { code: "IE", name: "Ireland" }, { code: "NO", name: "Norway" },
  { code: "FI", name: "Finland" }, { code: "CH", name: "Switzerland" },
  { code: "BE", name: "Belgium" }, { code: "NL", name: "Netherlands" },
  { code: "JP", name: "Japan" }, { code: "PT", name: "Portugal" },
  { code: "GR", name: "Greece" }, { code: "MY", name: "Malaysia" },
  { code: "AE", name: "UAE" }, { code: "EU", name: "EU (centrally)" },
];

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭", BE: "🇧🇪",
  NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Profile {
  id: string;
  company_name: string;
  contact_email: string;
  contact_phone: string | null;
  website: string | null;
  countries_served: string[];
  description: string | null;
  verified: boolean;
  tier: string;
}

export default function SupplierProfileClient() {
  const router = useRouter();
  const [profile, setProfile] = useState<Partial<Profile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/supplier/profile")
      .then(r => r.json())
      .then(d => setProfile(d.profile ?? { countries_served: [] }))
      .catch(() => setProfile({ countries_served: [] }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>Loading…</div>;
  }

  function toggleCountry(code: string) {
    setProfile(p => {
      const cur = (p?.countries_served as string[]) ?? [];
      const next = cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code];
      return { ...(p ?? {}), countries_served: next };
    });
  }

  async function save() {
    if (!profile?.company_name) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/supplier/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  const isExisting = !!profile?.id;
  const selected = (profile?.countries_served as string[]) ?? [];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
          Supplier Dashboard
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          {isExisting ? "Update profile" : "Set up your supplier profile"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--app-text-4)", lineHeight: 1.6 }}>
          Your profile controls which buyer enquiries you see and how you appear on drug pages when you broadcast inventory.
        </p>
      </div>

      {profile?.verified && (
        <div style={{ padding: "12px 16px", marginBottom: 20, background: "var(--low-bg)", border: "1px solid var(--low-b)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--low)" }}>
          <ShieldCheck size={16} /><strong>Verified supplier</strong> — you appear first on drug pages.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 24, background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 12 }}>
        {/* Company name */}
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Company name <span style={{ color: "var(--crit)" }}>*</span>
          </label>
          <input
            type="text"
            value={profile?.company_name ?? ""}
            onChange={e => setProfile(p => ({ ...(p ?? {}), company_name: e.target.value }))}
            placeholder="e.g. Barwon Pharma Pty Ltd"
            style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
          />
        </div>

        {/* Contact email */}
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Contact email
          </label>
          <input
            type="email"
            value={profile?.contact_email ?? ""}
            onChange={e => setProfile(p => ({ ...(p ?? {}), contact_email: e.target.value }))}
            placeholder="orders@yourcompany.com"
            style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
          />
        </div>

        {/* Phone + Website */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Phone
            </label>
            <input
              type="tel"
              value={profile?.contact_phone ?? ""}
              onChange={e => setProfile(p => ({ ...(p ?? {}), contact_phone: e.target.value }))}
              placeholder="+61 3 ..."
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Website
            </label>
            <input
              type="url"
              value={profile?.website ?? ""}
              onChange={e => setProfile(p => ({ ...(p ?? {}), website: e.target.value }))}
              placeholder="https://yourcompany.com"
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)" }}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            About your business
          </label>
          <textarea
            value={profile?.description ?? ""}
            onChange={e => setProfile(p => ({ ...(p ?? {}), description: e.target.value }))}
            placeholder="Brief description shown on your supplier profile."
            rows={3}
            style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--app-border)", borderRadius: 6, background: "var(--app-bg)", color: "var(--app-text)", resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        {/* Countries served */}
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Countries you supply
          </label>
          <div style={{ fontSize: 12, color: "var(--app-text-4)", marginBottom: 10 }}>
            You'll receive enquiries from buyers in these countries. Leave empty for global.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
            {COUNTRIES.map(c => {
              const active = selected.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCountry(c.code)}
                  style={{
                    padding: "8px 10px", fontSize: 13, textAlign: "left",
                    background: active ? "var(--teal-bg)" : "var(--app-bg)",
                    border: `1px solid ${active ? "var(--teal-b)" : "var(--app-border)"}`,
                    borderRadius: 6, cursor: "pointer",
                    color: active ? "var(--teal)" : "var(--app-text)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {FLAGS[c.code]} {c.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div>
            {saved && (
              <span style={{ fontSize: 13, color: "var(--low)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
          </div>
          <button
            onClick={save}
            disabled={saving || !profile?.company_name}
            style={{
              padding: "10px 20px", fontSize: 14, fontWeight: 600,
              background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
              cursor: profile?.company_name ? "pointer" : "not-allowed",
              opacity: profile?.company_name ? 1 : 0.5,
              display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            <Save size={14} /> {saving ? "Saving…" : isExisting ? "Update profile" : "Create profile"}
          </button>
        </div>
      </div>

      {/* Next steps */}
      {isExisting && (
        <div style={{ marginTop: 24, padding: 20, background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Next steps</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <a href="/supplier-dashboard/inventory" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
              → Add drugs you have in stock
            </a>
            <a href="/supplier-dashboard/inbox" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
              → View buyer enquiry inbox
            </a>
            <a href="/supplier-dashboard" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
              → Browse supply opportunities
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
