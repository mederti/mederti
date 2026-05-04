"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import SiteNav from "@/app/components/landing-nav";

// ─── Question definitions ────────────────────────────────────────────────────

type Role =
  | "hospital_pharmacist"
  | "community_pharmacist"
  | "hospital_procurement"
  | "wholesaler"
  | "manufacturer"
  | "government"
  | "researcher"
  | "other";

type UseCase =
  | "find_alternative"
  | "plan_ahead"
  | "sell_or_source"
  | "analyse_market"
  | "just_exploring";

type OrgSize =
  | "just_me"
  | "2_10"
  | "11_50"
  | "51_250"
  | "251_1000"
  | "1000_plus";

const ROLES: Array<{ value: Role; label: string; sub: string }> = [
  { value: "hospital_pharmacist",  label: "Hospital pharmacist or clinician",        sub: "I work in a hospital pharmacy or clinical role" },
  { value: "community_pharmacist", label: "Community pharmacist",                    sub: "I run or work in a retail / high-street pharmacy" },
  { value: "hospital_procurement", label: "Hospital procurement or supply chain",    sub: "I source medicines for a hospital or trust" },
  { value: "wholesaler",           label: "Wholesaler or distributor",               sub: "I move stock between manufacturers and pharmacies" },
  { value: "manufacturer",         label: "Pharma manufacturer or supplier",         sub: "I make or supply medicines and want to find buyers" },
  { value: "government",           label: "Government, regulator or health system",  sub: "I plan, regulate or oversee medicines policy" },
  { value: "researcher",           label: "Researcher, journalist or analyst",       sub: "I write about or study the industry" },
  { value: "other",                label: "Something else",                          sub: "" },
];

const USE_CASES: Array<{ value: UseCase; label: string }> = [
  { value: "find_alternative", label: "A specific drug is short and I need an alternative" },
  { value: "plan_ahead",       label: "I'm planning ahead for likely shortages" },
  { value: "sell_or_source",   label: "I source or supply medicines and want to find counterparts" },
  { value: "analyse_market",   label: "I track the industry for analysis or reporting" },
  { value: "just_exploring",   label: "Just exploring" },
];

const ORG_SIZES: Array<{ value: OrgSize; label: string }> = [
  { value: "just_me",   label: "Just me" },
  { value: "2_10",      label: "2 – 10 people" },
  { value: "11_50",     label: "11 – 50" },
  { value: "51_250",    label: "51 – 250" },
  { value: "251_1000",  label: "251 – 1,000" },
  { value: "1000_plus", label: "1,000+" },
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

// Decide where to land users after onboarding based on role + use case.
function landingPathFor(role: Role | null, useCase: UseCase | null): string {
  if (role === "manufacturer" || role === "wholesaler" || useCase === "sell_or_source") {
    return "/supplier-dashboard";
  }
  if (role === "government" || role === "researcher" || useCase === "analyse_market") {
    return "/intelligence";
  }
  if (useCase === "find_alternative") return "/search";
  return "/home";
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [role, setRole]               = useState<Role | null>(null);
  const [countries, setCountries]     = useState<string[]>([]);
  const [useCase, setUseCase]         = useState<UseCase | null>(null);
  const [orgSize, setOrgSize]         = useState<OrgSize | null>(null);
  const [therapyAreas, setTherapyAreas] = useState<string[]>([]);
  // Phase of the final-step submit so we can show better copy than "Saving…"
  // once the API call has returned and we're waiting on the destination
  // page to render.
  const [phase, setPhase] = useState<"idle" | "saving" | "redirecting">("idle");

  const TOTAL_STEPS = 5;

  // Prefetch the most likely destination as soon as we know the role +
  // use-case. By the time the user clicks Finish, the RSC payload for
  // /home or /supplier-dashboard is already warm.
  useEffect(() => {
    if (step >= 3 && (role || useCase)) {
      try { router.prefetch(landingPathFor(role, useCase)); } catch { /* noop */ }
    }
  }, [step, role, useCase, router]);

  // Pre-seed countries from cookie (mederti-country)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const m = document.cookie.match(/(?:^|; )mederti-country=([^;]+)/);
    if (m && m[1]) {
      const code = m[1].toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) setCountries([code]);
    }
  }, []);

  // If they're already onboarded, bounce them out
  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.profile?.onboarding_done) router.replace("/home");
      })
      .catch(() => {});
  }, [router]);

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

  // Persist progress on every step change so partial answers survive refresh
  async function persist(extra: Record<string, unknown> = {}) {
    setErr(null);
    try {
      await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          countries,
          use_case: useCase,
          org_size: orgSize,
          therapy_areas: therapyAreas,
          ...extra,
        }),
      });
    } catch {
      // non-blocking
    }
  }

  async function onNext() {
    // Validate per-step
    if (step === 1 && !role) { setErr("Please pick the option that fits best."); return; }
    if (step === 2 && countries.length === 0) { setErr("Pick at least one market."); return; }
    if (step === 3 && !useCase) { setErr("Pick what fits best."); return; }
    setErr(null);

    if (step < TOTAL_STEPS) {
      // Save and move forward
      void persist();
      setStep(step + 1);
      return;
    }

    // Final step → save and complete
    setSubmitting(true);
    setPhase("saving");
    try {
      // Time-bound the save so a slow serverless cold-start doesn't trap
      // the user on "Saving…" forever. 12s is generous; the call should
      // typically be <1s.
      const ctrl = new AbortController();
      const watchdog = setTimeout(() => ctrl.abort(), 12_000);
      const r = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          role,
          countries,
          use_case: useCase,
          org_size: orgSize,
          therapy_areas: therapyAreas,
          complete_onboarding: true,
        }),
      });
      clearTimeout(watchdog);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Could not save your profile");
      }
      // Set the country cookie too if we have one and it's missing/different
      if (countries[0]) {
        document.cookie = `mederti-country=${countries[0]}; path=/; max-age=${60 * 60 * 24 * 365}`;
      }

      const target = landingPathFor(role, useCase);
      // Switch the message — the user is now waiting on the destination
      // page, not on us.
      setPhase("redirecting");
      router.replace(target);

      // Fallback: if the RSC navigation hasn't actually moved the user
      // off the onboarding page within 5s (cold serverless on Vercel),
      // do a hard browser navigation instead.
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/onboarding")) {
          window.location.assign(target);
        }
      }, 5_000);
    } catch (e: unknown) {
      setPhase("idle");
      const msg = e instanceof Error
        ? (e.name === "AbortError"
            ? "Network is slow. Please try again."
            : e.message)
        : "Something went wrong";
      setErr(msg);
      setSubmitting(false);
    }
  }

  function onBack() {
    setErr(null);
    if (step > 1) setStep(step - 1);
  }

  function onSkipOptional() {
    // Step 4 (org size) and step 5 (therapy areas) are optional
    if (step === 4) { void persist({ org_size: null }); setOrgSize(null); setStep(5); }
    else if (step === 5) {
      // Treat skip on last step as complete with no therapy areas
      setTherapyAreas([]);
      void onNext();
    }
  }

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteNav />

      <main style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 20px 60px" }}>
        <div style={{
          width: "100%", maxWidth: 560,
          background: "#fff", border: "1px solid var(--app-border)",
          borderRadius: 14, padding: "32px 36px",
        }}>
          {/* Progress dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 22 }}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} style={{
                width: i + 1 === step ? 24 : 8, height: 8, borderRadius: 999,
                background: i + 1 <= step ? "var(--teal)" : "var(--app-bg-2)",
                transition: "all 0.2s",
              }} />
            ))}
          </div>

          {/* Header */}
          <h1 style={{
            fontSize: 22, fontWeight: 700, color: "var(--app-text)",
            margin: "0 0 6px", letterSpacing: "-0.01em",
            fontFamily: "var(--font-inter), sans-serif",
          }}>
            {step === 1 && "Welcome — what best describes you?"}
            {step === 2 && "Where do you operate?"}
            {step === 3 && "What brought you here today?"}
            {step === 4 && "How big is your organisation?"}
            {step === 5 && "Which therapy areas matter most?"}
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--app-text-3)", margin: "0 0 22px", lineHeight: 1.55 }}>
            {step === 1 && "We use this to set up the right home page for you."}
            {step === 2 && "We'll default your shortage feed and regulatory calendar to these markets. Pick up to five."}
            {step === 3 && "It tells us where to point you first."}
            {step === 4 && "Optional. Just helps us recommend the right plan."}
            {step === 5 && "Optional. We'll seed your watchlist with the most-watched drugs in these areas."}
          </p>

          {err && (
            <div style={{
              marginBottom: 14, padding: "10px 14px", borderRadius: 8,
              background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
              fontSize: 13, color: "var(--crit)",
            }}>
              {err}
            </div>
          )}

          {/* Step 1 — Role */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ROLES.map((r) => (
                <RadioCard
                  key={r.value}
                  selected={role === r.value}
                  onClick={() => setRole(r.value)}
                  label={r.label}
                  sub={r.sub}
                />
              ))}
            </div>
          )}

          {/* Step 2 — Countries */}
          {step === 2 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {COUNTRIES.map((c) => {
                const sel = countries.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggleCountry(c.code)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px",
                      background: sel ? "var(--teal-bg, rgba(13,148,136,0.08))" : "#fff",
                      border: `1px solid ${sel ? "var(--teal)" : "var(--app-border)"}`,
                      borderRadius: 10, cursor: "pointer",
                      fontFamily: "var(--font-inter), sans-serif",
                      fontSize: 13.5, color: "var(--app-text)", textAlign: "left",
                      transition: "all 0.12s",
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{c.flag}</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    {sel && <Check size={14} color="var(--teal)" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 3 — Use case */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {USE_CASES.map((u) => (
                <RadioCard
                  key={u.value}
                  selected={useCase === u.value}
                  onClick={() => setUseCase(u.value)}
                  label={u.label}
                />
              ))}
            </div>
          )}

          {/* Step 4 — Org size */}
          {step === 4 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {ORG_SIZES.map((o) => (
                <RadioCard
                  key={o.value}
                  selected={orgSize === o.value}
                  onClick={() => setOrgSize(o.value)}
                  label={o.label}
                  centered
                />
              ))}
            </div>
          )}

          {/* Step 5 — Therapy areas */}
          {step === 5 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {THERAPY_AREAS.map((t) => {
                const sel = therapyAreas.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleTherapy(t.value)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px",
                      background: sel ? "var(--teal-bg, rgba(13,148,136,0.08))" : "#fff",
                      border: `1px solid ${sel ? "var(--teal)" : "var(--app-border)"}`,
                      borderRadius: 10, cursor: "pointer",
                      fontFamily: "var(--font-inter), sans-serif",
                      fontSize: 13.5, color: "var(--app-text)", textAlign: "left",
                      transition: "all 0.12s",
                    }}
                  >
                    <span style={{ flex: 1 }}>{t.label}</span>
                    {sel && <Check size={14} color="var(--teal)" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 26 }}>
            <button
              type="button"
              onClick={onBack}
              disabled={step === 1}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 12px", background: "transparent",
                border: "none", color: step === 1 ? "var(--app-text-4)" : "var(--app-text-3)",
                fontSize: 13, cursor: step === 1 ? "default" : "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}
            >
              <ArrowLeft size={14} /> Back
            </button>

            <div style={{ display: "flex", gap: 10 }}>
              {(step === 4 || step === 5) && (
                <button
                  type="button"
                  onClick={onSkipOptional}
                  style={{
                    padding: "10px 16px", background: "transparent",
                    border: "1px solid var(--app-border)", borderRadius: 10,
                    color: "var(--app-text-3)", fontSize: 13.5, cursor: "pointer",
                    fontFamily: "var(--font-inter), sans-serif",
                  }}
                >
                  Skip
                </button>
              )}

              <button
                type="button"
                onClick={onNext}
                disabled={submitting}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "10px 18px", background: "var(--teal)",
                  border: "none", borderRadius: 10,
                  color: "#fff", fontSize: 13.5, fontWeight: 600,
                  cursor: submitting ? "default" : "pointer",
                  opacity: submitting ? 0.6 : 1,
                  fontFamily: "var(--font-inter), sans-serif",
                }}
              >
                {phase === "redirecting"
                  ? "Setting up your home page…"
                  : submitting
                    ? "Saving…"
                    : step === TOTAL_STEPS ? "Finish" : "Continue"}
                {!submitting && <ArrowRight size={14} />}
              </button>
            </div>
          </div>

          {/* Help line */}
          <p style={{ marginTop: 24, fontSize: 11.5, color: "var(--app-text-4)", textAlign: "center" }}>
            You can change any of this later in <Link href="/account" style={{ color: "var(--teal)" }}>your account settings</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}

// ─── Reusable selectable card ────────────────────────────────────────────────

function RadioCard({
  selected, onClick, label, sub, centered,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
  centered?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        justifyContent: centered ? "center" : "flex-start",
        padding: "12px 14px",
        background: selected ? "var(--teal-bg, rgba(13,148,136,0.08))" : "#fff",
        border: `1px solid ${selected ? "var(--teal)" : "var(--app-border)"}`,
        borderRadius: 10, cursor: "pointer", textAlign: centered ? "center" : "left",
        fontFamily: "var(--font-inter), sans-serif",
        transition: "all 0.12s",
      }}
    >
      <div style={{ flex: centered ? "initial" : 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 2 }}>{sub}</div>}
      </div>
      {selected && !centered && <Check size={15} color="var(--teal)" />}
    </button>
  );
}
