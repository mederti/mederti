"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building, Globe, Package, CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";

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

const STEPS = [
  { id: 1, label: "Company", icon: <Building size={14} /> },
  { id: 2, label: "Territory", icon: <Globe size={14} /> },
  { id: 3, label: "First listing", icon: <Package size={14} /> },
  { id: 4, label: "Done", icon: <CheckCircle2 size={14} /> },
];

export default function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [yearFounded, setYearFounded] = useState("");

  // Step 2
  const [countries, setCountries] = useState<string[]>([]);

  // Step 3
  const [skipFirstListing, setSkipFirstListing] = useState(false);
  // (We just direct them to /supplier-dashboard/inventory after profile is saved)

  // Pre-load existing profile if any
  useEffect(() => {
    fetch("/api/supplier/profile")
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setCompanyName(d.profile.company_name ?? "");
          setContactEmail(d.profile.contact_email ?? "");
          setWebsite(d.profile.website ?? "");
          setYearFounded(d.profile.year_founded?.toString() ?? "");
          setCountries(d.profile.countries_served ?? []);
        }
      })
      .catch(() => {});
  }, []);

  function toggleCountry(code: string) {
    setCountries(c => c.includes(code) ? c.filter(x => x !== code) : [...c, code]);
  }

  async function saveProfile() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/supplier/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          contact_email: contactEmail,
          website: website || null,
          year_founded: yearFounded ? Number(yearFounded) : null,
          countries_served: countries,
        }),
      });
      return res.ok;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (step === 2) {
      const ok = await saveProfile();
      if (ok) setStep(3);
    } else if (step === 3) {
      // Mark onboarded and exit
      await fetch("/api/supplier/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          contact_email: contactEmail,
        }),
      });
      setStep(4);
    } else {
      setStep(step + 1);
    }
  }

  function step1Valid() {
    return companyName.trim().length > 1 && contactEmail.trim().includes("@");
  }
  function step2Valid() {
    return countries.length > 0;
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      {/* Progress */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {STEPS.map((s, i) => {
            const active = step === s.id;
            const done = step > s.id;
            return (
              <div key={s.id} style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--low)" : active ? "var(--teal)" : "var(--app-bg)",
                  color: done || active ? "white" : "var(--app-text-4)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  border: `1px solid ${done ? "var(--low)" : active ? "var(--teal)" : "var(--app-border)"}`,
                }}>
                  {done ? <CheckCircle2 size={14} /> : s.id}
                </div>
                <span style={{
                  marginLeft: 8, fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? "var(--app-text)" : "var(--app-text-4)",
                  flexShrink: 0,
                }}>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, margin: "0 12px", background: done ? "var(--low)" : "var(--app-border)" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid var(--app-border)", padding: 32 }}>
        {/* STEP 1 — Company */}
        {step === 1 && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Tell us about your company</h1>
            <p style={{ fontSize: 14, color: "var(--app-text-4)", marginBottom: 28 }}>
              This appears on your public profile and on drug pages where buyers see your stock.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label="Company name *" >
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Sigma Pharmaceuticals"
                  style={inputStyle}
                />
              </Field>
              <Field label="Contact email *">
                <input
                  type="email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="orders@yourcompany.com"
                  style={inputStyle}
                />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
                <Field label="Website (optional)">
                  <input
                    type="url"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    placeholder="https://yourcompany.com"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Year founded">
                  <input
                    type="number"
                    value={yearFounded}
                    onChange={e => setYearFounded(e.target.value)}
                    placeholder="2010"
                    style={inputStyle}
                  />
                </Field>
              </div>
            </div>
          </>
        )}

        {/* STEP 2 — Territory */}
        {step === 2 && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Which countries do you supply?</h1>
            <p style={{ fontSize: 14, color: "var(--app-text-4)", marginBottom: 24 }}>
              You'll receive enquiries from buyers in these countries. Select at least one.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {COUNTRIES.map(c => {
                const active = countries.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggleCountry(c.code)}
                    style={{
                      padding: "10px 12px", fontSize: 13, textAlign: "left",
                      background: active ? "var(--teal-bg)" : "white",
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
            {countries.length > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: "var(--app-bg)", borderRadius: 8, fontSize: 13, color: "var(--app-text-3)" }}>
                You've selected <strong style={{ color: "var(--app-text)" }}>{countries.length}</strong> countr{countries.length === 1 ? "y" : "ies"}. We'll notify you when buyers in {countries.length === 1 ? "this market" : "these markets"} submit enquiries.
              </div>
            )}
          </>
        )}

        {/* STEP 3 — First listing */}
        {step === 3 && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Add your first stock listing</h1>
            <p style={{ fontSize: 14, color: "var(--app-text-4)", marginBottom: 24 }}>
              Listings appear on shortage pages where buyers find you. You can add one now or upload your full inventory later.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Link
                href="/supplier-dashboard/inventory"
                style={{
                  padding: 18, background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
                  borderRadius: 10, textDecoration: "none", color: "var(--app-text)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Add a single listing</div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>Pick a drug, set quantity and price.</div>
                </div>
                <ArrowRight size={16} color="var(--teal)" />
              </Link>
              <Link
                href="/supplier-dashboard/inventory"
                style={{
                  padding: 18, background: "white", border: "1px solid var(--app-border)",
                  borderRadius: 10, textDecoration: "none", color: "var(--app-text)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Bulk import a CSV</div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>Upload up to 500 SKUs at once.</div>
                </div>
                <ArrowRight size={16} color="var(--teal)" />
              </Link>
              <button
                onClick={handleNext}
                style={{
                  padding: "10px 16px", fontSize: 13, fontWeight: 500,
                  background: "transparent", color: "var(--app-text-4)",
                  border: "none", cursor: "pointer", textAlign: "left",
                }}
              >
                Skip for now →
              </button>
            </div>
          </>
        )}

        {/* STEP 4 — Done */}
        {step === 4 && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <CheckCircle2 size={56} color="var(--low)" style={{ margin: "0 auto 16px" }} />
            <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 10 }}>You're set up.</h1>
            <p style={{ fontSize: 15, color: "var(--app-text-4)", maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.6 }}>
              Buyer enquiries from {countries.length === 0 ? "global markets" : countries.length === 1 ? countries[0] : `${countries.length} countries`} will land in your inbox in real time. We'll email you when a new one arrives.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360, margin: "0 auto" }}>
              <Link href="/supplier-dashboard/inbox" style={{ padding: "12px 24px", background: "var(--teal)", color: "white", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                Open inbox
              </Link>
              <Link href="/supplier-dashboard" style={{ padding: "12px 24px", background: "white", color: "var(--app-text)", border: "1px solid var(--app-border)", borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
                Go to dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Footer nav */}
        {step < 4 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--app-border)" }}>
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500, background: "white", color: "var(--app-text)", border: "1px solid var(--app-border)", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ArrowLeft size={13} /> Back
              </button>
            ) : <div />}
            <button
              onClick={handleNext}
              disabled={
                submitting ||
                (step === 1 && !step1Valid()) ||
                (step === 2 && !step2Valid())
              }
              style={{
                padding: "10px 20px", fontSize: 13, fontWeight: 600,
                background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                cursor: submitting ? "wait" : "pointer",
                opacity: ((step === 1 && !step1Valid()) || (step === 2 && !step2Valid())) ? 0.5 : 1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {submitting ? "Saving…" : step === 3 ? "Finish" : "Next"} <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 14,
  border: "1px solid var(--app-border)", borderRadius: 6,
  background: "white", color: "var(--app-text)",
  outline: "none", boxSizing: "border-box",
};
