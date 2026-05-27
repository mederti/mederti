// Shared Suspense fallback used by all per-route loading.tsx files.
// Closes audit FINDING-F4-08 — without loading.tsx + Suspense boundaries,
// users see a blank tab during the ~500 ms-2 s server-component fetch
// window on cold navigation (the drug page fires 6 parallel Supabase
// queries plus 2 follow-up await chains). CLS suffers; Lighthouse docks.
//
// Kept small + brand-consistent (Mederti tokens from globals.css).
// Server component — no JS shipped to the client.

export function LoadingSpinner({
  label = "Loading…",
}: {
  label?: string;
}) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        background: "var(--app-bg, #fff)",
        color: "var(--app-text, #0f172a)",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: "2px solid var(--bd, #e2e8f0)",
          borderTopColor: "var(--app-text, #0f172a)",
          borderRadius: "50%",
          animation: "mederti-spin 0.9s linear infinite",
        }}
      />
      <span style={{ fontSize: 13, color: "var(--app-text-3, #64748b)" }}>
        {label}
      </span>
      <style>{`
        @keyframes mederti-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-busy="true"] > div:first-child {
            animation: none;
            border-top-color: var(--bd, #e2e8f0);
          }
        }
      `}</style>
    </div>
  );
}
