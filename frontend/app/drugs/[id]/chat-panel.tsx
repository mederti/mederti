"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface DrugHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
}

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
];

export default function V3ChatPanel({
  drugId,
  drugContext,
  openingMessage,
}: {
  drugId: string;
  drugContext: DrugContext;
  openingMessage: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: openingMessage },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usedChips, setUsedChips] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DrugHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus search input when opening
  useEffect(() => {
    if (searching) searchInputRef.current?.focus();
  }, [searching]);

  // Close search on click outside
  useEffect(() => {
    if (!searching) return;
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearching(false);
        setSearchQuery("");
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searching]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=6`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results ?? []);
        }
      } catch { /* ignore */ }
      setSearchLoading(false);
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 1) scrollToBottom();
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
      let pivotTarget: { drug_id: string; generic_name: string } | null = null;

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
            } else if (payload.type === "pivot" && payload.drug_id) {
              pivotTarget = { drug_id: payload.drug_id, generic_name: payload.generic_name ?? "" };
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      // Navigate to the new drug page if a pivot was detected
      if (pivotTarget) {
        setTimeout(() => router.push(`/drugs/${pivotTarget!.drug_id}`), 600);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Sorry, something went wrong: ${errMsg}` }]);
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, drugId, drugContext, router]);

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
      background: "#fff",
    }}>
      {/* Header — logo pill + drug name / search */}
      <div ref={searchContainerRef} style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--app-border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
        position: "relative",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 6,
          background: "var(--teal)", color: "#fff",
          fontSize: 11, fontWeight: 600, letterSpacing: "0.03em",
        }}>
          Mederti
        </span>

        {searching ? (
          <div style={{ flex: 1, position: "relative" }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearching(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }
              }}
              placeholder={"Search drugs\u2026"}
              style={{
                width: "100%",
                padding: "5px 10px",
                borderRadius: 6,
                border: "1px solid var(--teal)",
                fontSize: 12,
                fontFamily: "var(--font-inter), sans-serif",
                outline: "none",
                background: "#fff",
                color: "var(--app-text)",
              }}
            />
            {/* Dropdown */}
            {(searchResults.length > 0 || searchLoading) && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid var(--app-border)",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                zIndex: 100,
                maxHeight: 260,
                overflowY: "auto",
              }}>
                {searchLoading && searchResults.length === 0 ? (
                  <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--app-text-3)" }}>
                    Searching\u2026
                  </div>
                ) : searchResults.map((hit) => (
                  <button
                    key={hit.drug_id}
                    onClick={() => {
                      setSearching(false);
                      setSearchQuery("");
                      setSearchResults([]);
                      router.push(`/drugs/${hit.drug_id}`);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "9px 14px",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--app-border)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--font-inter), sans-serif",
                      fontSize: 12,
                      color: "var(--app-text)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--app-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{hit.generic_name}</span>
                      {hit.brand_names?.length > 0 && (
                        <span style={{ color: "var(--app-text-3)", marginLeft: 6 }}>
                          {hit.brand_names[0].length > 30 ? hit.brand_names[0].slice(0, 30) + "\u2026" : hit.brand_names[0]}
                        </span>
                      )}
                    </span>
                    {hit.active_shortage_count > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        padding: "2px 6px", borderRadius: 4,
                        background: "var(--hi-bg)", color: "var(--hi)",
                      }}>
                        {hit.active_shortage_count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setSearching(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 6,
              background: "var(--app-bg)", color: "var(--app-text)",
              fontSize: 12, fontWeight: 500,
              border: "1px solid var(--app-border)",
              cursor: "pointer",
              fontFamily: "var(--font-inter), sans-serif",
              transition: "border-color 0.15s",
            }}
            title="Click to search for another drug"
          >
            {drugContext.generic_name}
            {drugContext.strength && (
              <span style={{ color: "var(--app-text-3)", fontWeight: 400 }}>
                {drugContext.strength}
              </span>
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--app-text-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        )}
      </div>

      {/* Chat history — scrolls independently */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 20px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {msg.role === "assistant" && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src="/favicon.ico"
                alt="Mederti"
                width={26}
                height={26}
                style={{ borderRadius: 7, flexShrink: 0, marginRight: 8, marginTop: 2, width: 26, height: 26, objectFit: "contain" }}
              />
            )}
            <div style={{
              maxWidth: "82%",
              padding: "11px 15px",
              borderRadius: msg.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
              background: msg.role === "user" ? "var(--teal)" : "#F1F5F9",
              color: msg.role === "user" ? "#fff" : "var(--app-text-2)",
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {msg.content
                ? (msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content)
                : (streaming && i === messages.length - 1 ? (
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "v3blink 1.4s ease-in-out infinite" }} />
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "v3blink 1.4s 0.2s ease-in-out infinite" }} />
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--app-text-4)", animation: "v3blink 1.4s 0.4s ease-in-out infinite" }} />
                  </span>
                ) : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Prompt chips + input — pinned at bottom */}
      <div style={{
        borderTop: "1px solid var(--app-border)",
        padding: "12px 20px 14px",
        flexShrink: 0,
        background: "#fff",
      }}>
        {/* Chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {PROMPT_CHIPS.filter((chip) => !usedChips.has(chip)).map((chip) => (
            <button
              key={chip}
              onClick={() => handleChipClick(chip)}
              disabled={streaming}
              style={{
                fontSize: 11,
                padding: "5px 11px",
                borderRadius: 6,
                background: "var(--ind-bg)",
                color: "var(--indigo)",
                border: "1px solid var(--ind-b)",
                cursor: streaming ? "default" : "pointer",
                fontFamily: "var(--font-inter), sans-serif",
                transition: "opacity 0.15s",
                opacity: streaming ? 0.5 : 1,
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${drugContext.generic_name} or any drug\u2026`}
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

        {/* Hint */}
        <div style={{ fontSize: 10, color: "var(--app-text-4)", marginTop: 6, textAlign: "center" }}>
          {drugContext.generic_name} context loaded &middot; Ask about any drug or shortage
        </div>
      </div>
    </div>
  );
}
