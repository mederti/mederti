"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

type Tab = "password" | "magic";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/home";

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const supabase = createBrowserClient();

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push(next);
      router.refresh();
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${next}` },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMagicSent(true);
    }
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
            Sign in to your account
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--app-border)",
          marginBottom: 24,
        }}>
          {(["password", "magic"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); setMagicSent(false); }}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 500,
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
                color: tab === t ? "var(--teal)" : "var(--app-text-3)",
                borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t === "password" ? "Email + Password" : "Magic Link"}
            </button>
          ))}
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

        {/* Magic link sent */}
        {magicSent && (
          <div style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 8,
            background: "var(--low-bg)", border: "1px solid var(--low-b)",
            fontSize: 13, color: "var(--low)",
          }}>
            ✓ Check your inbox — we sent a sign-in link to <strong>{email}</strong>
          </div>
        )}

        {/* Email + Password form */}
        {tab === "password" && !magicSent && (
          <form onSubmit={handlePasswordLogin}>
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
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--app-text-3)", display: "block", marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* Magic link form */}
        {tab === "magic" && !magicSent && (
          <form onSubmit={handleMagicLink}>
            <div style={{ marginBottom: 20 }}>
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
              {loading ? "Sending link…" : "Send magic link"}
            </button>
            <p style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 10, textAlign: "center" }}>
              We'll email you a one-click sign-in link — no password needed.
            </p>
          </form>
        )}

        {/* Footer links */}
        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--app-text-3)" }}>
          Don't have an account?{" "}
          <Link href={`/signup${next !== "/home" ? `?next=${encodeURIComponent(next)}` : ""}`}
            style={{ color: "var(--teal)", fontWeight: 500 }}>
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
