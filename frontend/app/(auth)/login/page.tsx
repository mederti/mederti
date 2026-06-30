"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import AuthShell from "../AuthShell";
import OAuthButtons from "../OAuthButtons";

type Tab = "password" | "magic";

// Magic-link login depends on email delivery (Supabase SMTP) + a correct Site
// URL + a valid cert on the redirect domain — all currently unreliable, which
// produces "link never arrived" / "link said invalid". Hidden until those are
// fixed; password login is reliable. Flip NEXT_PUBLIC_MAGIC_LINK_ENABLED=true
// to bring the tab back.
const MAGIC_LINK_ENABLED =
  (process.env.NEXT_PUBLIC_MAGIC_LINK_ENABLED ?? "").toLowerCase() === "true";

/**
 * Only allow same-origin relative redirects. Rejects scheme-bearing
 * (`https://evil`), protocol-relative (`//evil`) and back-slash variants so a
 * crafted `?next=` cannot bounce a freshly-authenticated user off-site.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/home";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/home";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
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
      return;
    }

    // Don't probe onboarding status here — middleware already redirects users
    // who haven't finished onboarding (or have no profile row yet) to
    // /onboarding on the next navigation. The old /api/user/profile fetch added
    // ~0.6s to every default login for no behavioural gain. Single source of
    // truth = middleware.
    router.push(next);
    router.refresh();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // Route the magic link through /auth/callback so the PKCE code is exchanged
    // for a session server-side before redirecting to `next`. Linking straight
    // to the destination leaves the user unauthenticated under the PKCE flow.
    const callbackNext = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackNext },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMagicSent(true);
    }
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
            Sign in to your account
          </p>
          <p style={{ fontSize: 13, color: "var(--app-text-4)", margin: 0 }}>
            Access your watchlist, alerts, and personalised feed
          </p>
        </div>

        {/* Google / Apple */}
        <OAuthButtons next={next} role={null} mode="signin" />

        {/* Tabs — only shown when magic-link login is enabled. */}
        {MAGIC_LINK_ENABLED && (
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
        )}

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
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4, marginTop: -6 }}>
              <Link
                href="/forgot-password"
                style={{
                  fontSize: 12, color: "var(--teal)",
                  fontFamily: "var(--font-inter), sans-serif",
                  textDecoration: "none",
                }}
              >
                Forgot password?
              </Link>
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
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
