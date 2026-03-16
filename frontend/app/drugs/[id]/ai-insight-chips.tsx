"use client";

import { useState, useRef, useCallback } from "react";

/* ── Types ── */

interface DrugContext {
  drugName: string;
  genericName: string;
  drugId: string;
  activeShortageCount: number;
  anticipatedCount: number;
  affectedCountries: string[];
  anticipatedCountries: string[];
  worstSeverity: string;
  alternatives: Array<{ name: string; similarityScore: number }>;
  isAnticipatedOnly: boolean;
}

interface AiInsightChipsProps {
  drugContext: DrugContext;
  /** Static AI insight text rendered by the server component */
  insightText: string;
  /** Whether the drug has active (non-anticipated) shortages */
  hasActiveShortages: boolean;
}

/* ── Simple markdown bold renderer ── */

function renderBoldMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/* ── Chip questions ── */

const CHIP_QUESTIONS = [
  "When will stock return?",
  "Which alternatives are safe?",
  "Is my country affected?",
  "Historical shortage pattern",
];

/* ── Component ── */

export function AiInsightChips({ drugContext, insightText, hasActiveShortages }: AiInsightChipsProps) {
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleChipClick = useCallback(async (question: string) => {
    // If clicking same chip while loading, abort
    if (activeQuestion === question && loading) {
      abortRef.current?.abort();
      setLoading(false);
      return;
    }

    // If clicking same chip with answer shown, dismiss
    if (activeQuestion === question && answer) {
      setActiveQuestion(null);
      setAnswer("");
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();

    setActiveQuestion(question);
    setAnswer("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chip-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, drugContext }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setAnswer("Sorry, I couldn't generate an answer right now. Please try again.");
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setAnswer("Stream unavailable.");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === "text") {
              accumulated += event.content;
              setAnswer(accumulated);
            } else if (event.type === "done") {
              // Stream complete
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setAnswer("Sorry, something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [activeQuestion, answer, loading, drugContext]);

  const handleDismiss = useCallback(() => {
    abortRef.current?.abort();
    setActiveQuestion(null);
    setAnswer("");
    setLoading(false);
  }, []);

  return (
    <div style={{ padding: "4px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--app-text-3)" }}>AI Insight</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--indigo)", fontWeight: 500 }}>
          ✦ AI-generated
        </div>
      </div>

      {/* Static insight text */}
      <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--app-text-2)", marginBottom: 14 }}>
        {insightText}
      </p>

      {/* Chip buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {CHIP_QUESTIONS.map((q) => {
          const isActive = activeQuestion === q;
          return (
            <button
              key={q}
              onClick={() => handleChipClick(q)}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 6,
                background: isActive ? "var(--indigo)" : "var(--ind-bg)",
                color: isActive ? "#fff" : "var(--indigo)",
                border: `1px solid ${isActive ? "var(--indigo)" : "var(--ind-b)"}`,
                cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
                transition: "all 0.15s ease",
                opacity: loading && !isActive ? 0.5 : 1,
              }}
            >
              {isActive && loading ? "⏳ " : ""}{q}
            </button>
          );
        })}
      </div>

      {/* Inline answer */}
      {(loading || answer) && activeQuestion && (
        <div style={{
          marginTop: 12,
          padding: "14px 16px",
          background: "var(--ind-bg)",
          border: "1px solid var(--ind-b)",
          borderRadius: 10,
          position: "relative",
          animation: "fadeIn 0.2s ease",
        }}>
          {/* Question label */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--indigo)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {activeQuestion}
          </div>

          {/* Answer or loading */}
          {loading && !answer ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 14, height: 14, borderRadius: "50%",
                border: "2px solid var(--indigo)",
                borderTopColor: "transparent",
                animation: "spin 0.7s linear infinite",
              }} />
              <span style={{ fontSize: 13, color: "var(--app-text-3)" }}>Thinking…</span>
            </div>
          ) : (
            <div style={{
              fontSize: 13.5,
              lineHeight: 1.7,
              color: "var(--app-text-2)",
              whiteSpace: "pre-wrap",
            }}>
              {renderBoldMarkdown(answer)}
              {loading && (
                <span style={{
                  display: "inline-block",
                  width: 6,
                  height: 14,
                  background: "var(--indigo)",
                  marginLeft: 2,
                  animation: "blink 0.8s step-end infinite",
                  verticalAlign: "text-bottom",
                  borderRadius: 1,
                }} />
              )}
            </div>
          )}

          {/* Dismiss button */}
          {!loading && answer && (
            <button
              onClick={handleDismiss}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 22,
                height: 22,
                borderRadius: 4,
                border: "1px solid var(--ind-b)",
                background: "var(--app-bg)",
                color: "var(--app-text-4)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
              }}
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
