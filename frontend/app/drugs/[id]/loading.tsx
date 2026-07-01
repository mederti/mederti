// Drug-detail page Suspense fallback. Shaped to mirror the real drug page
// (search bar → hero card → status block → stat tiles) so the load→content
// hand-off doesn't jump, with a shimmer sweep instead of a flat pulse. The
// drug page fires 6 parallel Supabase queries + 2 sequential await chains
// (audit FINDING-F4-01), so cold navigation can be 500 ms–2 s.

const SHIMMER = {
  backgroundImage:
    "linear-gradient(90deg, var(--surf-3,#eef2f5) 25%, var(--surf-2,#f6f8fa) 50%, var(--surf-3,#eef2f5) 75%)",
  backgroundSize: "400% 100%",
  animation: "mederti-shimmer 1.5s ease-in-out infinite",
} as const;

const CARD = {
  background: "var(--surf,#fff)",
  border: "1px solid var(--border,#e8ecf0)",
  borderRadius: 16,
} as const;

function Bar({ w, h = 14, r = 6, mb = 0, max }: { w: number | string; h?: number; r?: number; mb?: number; max?: string }) {
  return <div style={{ ...SHIMMER, width: w, maxWidth: max, height: h, borderRadius: r, marginBottom: mb }} />;
}

export default function Loading() {
  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "20px 40px 80px",
        background: "var(--app-bg, #fff)",
        color: "var(--app-text, #0f172a)",
      }}
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading drug details"
    >
      {/* Search bar */}
      <Bar w="100%" h={46} r={14} mb={20} />

      {/* Hero card: name + meta + status pills + brand chips */}
      <div style={{ ...CARD, padding: "22px 24px", marginBottom: 16 }}>
        <Bar w={240} max="62%" h={30} r={8} mb={12} />
        <Bar w={360} max="90%" h={14} r={5} mb={18} />
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <Bar w={150} h={28} r={999} />
          <Bar w={110} h={28} r={999} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[96, 72, 88, 116, 90].map((w, i) => (
            <Bar key={i} w={w} h={30} r={8} />
          ))}
        </div>
      </div>

      {/* Status / summary block */}
      <div style={{ ...CARD, padding: "20px 22px", marginBottom: 16 }}>
        <Bar w={170} h={13} r={5} mb={14} />
        <Bar w={210} h={24} r={6} mb={16} />
        <Bar w="100%" h={12} r={5} mb={9} />
        <Bar w="94%" h={12} r={5} mb={9} />
        <Bar w="82%" h={12} r={5} />
      </div>

      {/* Three stat tiles (stack on mobile) */}
      <div className="sk-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...CARD, padding: 18 }}>
            <Bar w="58%" h={12} r={5} mb={12} />
            <Bar w="42%" h={22} r={6} />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes mederti-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @media (max-width: 768px) {
          .sk-tiles { grid-template-columns: 1fr !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-busy="true"] * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
