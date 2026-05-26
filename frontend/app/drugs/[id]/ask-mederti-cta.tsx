import Link from "next/link";

/**
 * Drop-in replacement for the per-drug chat panel (V3ChatPanel).
 * Instead of a second chat surface duplicating /chat, this surfaces
 * three preset prompts + a free-form CTA that deep-link into the
 * global /chat experience with the prompt pre-filled and auto-sent.
 *
 * Server component — pure render.
 */
export function AskMedertiCta({ drugName }: { drugName: string }) {
  const prompts = [
    "When will stock return?",
    "Which alternatives are safe?",
    "Is my country affected?",
  ];

  const seed = (q: string) =>
    `/chat?q=${encodeURIComponent(`${q} (${drugName})`)}&send=1`;

  return (
    <div
      style={{
        padding: "14px 14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--app-text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        Ask Mederti about {drugName}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {prompts.map((q) => (
          <Link
            key={q}
            href={seed(q)}
            style={{
              display: "block",
              padding: "8px 12px",
              background: "var(--app-bg-2)",
              color: "var(--app-text)",
              border: "1px solid var(--app-border)",
              borderRadius: 8,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            {q}
          </Link>
        ))}
      </div>

      <Link
        href={`/chat?q=${encodeURIComponent(`Tell me about ${drugName}`)}&send=1`}
        style={{
          marginTop: 4,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--teal)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 500,
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        Open in chat →
      </Link>

      <div
        style={{
          fontSize: 11,
          color: "var(--app-text-3)",
          lineHeight: 1.5,
          marginTop: 4,
        }}
      >
        Mederti reads live regulator data from major markets worldwide and
        answers in plain English. Tools include shortage history, alternatives,
        recalls, and macro signals.
      </div>
    </div>
  );
}
