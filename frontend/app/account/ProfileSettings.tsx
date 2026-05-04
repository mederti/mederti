"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

// Mirrors migration 025 enums + onboarding/page.tsx
const ROLES: Array<{ value: string; label: string }> = [
  { value: "hospital_pharmacist",  label: "Hospital pharmacist or clinician" },
  { value: "community_pharmacist", label: "Community pharmacist" },
  { value: "hospital_procurement", label: "Hospital procurement / supply chain" },
  { value: "wholesaler",           label: "Wholesaler / distributor" },
  { value: "manufacturer",         label: "Pharma manufacturer or supplier" },
  { value: "government",           label: "Government / regulator / health system" },
  { value: "researcher",           label: "Researcher / journalist / analyst" },
  { value: "other",                label: "Something else" },
];

const USE_CASES: Array<{ value: string; label: string }> = [
  { value: "find_alternative", label: "Find alternatives for short drugs" },
  { value: "plan_ahead",       label: "Plan ahead for likely shortages" },
  { value: "sell_or_source",   label: "Source or supply medicines" },
  { value: "analyse_market",   label: "Track the industry for analysis" },
  { value: "just_exploring",   label: "Just exploring" },
];

const ORG_SIZES: Array<{ value: string; label: string }> = [
  { value: "just_me",   label: "Just me" },
  { value: "2_10",      label: "2 – 10" },
  { value: "11_50",     label: "11 – 50" },
  { value: "51_250",    label: "51 – 250" },
  { value: "251_1000",  label: "251 – 1k" },
  { value: "1000_plus", label: "1k+" },
];

const COUNTRIES: Array<{ code: string; name: string; flag: string }> = [
  { code: "AU", name: "Australia",       flag: "🇦🇺" },
  { code: "GB", name: "United Kingdom",  flag: "🇬🇧" },
  { code: "US", name: "United States",   flag: "🇺🇸" },
  { code: "CA", name: "Canada",          flag: "🇨🇦" },
  { code: "DE", name: "Germany",         flag: "🇩🇪" },
  { code: "FR", name: "France",          flag: "🇫🇷" },
  { code: "IT", name: "Italy",           flag: "🇮🇹" },
  { code: "ES", name: "Spain",           flag: "🇪🇸" },
  { code: "NZ", name: "New Zealand",     flag: "🇳🇿" },
  { code: "IE", name: "Ireland",         flag: "🇮🇪" },
  { code: "NL", name: "Netherlands",     flag: "🇳🇱" },
  { code: "BE", name: "Belgium",         flag: "🇧🇪" },
  { code: "SG", name: "Singapore",       flag: "🇸🇬" },
  { code: "JP", name: "Japan",           flag: "🇯🇵" },
  { code: "IN", name: "India",           flag: "🇮🇳" },
  { code: "AE", name: "UAE",             flag: "🇦🇪" },
];

const THERAPY_AREAS: Array<{ value: string; label: string }> = [
  { value: "oncology",                 label: "Oncology" },
  { value: "cardiovascular_metabolic", label: "Cardiovascular / metabolic" },
  { value: "anti_infectives",          label: "Anti-infectives" },
  { value: "cns_mental_health",        label: "CNS / mental health" },
  { value: "respiratory",              label: "Respiratory" },
  { value: "anaesthesia_critical_care",label: "Anaesthesia / critical care" },
  { value: "endocrine_hormones",       label: "Endocrine / hormones" },
  { value: "other",                    label: "Other" },
];

interface Profile {
  role: string | null;
  countries: string[] | null;
  use_case: string | null;
  org_size: string | null;
  therapy_areas: string[] | null;
}

export default function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const [role, setRole]                 = useState<string>("");
  const [countries, setCountries]       = useState<string[]>([]);
  const [useCase, setUseCase]           = useState<string>("");
  const [orgSize, setOrgSize]           = useState<string>("");
  const [therapyAreas, setTherapyAreas] = useState<string[]>([]);

  // Load
  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((d) => {
        const p = d?.profile as Profile | null;
        if (p) {
          setRole(p.role ?? "");
          setCountries(p.countries ?? []);
          setUseCase(p.use_case ?? "");
          setOrgSize(p.org_size ?? "");
          setTherapyAreas(p.therapy_areas ?? []);
          // If only legacy columns came back, the migration isn't applied
          if (p && !("countries" in p)) {
            setWarn("Some profile fields aren't enabled yet on this server. Changes you make may not stick until your admin applies the latest migration.");
          }
        }
      })
      .catch(() => setErr("Could not load your profile."))
      .finally(() => setLoading(false));
  }, []);

  function toggleCountry(code: string) {
    setCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code].slice(0, 5)
    );
  }
  function toggleTherapy(v: string) {
    setTherapyAreas((prev) =>
      prev.includes(v) ? prev.filter((c) => c !== v) : [...prev, v].slice(0, 8)
    );
  }

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const r = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role || undefined,
          countries,
          use_case: useCase || null,
          org_size: orgSize || null,
          therapy_areas: therapyAreas,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not save");
      // Quietly tell the user if the schema isn't up to date
      if (d.schema_full === false) {
        setWarn("Saved — but new profiling fields aren't enabled on this server yet. Some answers may not have stuck.");
      } else {
        setWarn(null);
      }
      // Push the country cookie so server components pick up the new default
      if (countries[0]) {
        document.cookie = `mederti-country=${countries[0]}; path=/; max-age=${60 * 60 * 24 * 365}`;
      }
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Card><div style={{ padding: "20px 0", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div></Card>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {warn && <WarnBox msg={warn} />}
      {err && <ErrBox msg={err} />}

      <Card title="Role" sub="Drives which dashboards land first when you sign in.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {ROLES.map((r) => (
            <SelectButton key={r.value} label={r.label} selected={role === r.value} onClick={() => setRole(r.value)} />
          ))}
        </div>
      </Card>

      <Card title="Countries" sub="Defaults the shortage feed and regulatory calendar. Pick up to five.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {COUNTRIES.map((c) => {
            const sel = countries.includes(c.code);
            return (
              <button key={c.code} type="button" onClick={() => toggleCountry(c.code)}
                style={selectStyle(sel)}>
                <span style={{ fontSize: 16 }}>{c.flag}</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                {sel && <Check size={14} color="var(--teal)" />}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Primary use case" sub="What you most often use Mederti for.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {USE_CASES.map((u) => (
            <SelectButton key={u.value} label={u.label} selected={useCase === u.value} onClick={() => setUseCase(u.value)} />
          ))}
        </div>
      </Card>

      <Card title="Organisation size">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {ORG_SIZES.map((o) => (
            <SelectButton key={o.value} label={o.label} selected={orgSize === o.value} onClick={() => setOrgSize(o.value)} centered />
          ))}
        </div>
      </Card>

      <Card title="Therapy areas" sub="Used to seed your watchlist and personalise drug-foresight scope.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {THERAPY_AREAS.map((t) => {
            const sel = therapyAreas.includes(t.value);
            return (
              <button key={t.value} type="button" onClick={() => toggleTherapy(t.value)}
                style={selectStyle(sel)}>
                <span style={{ flex: 1 }}>{t.label}</span>
                {sel && <Check size={14} color="var(--teal)" />}
              </button>
            );
          })}
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {savedAt && (
          <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 500 }}>
            Saved {new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: "10px 22px", background: "var(--teal)",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 13.5, fontWeight: 600,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
            fontFamily: "var(--font-inter), sans-serif",
          }}
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "20px 24px" }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", marginBottom: sub ? 4 : 14 }}>{title}</div>}
      {sub && <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 14 }}>{sub}</div>}
      {children}
    </div>
  );
}

function selectStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px",
    background: selected ? "var(--teal-bg, rgba(13,148,136,0.08))" : "#fff",
    border: `1px solid ${selected ? "var(--teal)" : "var(--app-border)"}`,
    borderRadius: 10, cursor: "pointer",
    fontFamily: "var(--font-inter), sans-serif",
    fontSize: 13.5, color: "var(--app-text)", textAlign: "left",
    transition: "all 0.12s",
  };
}

function SelectButton({ label, selected, onClick, centered }: {
  label: string; selected: boolean; onClick: () => void; centered?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      style={{ ...selectStyle(selected), justifyContent: centered ? "center" : "flex-start", textAlign: centered ? "center" : "left" }}>
      <span style={{ flex: centered ? "initial" : 1 }}>{label}</span>
      {selected && !centered && <Check size={14} color="var(--teal)" />}
    </button>
  );
}

function WarnBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--amber-bg, #fef3c7)", border: "1px solid var(--amber-b, #fde68a)",
      borderRadius: 10, padding: "10px 14px", color: "var(--amber, #92400e)", fontSize: 13,
    }}>{msg}</div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--crit-bg, #fef2f2)", border: "1px solid var(--crit-b, #fecaca)",
      borderRadius: 10, padding: "10px 14px", color: "var(--crit, #dc2626)", fontSize: 13,
    }}>{msg}</div>
  );
}
