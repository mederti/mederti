"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type Provider = "google" | "apple";

// Google/Apple providers must be enabled in the Supabase dashboard before these
// buttons work — otherwise signInWithOAuth returns "provider is not enabled".
// Keep the buttons hidden until the env flag is flipped on (set
// NEXT_PUBLIC_OAUTH_ENABLED=true once the providers are configured).
const OAUTH_ENABLED =
  (process.env.NEXT_PUBLIC_OAUTH_ENABLED ?? "").toLowerCase() === "true";

export default function OAuthButtons({
  next,
  role,
  mode,
}: {
  next: string;
  role: string | null;
  mode: "signin" | "signup";
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createBrowserClient();

  // Until the providers are enabled server-side, render nothing (no broken
  // buttons, no dangling "or" divider). The email/password form stands alone.
  if (!OAUTH_ENABLED) return null;

  async function handleOAuth(provider: Provider) {
    setError(null);
    setPending(provider);

    const callbackParams = new URLSearchParams();
    callbackParams.set("next", next);
    if (role) callbackParams.set("role", role);
    const redirectTo = `${window.location.origin}/auth/callback?${callbackParams.toString()}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) {
      setError(error.message);
      setPending(null);
    }
    // On success the browser is redirected to the provider — no further action.
  }

  const verb = mode === "signup" ? "Sign up" : "Sign in";

  return (
    <div style={{ marginBottom: 20 }}>
      {error && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
          fontSize: 13, color: "var(--crit)",
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={pending !== null}
        style={{
          width: "100%", padding: "11px 14px", borderRadius: 8,
          background: "#fff", color: "var(--app-text)",
          border: "1px solid var(--app-border)",
          fontSize: 14, fontWeight: 500,
          cursor: pending ? "not-allowed" : "pointer",
          fontFamily: "var(--font-inter), sans-serif",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          opacity: pending && pending !== "google" ? 0.6 : 1,
          marginBottom: 10,
        }}
      >
        <GoogleIcon />
        {pending === "google" ? "Redirecting…" : `${verb} with Google`}
      </button>

      <button
        type="button"
        onClick={() => handleOAuth("apple")}
        disabled={pending !== null}
        style={{
          width: "100%", padding: "11px 14px", borderRadius: 8,
          background: "#000", color: "#fff",
          border: "1px solid #000",
          fontSize: 14, fontWeight: 500,
          cursor: pending ? "not-allowed" : "pointer",
          fontFamily: "var(--font-inter), sans-serif",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          opacity: pending && pending !== "apple" ? 0.6 : 1,
        }}
      >
        <AppleIcon />
        {pending === "apple" ? "Redirecting…" : `${verb} with Apple`}
      </button>

      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        margin: "20px 0 4px",
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
        <span style={{ fontSize: 12, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          or
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--app-border)" }} />
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="#fff" aria-hidden="true">
      <path d="M13.288 9.604c-.022-2.235 1.825-3.31 1.909-3.36-1.04-1.52-2.66-1.728-3.236-1.752-1.378-.139-2.69.811-3.39.811-.71 0-1.788-.79-2.94-.767-1.512.022-2.91.879-3.69 2.232-1.575 2.728-.403 6.766 1.13 8.978.748 1.082 1.638 2.296 2.806 2.253 1.127-.046 1.55-.728 2.91-.728 1.36 0 1.74.728 2.93.706 1.21-.023 1.977-1.1 2.717-2.187.856-1.255 1.21-2.47 1.23-2.532-.027-.012-2.36-.905-2.376-3.594zM11.06 3.07c.62-.752 1.04-1.795.926-2.835-.895.037-1.98.596-2.62 1.345-.574.665-1.077 1.726-.942 2.748.998.077 2.016-.508 2.636-1.258z"/>
    </svg>
  );
}
