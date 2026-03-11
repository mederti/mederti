"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/home";

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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--app-bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: "100%", maxWidth: 420,
          background: "var(--panel)", border: "1px solid var(--app-border)",
          borderRadius: 14, padding: "36px 40px", textAlign: "center",
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
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--app-bg)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "var(--panel)", border: "1px solid var(--app-border)",
        borderRadius: 14, padding: "36px 40px",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 22, fontWeight: 700, color: "var(--teal)", letterSpacing: "-0.025em", textDecoration: "none" }}>
            Mederti
          </Link>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", marginTop: 6 }}>
            Create your account
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
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
