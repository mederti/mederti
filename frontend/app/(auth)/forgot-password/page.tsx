"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import AuthShell from "../AuthShell";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1px solid var(--app-border)", fontSize: 14,
  fontFamily: "var(--font-inter), sans-serif",
  outline: "none", boxSizing: "border-box",
};

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const supabase = createBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // Route the recovery link through the existing /auth/callback handler,
    // which exchanges the code for a session, then lands on /reset-password
    // where the user sets a new password.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
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
            Reset your password
          </p>
          <p style={{ fontSize: 13, color: "var(--app-text-4)", margin: 0 }}>
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
            fontSize: 13, color: "var(--crit)",
          }}>
            {error}
          </div>
        )}

        {sent ? (
          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "var(--low-bg)", border: "1px solid var(--low-b)",
            fontSize: 13, color: "var(--low)", lineHeight: 1.6,
          }}>
            ✓ If an account exists for <strong>{email}</strong>, we&apos;ve sent a password-reset link.
            Check your inbox (and spam) — the link expires in 1 hour.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--app-text-3)", display: "block", marginBottom: 6 }}>
                Email
              </label>
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
              {loading ? "Sending link…" : "Send reset link"}
            </button>
          </form>
        )}

        {/* Footer link */}
        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--app-text-3)" }}>
          Remembered it?{" "}
          <Link href="/login" style={{ color: "var(--teal)", fontWeight: 500 }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
