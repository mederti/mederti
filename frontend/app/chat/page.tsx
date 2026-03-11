import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";
import SiteNav from "@/app/components/landing-nav";

const EXAMPLE_QUESTIONS = [
  "What are the alternatives to amoxicillin in Australia?",
  "Show me critical shortages in the US this month",
  "Which cancer drugs have the most recalls globally?",
  "What shortage is affecting metformin supply in Canada?",
  "Compare shortage severity between the UK and Germany",
  "Are there biosimilars available for adalimumab?",
];

export default function ChatPage() {
  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>

      {/* Hero */}
      <div style={{ background: "var(--navy)" }}>
        <SiteNav />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px 44px", textAlign: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 14px", borderRadius: 20,
            background: "rgba(13,148,136,0.15)", border: "1px solid rgba(13,148,136,0.3)",
            marginBottom: 20,
          }}>
            <Sparkles style={{ width: 13, height: 13, color: "var(--teal-l)" }} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--teal-l)", letterSpacing: "0.03em" }}>
              Coming soon
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 14 }}>
            <MessageSquare style={{ width: 28, height: 28, color: "var(--teal-l)" }} strokeWidth={1.6} />
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
              AI Chat
            </h1>
          </div>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.6)", margin: "0 auto", maxWidth: 520, lineHeight: 1.65 }}>
            Ask anything about drug shortages, alternatives, and supply intelligence. Get instant, data-backed answers from across 12 global regulators.
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>

        {/* Input area */}
        <div style={{
          background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12,
          padding: "20px", marginBottom: 24, maxWidth: 720, margin: "0 auto 24px",
        }}>
          <div style={{ position: "relative" }}>
            <textarea
              disabled
              placeholder="Coming soon\u2026"
              rows={3}
              style={{
                width: "100%", resize: "none",
                padding: "12px 14px",
                borderRadius: 8, border: "1px solid var(--app-border)",
                background: "var(--app-bg)",
                fontSize: 14, color: "var(--app-text-4)",
                fontFamily: "var(--font-inter), sans-serif",
                lineHeight: 1.5,
                cursor: "not-allowed",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <button
              disabled
              style={{
                position: "absolute", bottom: 10, right: 10,
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 16px", borderRadius: 7,
                background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                color: "var(--app-text-4)", fontSize: 13, fontWeight: 500,
                cursor: "not-allowed",
                fontFamily: "var(--font-inter), sans-serif",
              }}
            >
              <Sparkles style={{ width: 13, height: 13 }} strokeWidth={1.8} />
              Ask
            </button>
          </div>
          <p style={{ fontSize: 12, color: "var(--app-text-4)", margin: "10px 0 0", textAlign: "center" }}>
            AI chat is under development. In the meantime, use search to explore shortage data.
          </p>
        </div>

        {/* Example questions */}
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Sparkles style={{ width: 14, height: 14, color: "var(--app-text-4)" }} strokeWidth={1.6} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Example questions
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {EXAMPLE_QUESTIONS.map((q) => {
              const searchQ = q
                .replace(/[?]/g, "")
                .split(" ")
                .slice(0, 4)
                .join(" ");
              return (
                <Link
                  key={q}
                  href={`/search?q=${encodeURIComponent(searchQ)}`}
                  style={{
                    display: "inline-block",
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "var(--panel)",
                    border: "1px solid var(--app-border)",
                    fontSize: 13,
                    color: "var(--app-text-2)",
                    textDecoration: "none",
                    lineHeight: 1.45,
                    transition: "border-color 0.12s, color 0.12s",
                  }}
                  className="example-chip"
                >
                  {q}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Info panel */}
        <div style={{
          maxWidth: 720, margin: "32px auto 0",
          background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12,
          padding: "20px 24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <MessageSquare style={{ width: 16, height: 16, color: "var(--teal)" }} strokeWidth={1.7} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
              What will AI Chat do?
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "Answer natural-language questions about drug availability and shortage reasons",
              "Suggest therapeutic alternatives when a drug is in short supply",
              "Summarise shortage trends across countries and drug classes",
              "Cite source data from TGA, FDA, Health Canada, MHRA and more",
            ].map((point) => (
              <div key={point} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "var(--teal)", flexShrink: 0, marginTop: 6,
                }} />
                <span style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.55 }}>{point}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--app-border)" }}>
            <Link href="/search" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 8,
              background: "var(--teal)", color: "#fff",
              fontSize: 13, fontWeight: 600, textDecoration: "none",
            }}>
              Search shortages now
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        .example-chip:hover { border-color: var(--teal-b) !important; color: var(--teal) !important; }
      `}</style>
    </div>
  );
}
