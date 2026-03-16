"use client";

import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>
      <SiteNav />
      <div style={{
        maxWidth: 520, margin: "0 auto",
        padding: "100px 24px 80px",
        textAlign: "center",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: "var(--high-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 16px",
          fontSize: 28,
        }}>
          !
        </div>
        <h1 style={{
          fontSize: 22, fontWeight: 700,
          color: "var(--app-text)",
          margin: "0 0 8px",
        }}>
          Something went wrong
        </h1>
        <p style={{
          fontSize: 15, color: "var(--app-text-3)",
          lineHeight: 1.6, margin: "0 0 28px",
        }}>
          An unexpected error occurred while loading this page. This is usually temporary.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              display: "inline-flex", alignItems: "center",
              padding: "10px 22px", borderRadius: 8,
              fontSize: 14, fontWeight: 600,
              color: "#fff", background: "var(--teal)",
              border: "none", cursor: "pointer",
              transition: "opacity 0.15s",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
            }}
          >
            Try again
          </button>
          <a href="/" style={{
            display: "inline-flex", alignItems: "center",
            padding: "10px 22px", borderRadius: 8,
            fontSize: 14, fontWeight: 500,
            color: "var(--app-text-2)",
            background: "#fff",
            border: "1px solid var(--app-border)",
            textDecoration: "none",
          }}>
            Go home
          </a>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
