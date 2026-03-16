"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import SiteNav from "@/app/components/landing-nav";

/* ── Types ─────────────────────────────────────────────────── */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  drugs?: DrugHit[];
  shortages?: ShortageHit[];
  summary?: SummaryData | null;
}

interface DrugHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
}

interface ShortageHit {
  shortage_id: string;
  generic_name?: string;
  country_code: string;
  status: string;
  severity: string;
  reason_category?: string;
  start_date: string;
  source_name?: string;
}

interface SummaryData {
  total_active: number;
  by_severity: Record<string, number>;
  by_country: Array<{ country_code: string; count: number }>;
  new_this_month: number;
  resolved_this_month: number;
}

/* ── Markdown renderer ─────────────────────────────────────── */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let last = 0;
  let match;
  let k = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={`${keyPrefix}-${k++}`}>{match[1]}</strong>);
    else if (match[2]) parts.push(<em key={`${keyPrefix}-${k++}`}>{match[2]}</em>);
    else if (match[3]) parts.push(
      <code key={`${keyPrefix}-${k++}`} style={{
        padding: "1px 5px", borderRadius: 4, fontSize: "0.9em",
        background: "var(--app-bg)", fontFamily: "var(--font-dm-mono), monospace",
      }}>{match[3]}</code>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text: string): ReactNode {
  if (!text) return null;

  // Split into paragraphs by double newlines
  const blocks = text.split(/\n\n+/);

  return blocks.map((block, bi) => {
    const lines = block.split("\n");

    // Check if all lines are bullets
    const allBullets = lines.every((l) => /^\s*[-•]\s/.test(l) || l.trim() === "");
    if (allBullets && lines.some((l) => /^\s*[-•]\s/.test(l))) {
      return (
        <ul key={bi} style={{ margin: "0 0 16px", paddingLeft: 20, listStyle: "none" }}>
          {lines
            .filter((l) => /^\s*[-•]\s/.test(l))
            .map((l, li) => {
              const content = l.trimStart().replace(/^[-•]\s/, "");
              return (
                <li key={li} style={{ position: "relative", paddingLeft: 14, marginBottom: 6, lineHeight: 1.65 }}>
                  <span style={{ position: "absolute", left: 0, color: "var(--teal)", fontWeight: 600 }}>•</span>
                  {renderInline(content, `${bi}-${li}`)}
                </li>
              );
            })}
        </ul>
      );
    }

    // Regular paragraph
    return (
      <p key={bi} style={{ margin: "0 0 16px", lineHeight: 1.7 }}>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </span>
        ))}
      </p>
    );
  });
}

/* ── Severity badge ────────────────────────────────────────── */

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    critical: { bg: "var(--crit-bg)", color: "var(--crit)" },
    high: { bg: "var(--hi-bg)", color: "var(--hi)" },
    medium: { bg: "var(--med-bg)", color: "var(--med)" },
    low: { bg: "var(--low-bg)", color: "var(--low)" },
  };
  const s = map[severity?.toLowerCase()] ?? map.low;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
      background: s.bg, color: s.color, textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {severity}
    </span>
  );
}

/* ── Drug pills ────────────────────────────────────────────── */

function DrugPills({ drugs }: { drugs: DrugHit[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 4px" }}>
      {drugs.slice(0, 6).map((d) => (
        <Link
          key={d.drug_id}
          href={`/drugs/${d.drug_id}`}
          className="chat-drug-pill"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 20,
            background: "var(--app-bg)", border: "1px solid var(--app-border)",
            textDecoration: "none", color: "var(--app-text)",
            fontSize: 13, fontWeight: 500,
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          {d.generic_name}
          {d.active_shortage_count > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              padding: "1px 6px", borderRadius: 10,
              background: "var(--hi-bg)", color: "var(--hi)",
            }}>
              {d.active_shortage_count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

/* ── Shortage table ────────────────────────────────────────── */

function ShortageTable({ shortages }: { shortages: ShortageHit[] }) {
  return (
    <div style={{
      margin: "12px 0 4px", borderRadius: 10, overflow: "hidden",
      border: "1px solid var(--app-border)", background: "#fff",
    }}>
      {shortages.slice(0, 8).map((s, i) => (
        <div
          key={s.shortage_id}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 14px",
            borderBottom: i < Math.min(shortages.length, 8) - 1 ? "1px solid var(--app-border)" : "none",
            fontSize: 13,
          }}
        >
          <span style={{
            fontWeight: 600, fontSize: 11, color: "var(--app-text-3)",
            fontFamily: "var(--font-dm-mono), monospace",
            minWidth: 24, letterSpacing: "0.02em",
          }}>
            {s.country_code}
          </span>
          {s.generic_name && (
            <span style={{ fontWeight: 500, color: "var(--app-text)" }}>{s.generic_name}</span>
          )}
          <SeverityBadge severity={s.severity} />
          <span style={{
            color: "var(--app-text-4)", marginLeft: "auto", fontSize: 12,
            fontFamily: "var(--font-dm-mono), monospace",
          }}>
            {s.start_date}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Summary stats ─────────────────────────────────────────── */

function SummaryStats({ data }: { data: SummaryData }) {
  const items = [
    { value: data.total_active, label: "Active", color: "var(--app-text)" },
    { value: data.by_severity.critical ?? 0, label: "Critical", color: "var(--crit)" },
    { value: data.by_severity.high ?? 0, label: "High", color: "var(--hi)" },
    { value: data.new_this_month, label: "New this month", color: "var(--teal)" },
    { value: data.resolved_this_month, label: "Resolved", color: "var(--low)" },
  ];
  return (
    <div style={{
      display: "flex", gap: 20, flexWrap: "wrap",
      margin: "12px 0 4px", padding: "16px 20px",
      borderRadius: 10, border: "1px solid var(--app-border)", background: "#fff",
    }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ fontSize: 22, fontWeight: 700, color: item.color, letterSpacing: "-0.02em" }}>
            {item.value.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 1 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Suggested queries ─────────────────────────────────────── */

const SUGGESTED_QUERIES = [
  "What's the global shortage situation?",
  "Is amoxicillin available in Australia?",
  "Alternatives to metformin",
  "Critical shortages in the US",
  "Cisplatin recalls",
  "Which country has the most shortages?",
];

/* ── Thinking indicator ────────────────────────────────────── */

function ThinkingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%",
        background: "var(--teal)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, flexShrink: 0,
      }}>
        M
      </div>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <span className="chat-dot" style={{ animationDelay: "0s" }} />
        <span className="chat-dot" style={{ animationDelay: "0.15s" }} />
        <span className="chat-dot" style={{ animationDelay: "0.3s" }} />
      </span>
    </div>
  );
}

/* ── Main chat page ────────────────────────────────────────── */

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setStreaming(true);

    if (inputRef.current) inputRef.current.style.height = "auto";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let assistantDrugs: DrugHit[] = [];
      let assistantShortages: ShortageHit[] = [];
      let assistantSummary: SummaryData | null = null;
      let buffer = "";

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
            } else if (payload.type === "drugs" && payload.data) {
              assistantDrugs = [...assistantDrugs, ...payload.data];
            } else if (payload.type === "shortages" && payload.data) {
              assistantShortages = [...assistantShortages, ...payload.data];
            } else if (payload.type === "summary" && payload.data) {
              assistantSummary = payload.data;
            } else if (payload.type === "done") {
              break;
            }

            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: assistantContent,
                drugs: assistantDrugs.length > 0 ? assistantDrugs : undefined,
                shortages: assistantShortages.length > 0 ? assistantShortages : undefined,
                summary: assistantSummary,
              };
              return updated;
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${errMsg}. Please try again.` },
      ]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [messages, streaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", background: "#fff",
      color: "var(--app-text)",
    }}>
      <SiteNav />

      {/* Scrollable area */}
      <div
        ref={scrollAreaRef}
        style={{
          flex: 1, overflowY: "auto",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          maxWidth: 720, width: "100%", margin: "0 auto",
          padding: "0 24px",
        }}>

          {/* ── Empty state ── */}
          {isEmpty && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              paddingBottom: 80,
            }}>
              {/* Logo mark */}
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "var(--teal)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, marginBottom: 20,
                boxShadow: "0 2px 12px rgba(13,148,136,0.20)",
              }}>
                M
              </div>

              <h1 style={{
                fontSize: 22, fontWeight: 600,
                color: "var(--app-text)", margin: "0 0 8px",
                letterSpacing: "-0.02em",
              }}>
                What do you want to know?
              </h1>

              <p style={{
                fontSize: 14, color: "var(--app-text-4)",
                margin: "0 0 32px", textAlign: "center", maxWidth: 380,
                lineHeight: 1.6,
              }}>
                Ask about drug shortages, alternatives, recalls, or supply intelligence across 30+ countries.
              </p>

              {/* Suggestions */}
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 8,
                justifyContent: "center", maxWidth: 560,
              }}>
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="chat-chip"
                    style={{
                      padding: "8px 16px", borderRadius: 20,
                      background: "var(--app-bg)", border: "1px solid var(--app-border)",
                      fontSize: 13, color: "var(--app-text-3)",
                      cursor: "pointer",
                      fontFamily: "var(--font-inter), sans-serif",
                      transition: "color 0.15s, border-color 0.15s, background 0.15s",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Conversation ── */}
          {!isEmpty && (
            <div style={{ paddingTop: 32, paddingBottom: 16 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 28 }}>
                  {msg.role === "user" ? (
                    /* ── User turn ── */
                    <div style={{
                      display: "flex", justifyContent: "flex-end",
                    }}>
                      <div style={{
                        maxWidth: "80%",
                        padding: "12px 18px",
                        borderRadius: 20,
                        background: "var(--app-bg)",
                        fontSize: 15, lineHeight: 1.6,
                        color: "var(--app-text)",
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    /* ── Assistant turn ── */
                    <div>
                      {/* Small avatar + name */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        marginBottom: 8,
                      }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: "var(--teal)", color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 700, flexShrink: 0,
                        }}>
                          M
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)" }}>
                          Mederti
                        </span>
                      </div>

                      {/* Structured data — inline with the prose */}
                      {msg.summary && <SummaryStats data={msg.summary} />}
                      {msg.drugs && msg.drugs.length > 0 && <DrugPills drugs={msg.drugs} />}
                      {msg.shortages && msg.shortages.length > 0 && <ShortageTable shortages={msg.shortages} />}

                      {/* Text — flows naturally, no bubble */}
                      {msg.content ? (
                        <div style={{
                          fontSize: 15, lineHeight: 1.7,
                          color: "var(--app-text-2)",
                          marginTop: (msg.drugs || msg.shortages || msg.summary) ? 12 : 0,
                        }}>
                          {renderMarkdown(msg.content)}
                        </div>
                      ) : (
                        streaming && i === messages.length - 1 && (
                          <ThinkingIndicator />
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* ── Input bar — fixed at bottom ── */}
      <div style={{
        borderTop: "1px solid var(--app-border)",
        background: "#fff",
        padding: "16px 24px 20px",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <form
            onSubmit={handleSubmit}
            className="chat-input-form"
            style={{
              display: "flex", alignItems: "flex-end", gap: 10,
              background: "var(--app-bg)",
              border: "1px solid var(--app-border)",
              borderRadius: 16,
              padding: "10px 14px 10px 18px",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about drug shortages..."
              disabled={streaming}
              rows={1}
              style={{
                flex: 1, resize: "none",
                border: "none", outline: "none",
                fontSize: 15, lineHeight: 1.5,
                fontFamily: "var(--font-inter), sans-serif",
                color: "var(--app-text)",
                background: "transparent",
                padding: "4px 0",
                maxHeight: 160,
              }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: "50%",
                background: streaming || !input.trim() ? "var(--app-border)" : "var(--teal)",
                color: "#fff", border: "none",
                cursor: streaming || !input.trim() ? "default" : "pointer",
                flexShrink: 0,
                transition: "background 0.15s, transform 0.1s",
              }}
              aria-label="Send message"
            >
              <Send style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            </button>
          </form>

          <div style={{
            fontSize: 11, color: "var(--app-text-4)",
            textAlign: "center", marginTop: 8,
            letterSpacing: "0.01em",
          }}>
            AI-powered &middot; 30+ regulatory sources &middot; Not medical advice
          </div>
        </div>
      </div>

      <style>{`
        @keyframes chatBlink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 0.8; }
        }
        .chat-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--app-text-4);
          animation: chatBlink 1.2s ease-in-out infinite;
        }
        .chat-chip:hover {
          border-color: var(--teal-b) !important;
          color: var(--teal) !important;
          background: var(--teal-bg) !important;
        }
        .chat-drug-pill:hover {
          border-color: var(--teal-b) !important;
          background: var(--teal-bg) !important;
        }
        .chat-input-form:focus-within {
          border-color: var(--teal-b) !important;
          box-shadow: 0 0 0 3px rgba(13,148,136,0.08) !important;
        }
        @media (max-width: 640px) {
          .chat-chip { font-size: 12px !important; padding: 7px 13px !important; }
        }
      `}</style>
    </div>
  );
}
