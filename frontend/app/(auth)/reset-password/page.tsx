"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import AuthShell from "../AuthShell";

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

function ResetPasswordForm() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery link routes through /auth/callback, which exchanges the code
  // for a session before redirecting here. So a valid arrival has a session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/home");
      router.refresh();
    }, 1400);
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
            Choose a new password
          </p>
          <p style={{ fontSize: 13, color: "var(--app-text-4)", margin: 0 }}>
            Pick something you haven&apos;t used before
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

        {checking ? (
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--app-text-4)", padding: "12px 0" }}>
            Verifying your reset link…
          </p>
        ) : done ? (
          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "var(--low-bg)", border: "1px solid var(--low-b)",
            fontSize: 13, color: "var(--low)", lineHeight: 1.6,
          }}>
            ✓ Password updated. Taking you to your dashboard…
          </div>
        ) : !hasSession ? (
          <div style={{ textAlign: "center" }}>
            <div style={{
              marginBottom: 16, padding: "12px 16px", borderRadius: 8,
              background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
              fontSize: 13, color: "var(--crit)", lineHeight: 1.6,
            }}>
              This reset link is invalid or has expired. Request a fresh one.
            </div>
            <Link href="/forgot-password" style={{ color: "var(--teal)", fontWeight: 500, fontSize: 13 }}>
              Send a new reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="new-password"
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="new-password"
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
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
