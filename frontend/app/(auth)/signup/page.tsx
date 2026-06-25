"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { captureEvent } from "@/lib/analytics/events";
import AuthShell from "../AuthShell";
import OAuthButtons from "../OAuthButtons";

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

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // After email confirm, send users to onboarding so we can profile them
  // before they land in the product. Caller can override with ?next=/whatever.
  const next = safeNext(searchParams.get("next"));
  const role = searchParams.get("role"); // e.g. "supplier"

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const supabase = createBrowserClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    // The confirmation email must land on /auth/callback so the PKCE code is
    // exchanged for a session server-side; only then does `next` apply. Linking
    // straight to the destination leaves the user unauthenticated. Role rides
    // along so the callback can persist it once the session exists.
    const callbackNext = `/auth/callback?next=${encodeURIComponent(next)}${
      role ? `&role=${encodeURIComponent(role)}` : ""
    }`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${callbackNext}`,
        data: role ? { role } : undefined,
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      // Save role to user_profiles immediately if provided (so it's set even before email confirm)
      if (role && data.user?.id) {
        try {
          await fetch("/api/user/role", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
          });
        } catch {
          // non-blocking
        }
      }
      // Top-of-funnel conversion event. Autocapture can't see this — signUp is
      // a programmatic call, not a tracked DOM submit. role is a non-sensitive
      // cohort trait; no email/PII is sent.
      captureEvent("signup_submitted", role ? { role } : undefined);
      setDone(true);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <div style={{
          background: "#fff", border: "1px solid var(--app-border)",
          borderRadius: 14, padding: "36px 40px", textAlign: "center",
          boxShadow: "0 20px 60px rgba(15,23,42,0.10)",
        }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>✓</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--app-text)", marginBottom: 8 }}>
            Check your inbox
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65 }}>
            We sent a confirmation link to <strong>{email}</strong>.
            Click it to activate your account, then{" "}
            <Link href="/login" style={{ color: "var(--teal)" }}>sign in</Link>.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={{
        background: "#fff", border: "1px solid var(--app-border)",
        borderRadius: 14, padding: "36px 40px",
        boxShadow: "0 20px 60px rgba(15,23,42,0.10)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" style={{ height: 34, width: "auto", display: "block", margin: "0 auto 20px" }} />
          <p style={{ fontSize: 18, fontWeight: 600, color: "var(--app-text)", marginTop: 0, marginBottom: 4 }}>
            {role === "supplier" ? "Sign up as a supplier" : "Create your account"}
          </p>
          <p style={{ fontSize: 13, color: "var(--app-text-4)", margin: 0 }}>
            {role === "supplier"
              ? "Free \u2014 list your stock and receive buyer enquiries"
              : "Free for individual pharmacists and clinicians"}
          </p>
        </div>

        {/* Google / Apple */}
        <OAuthButtons next={next} role={role} mode="signup" />

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
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--app-text-3)", display: "block", marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--app-border)", fontSize: 14,
                fontFamily: "var(--font-inter), sans-serif",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--app-text-3)", display: "block", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Minimum 8 characters"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--app-border)", fontSize: 14,
                fontFamily: "var(--font-inter), sans-serif",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--app-text-3)", display: "block", marginBottom: 6 }}>
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--app-border)", fontSize: 14,
                fontFamily: "var(--font-inter), sans-serif",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
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

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--app-text-3)" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--teal)", fontWeight: 500 }}>
            Sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
