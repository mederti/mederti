"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";

function renderMarkdown(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1]) parts.push(<strong key={key++}>{match[1]}</strong>);
    else if (match[2]) parts.push(<em key={key++}>{match[2]}</em>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

interface DrugContext {
  id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  strength: string;
  form: string;
  activeShortageCount: number;
  affectedCountries: string[];
  worstSeverity: string;
  riskScore: number;
  riskLevel: string;
  alternativeCount: number;
  recallCount: number;
  shortagesByCountry: Array<{ country: string; code: string; severity: string }>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const PROMPT_CHIPS = [
  "When will stock return?",
  "Which alternatives are safe?",
  "Is my country affected?",
  "Historical shortage pattern",
];

export default function DrugChatPanel({
  drugId,
  drugContext,
  insightText,
}: {
  drugId: string;
  drugContext: DrugContext;
  insightText: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usedChips, setUsedChips] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch(`/api/drugs/${drugId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, drugContext }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      // Add empty assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "text" && payload.content) {
              assistantContent += payload.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Sorry, something went wrong: ${errMsg}` }]);
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, drugId, drugContext]);

  const handleChipClick = (chip: string) => {
    setUsedChips((prev) => new Set(prev).add(chip));
    sendMessage(chip);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#F8FAFC",
      borderRadius: 12,
      border: "1px solid var(--app-border)",
      borderLeft: "3px solid var(--teal)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--app-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--app-text-3)",
        }}>
          AI Insight
        </span>
        <span style={{
          fontSize: 11,
          color: "var(--indigo)",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={14} height={14} style={{ borderRadius: 3, opacity: 0.8 }} />
          AI-generated
        </span>
      </div>

      {/* Scrollable content */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        {/* Static insight */}
        <p style={{
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--app-text-2)",
          margin: 0,
          paddingBottom: 12,
          borderBottom: "1px solid var(--app-border)",
        }}>
          {insightText}
        </p>

        {/* Prompt chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, paddingBottom: 8 }}>
          {PROMPT_CHIPS.filter((chip) => !usedChips.has(chip)).map((chip) => (
            <button
              key={chip}
              onClick={() => handleChipClick(chip)}
              disabled={streaming}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 6,
                background: "var(--ind-bg)",
                color: "var(--indigo)",
                border: "1px solid var(--ind-b)",
                cursor: streaming ? "default" : "pointer",
                fontFamily: "var(--font-inter), sans-serif",
                transition: "opacity 0.2s",
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 8, padding: "24px 0",
            color: "var(--app-text-4)",
          }}>
            <span style={{ fontSize: 28, opacity: 0.4 }}>{"\uD83D\uDCAC"}</span>
            <span style={{ fontSize: 13 }}>Ask anything about this drug</span>
            <span style={{ fontSize: 11, color: "var(--app-text-4)" }}>
              Tap a suggestion above or type below
            </span>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div style={{
              maxWidth: "85%",
              padding: "10px 14px",
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: msg.role === "user" ? "var(--teal)" : "#fff",
              color: msg.role === "user" ? "#fff" : "var(--app-text-2)",
              fontSize: 13,
              lineHeight: 1.6,
              border: msg.role === "user" ? "none" : "1px solid var(--app-border)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {msg.content
                ? (msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content)
                : (streaming && i === messages.length - 1 ? (
                <span style={{ display: "inline-flex", gap: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "blink 1.4s ease-in-out infinite" }} />
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "blink 1.4s 0.2s ease-in-out infinite" }} />
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "blink 1.4s 0.4s ease-in-out infinite" }} />
                </span>
              ) : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--app-border)",
          display: "flex",
          gap: 8,
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${drugContext.generic_name}...`}
          disabled={streaming}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--app-border)",
            fontSize: 13,
            fontFamily: "var(--font-inter), sans-serif",
            outline: "none",
            background: "var(--app-bg)",
            color: "var(--app-text)",
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: streaming || !input.trim() ? "var(--app-border)" : "var(--teal)",
            color: "#fff",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: streaming || !input.trim() ? "default" : "pointer",
            fontFamily: "var(--font-inter), sans-serif",
            transition: "background 0.15s",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
