"use client";

import { useEffect, useState } from "react";

export function TopicalChip({ onSelect }: { onSelect: (q: string) => void }) {
  const [question, setQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/daily-question")
      .then((r) => r.json())
      .then((data) => {
        setQuestion(data.question);
        setLoading(false);
      })
      .catch(() => {
        setQuestion(
          "How are current geopolitical tensions affecting global pharmaceutical supply chains?"
        );
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div
        style={{
          padding: "10px 20px",
          borderRadius: 99,
          border: "1px solid var(--app-border)",
          background: "#fff",
          fontSize: 13,
          color: "var(--app-text-4)",
          cursor: "default",
          width: 280,
          height: 40,
          opacity: 0.4,
        }}
      />
    );
  }

  if (!question) return null;

  return (
    <button
      onClick={() => onSelect(question)}
      className="chat-chip"
      style={{
        padding: "10px 20px",
        borderRadius: 99,
        background: "#fff",
        border: "1px solid var(--app-border)",
        fontSize: 13,
        color: "var(--app-text-3)",
        cursor: "pointer",
        textAlign: "center",
        fontFamily: "var(--font-inter), sans-serif",
        transition: "background 0.15s, border-color 0.15s, color 0.15s",
        lineHeight: 1.4,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>📰</span>
      <span>{question}</span>
    </button>
  );
}
