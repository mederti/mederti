"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * AuthBanner — sticky banner shown to unauthenticated visitors on the dashboard.
 * Soft gate: does NOT block content. Dismissible.
 */
export function AuthBanner() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const supabase = createBrowserClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthed(!!session);
    });

    // Listen for auth state changes (e.g. sign-in in another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Still loading, already authed, or dismissed — render nothing
  if (authed === null || authed || dismissed) return null;

  return (
    <div style={{
      position: "sticky",
      top: 56, // sits below the dashboard nav bar
      zIndex: 90,
      background: "var(--teal)",
      color: "#fff",
      padding: "10px 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    }}>
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong>Sign in</strong> to set watchlist alerts and save your preferences.
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Link
          href="/login?next=/dashboard"
          style={{
            fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 6,
            background: "#fff", color: "var(--teal)", textDecoration: "none",
          }}
        >
          Sign in
        </Link>
        <Link
          href="/signup?next=/dashboard"
          style={{
            fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: 6,
            background: "rgba(255,255,255,0.15)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)", textDecoration: "none",
          }}
        >
          Sign up
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.7)",
            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
