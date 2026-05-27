"use client";

// Root error boundary — runs when an error escapes app/layout.tsx itself.
// Reports the error to Sentry, then renders a minimal fallback UI.
//
// Per Next.js docs, this file MUST define its own <html> and <body>.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
          background: "#fff",
          color: "#0f172a",
          minHeight: "100vh",
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: "#475569", marginBottom: 24 }}>
            We&apos;ve been notified and will look into it. Try refreshing the page,
            or head back home.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={reset}
              style={{
                padding: "10px 18px",
                background: "#0f172a",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: "10px 18px",
                background: "#fff",
                color: "#0f172a",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                textDecoration: "none",
              }}
            >
              Home
            </a>
          </div>
          {error.digest && (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 32 }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
