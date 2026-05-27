"use client";

// Shared per-route error fallback. Used by app/<route>/error.tsx files.
// Closes audit FINDING-UX-10 (no per-route error boundaries).
//
// Reports the error to Sentry (no-op until SENTRY_DSN is set; see
// docs/sentry-setup.md) then renders a minimal teal fallback UI with
// a `reset()` retry button per Next.js's error.tsx contract.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export function ErrorBoundary({
  error,
  reset,
  surface,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Human-readable label for the page surface (e.g. "Drug page", "Chat"). */
  surface: string;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { surface } });
  }, [error, surface]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
        background: "var(--app-bg, #fff)",
        color: "var(--app-text, #0f172a)",
      }}
      role="alert"
    >
      <div style={{ maxWidth: 480, textAlign: "left" }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>
          Something broke loading the {surface.toLowerCase()}.
        </h1>
        <p style={{ color: "var(--app-text-3, #64748b)", marginBottom: 20 }}>
          We&apos;ve been notified and will look into it. Try again, or head
          back home.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={reset}
            style={{
              padding: "10px 18px",
              background: "var(--app-text, #0f172a)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "10px 18px",
              background: "transparent",
              color: "var(--app-text, #0f172a)",
              border: "1px solid var(--bd, #cbd5e1)",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Home
          </a>
        </div>
        {error.digest && (
          <p
            style={{
              color: "var(--app-text-4, #94a3b8)",
              fontSize: 12,
              marginTop: 24,
            }}
          >
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
