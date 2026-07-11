"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { captureEvent } from "@/lib/analytics/events";
import AuthShell from "../AuthShell";
import OAuthButtons from "../OAuthButtons";

export type SignupStats = {
  medicines: number | null;
  activeShortages: number | null;
  countries: number | null;
};

/**
 * Only allow same-origin relative redirects. Rejects scheme-bearing
 * (`https://evil`), protocol-relative (`//evil`) and back-slash variants so a
 * crafted `?next=` cannot bounce a freshly-confirmed user off-site.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/onboarding";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/onboarding";
  return raw;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1px solid var(--app-border)", fontSize: 14,
  fontFamily: "var(--font-inter), sans-serif",
  outline: "none", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: "var(--app-text-3)",
  display: "block", marginBottom: 6,
};

function ValuePanel({ stats, supplier }: { stats: SignupStats; supplier: boolean }) {
  const n = (v: number | null) => (v == null ? null : v.toLocaleString());
  const shortages = n(stats.activeShortages);
  const countries = n(stats.countries);
  const medicines = stats.medicines == null ? null : `${Math.floor(stats.medicines / 1000)}K+`;

  const checklist = supplier
    ? [
        "List your available stock — free",
        "Receive qualified buyer enquiries",
        "Demand signals from live shortage data",
        "No commissions or hidden fees",
      ]
    : [
        "Live status from 40+ official regulators",
        "Substitutes and supplier sourcing",
        "Email alerts when availability changes",
        "Free for individual pharmacists & clinicians",
      ];

  return (
    <div>
      <h1 style={{
        fontSize: "clamp(34px, 4.5vw, 46px)", fontWeight: 700,
        letterSpacing: "-0.035em", lineHeight: 1.08,
        color: "var(--app-text)", margin: "0 0 16px",
      }}>
        {supplier ? "Reach buyers in shortage." : "Start searching."}
      </h1>
      <p style={{
        fontSize: 15.5, lineHeight: 1.6, color: "var(--app-text-2)",
        margin: "0 0 26px", maxWidth: 440,
      }}>
        {shortages && countries ? (
          <>
            Join the pharmacists and procurement teams tracking{" "}
            <b style={{ fontWeight: 600 }}>{shortages} active shortages</b> across{" "}
            <b style={{ fontWeight: 600 }}>{countries} countries</b>
            {medicines ? <> — and search any of {medicines} medicines</> : null}.
          </>
        ) : (
          <>Live shortage intelligence for any medicine, straight from official regulators.</>
        )}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "inline-block", textAlign: "left" }}>
        {checklist.map((item) => (
          <li key={item} style={{
            display: "flex", alignItems: "center", gap: 10,
            fontSize: 14.5, fontWeight: 500, color: "var(--app-text)",
            marginBottom: 12,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SignupClient({ stats }: { stats: SignupStats }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // After signup, send users to onboarding so we can profile them before they
  // land in the product. Caller can override with ?next=/whatever.
  const next = safeNext(searchParams.get("next"));
  const role = searchParams.get("role"); // e.g. "supplier"
  const supplier = role === "supplier";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    // Create the account already-confirmed (no email round-trip) via the admin
    // route, then sign in with the password to establish the session. Email is
    // off the critical path, so signup no longer depends on SMTP, the Supabase
    // Site URL, or the redirect domain's TLS cert.
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          role,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setLoading(false);
        setError(d?.error || "Could not create your account. Please try again.");
        return;
      }
      // Account exists + confirmed — sign in (a normal, reliable password login).
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      captureEvent("signup_submitted", role ? { role } : undefined);
      router.push(next);
      router.refresh();
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <AuthShell aside={<ValuePanel stats={stats} supplier={supplier} />}>
      <div style={{
        background: "#fff", border: "1px solid var(--app-border)",
        borderRadius: 14, padding: "32px 36px",
        boxShadow: "0 20px 60px rgba(15,23,42,0.10)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" style={{ height: 30, width: "auto", display: "block", margin: "0 auto 16px" }} />
          <p style={{ fontSize: 16.5, fontWeight: 600, color: "var(--app-text)", margin: 0, letterSpacing: "-0.01em" }}>
            {supplier
              ? <>Sign up to reach buyers — <b style={{ fontWeight: 700 }}>free</b></>
              : <>Sign up to search any medicine — <b style={{ fontWeight: 700 }}>free</b></>}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
            fontSize: 13, color: "var(--crit)",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignup}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
                placeholder="Alex"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
                placeholder="Lee"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label style={labelStyle}>Password</label>
              <span style={{ fontSize: 11.5, color: "var(--app-text-4)" }}>Must be at least 8 characters</span>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>
          <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--app-text-4)", margin: "0 0 16px" }}>
            All fields required.
          </p>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "12px", borderRadius: 8,
              background: loading ? "var(--app-bg-2)" : "var(--teal)",
              color: loading ? "var(--app-text-4)" : "#fff",
              border: "none", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "var(--font-inter), sans-serif",
            }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        {/* Google / Apple — after the form, Drafted-style */}
        <div style={{ marginTop: 4 }}>
          <OAuthButtons next={next} role={role} mode="signup" placement="bottom" />
        </div>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "var(--app-text-3)" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--teal)", fontWeight: 500 }}>
            Sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
