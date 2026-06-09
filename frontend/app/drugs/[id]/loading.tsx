// Drug-detail page Suspense fallback. Slightly more structured than the
// generic spinner because the drug page fires 6 parallel Supabase queries
// + 2 sequential await chains (per audit FINDING-F4-01) — cold navigation
// can be 500 ms-2 s. A header-shaped skeleton stops the blank-tab flash
// from feeling like a load failure.

export default function Loading() {
  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 24px",
        background: "var(--app-bg, #fff)",
        color: "var(--app-text, #0f172a)",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      {/* Skeleton header: drug name + status pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div
          style={{
            width: 280,
            maxWidth: "60%",
            height: 32,
            borderRadius: 6,
            background: "var(--app-border-2, #e2e8f0)",
            animation: "mederti-pulse 1.2s ease-in-out infinite",
          }}
        />
        <div
          style={{
            width: 80,
            height: 22,
            borderRadius: 999,
            background: "var(--surf-3, #f1f5f9)",
            animation: "mederti-pulse 1.2s ease-in-out infinite",
            animationDelay: "0.15s",
          }}
        />
      </div>

      {/* Subtitle line */}
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          height: 16,
          borderRadius: 4,
          background: "var(--surf-3, #f1f5f9)",
          marginBottom: 32,
          animation: "mederti-pulse 1.2s ease-in-out infinite",
          animationDelay: "0.3s",
        }}
      />

      {/* Three card-shaped blocks */}
      <div style={{ display: "grid", gap: 16 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 140,
              borderRadius: 14,
              background: "var(--surf-3, #f1f5f9)",
              border: "1px solid var(--app-border-2, #e2e8f0)",
              animation: "mederti-pulse 1.2s ease-in-out infinite",
              animationDelay: `${0.45 + i * 0.1}s`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes mederti-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-busy="true"] * {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
