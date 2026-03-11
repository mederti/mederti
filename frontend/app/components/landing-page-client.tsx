"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Paperclip, Camera, ArrowUp, X, FileText,
  FileSpreadsheet, Image as ImageIcon, Pill, AlertTriangle,
  ExternalLink, ScanBarcode, Loader2, Search, RotateCcw,
} from "lucide-react";
import { DrugHit } from "@/lib/api";
import LandingContent from "./landing-content";

/* ── types ─────────────────────────────────────────────────────── */

interface AttachedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
}

interface ShortageRow {
  shortage_id: string;
  generic_name?: string;
  country?: string;
  country_code?: string;
  status: string;
  severity?: string;
  reason_category?: string;
  start_date?: string;
  estimated_resolution_date?: string;
  source_name?: string;
}

interface ShortageSummary {
  total_active: number;
  by_severity: Record<string, number>;
  by_country: Array<{ country_code: string; count: number }>;
  new_this_month: number;
  resolved_this_month: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  drugs?: DrugHit[];
  shortages?: ShortageRow[];
  summary?: ShortageSummary;
  files?: AttachedFile[];
  ts: number;
}

/* ── helpers ───────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type.startsWith("image/")) return <ImageIcon style={{ width: 14, height: 14 }} />;
  if (type.includes("spreadsheet") || type.includes("csv") || type.includes("excel"))
    return <FileSpreadsheet style={{ width: 14, height: 14 }} />;
  return <FileText style={{ width: 14, height: 14 }} />;
}

const SUGGESTIONS = [
  "Amoxicillin shortage in Australia",
  "Alternatives to metformin",
  "Critical drug shortages this month",
  "Cisplatin supply status",
];

/* ── component ─────────────────────────────────────────────────── */

export default function LandingPageClient({ totalActive }: { totalActive: string }) {
  const router = useRouter();
  const [query, setQuery]       = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles]       = useState<AttachedFile[]>([]);
  const [loading, setLoading]   = useState(false);
  const [focused, setFocused]   = useState(false);
  const inputRef    = useRef<HTMLInputElement>(null);
  const fileRef     = useRef<HTMLInputElement>(null);
  const cameraRef   = useRef<HTMLInputElement>(null);
  const chatEndRef  = useRef<HTMLDivElement>(null);

  const hasChat = messages.length > 0;

  // scroll to bottom on new messages
  useEffect(() => {
    if (hasChat) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, hasChat]);

  /* ── file handling ───────────────────────────────────────── */

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList).forEach((f) => {
      const af: AttachedFile = { id: uid(), name: f.name, type: f.type, size: f.size };
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          af.preview = reader.result as string;
          setFiles((prev) => prev.map((p) => (p.id === af.id ? { ...af } : p)));
        };
        reader.readAsDataURL(f);
      }
      setFiles((prev) => [...prev, af]);
    });
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  /* ── submit ──────────────────────────────────────────────── */

  const handleSubmit = useCallback(async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const q = (overrideQuery ?? query).trim();
    if (!q && files.length === 0) return;

    const userMsg: ChatMessage = {
      id: uid(), role: "user",
      text: q || `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
      files: files.length > 0 ? [...files] : undefined,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setFiles([]);
    setLoading(true);

    try {
      if (userMsg.files && userMsg.files.length > 0 && !q) {
        await new Promise((r) => setTimeout(r, 600));
        const fileNames = userMsg.files.map((f) => f.name).join(", ");
        setMessages((prev) => [
          ...prev,
          {
            id: uid(), role: "assistant",
            text: `I've received your file${userMsg.files!.length > 1 ? "s" : ""}: ${fileNames}.\n\nBulk drug shortage lookups from uploaded files are coming soon. In the meantime, type any drug name to search our database of ${totalActive}+ shortage records across 30 regulatory sources.`,
            ts: Date.now(),
          },
        ]);
      } else {
        // Build message history for the chat API
        const chatHistory = [
          ...messages.map((m) => ({ role: m.role, content: m.text })),
          { role: "user" as const, content: q },
        ];

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chatHistory }),
        });

        if (!res.ok) throw new Error(`Chat API returned ${res.status}`);

        const assistantId = uid();
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "", ts: Date.now() }]);

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("No response body");

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "text") {
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantId ? { ...m, text: m.text + event.content } : m
                ));
              } else if (event.type === "drugs") {
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantId ? { ...m, drugs: [...(m.drugs ?? []), ...event.data] } : m
                ));
              } else if (event.type === "shortages") {
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantId ? { ...m, shortages: [...(m.shortages ?? []), ...event.data] } : m
                ));
              } else if (event.type === "summary") {
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantId ? { ...m, summary: event.data } : m
                ));
              }
            } catch { /* skip malformed SSE lines */ }
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(), role: "assistant",
          text: "Sorry, I couldn't reach the AI assistant right now. Please try again in a moment.",
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [query, files, totalActive, messages]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }

  function clearChat() {
    setMessages([]);
    setFiles([]);
    setQuery("");
  }

  /* ── severity badge ──────────────────────────────────────── */

  function sevStyle(count: number) {
    if (count >= 3) return { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" };
    if (count >= 1) return { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" };
    return { bg: "var(--app-bg)", color: "var(--app-text-4)", border: "var(--app-border)" };
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <div className="lp-hero" style={{
        background: "var(--navy)",
        padding: hasChat ? "24px 24px 20px" : "36px 24px 24px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: hasChat ? 12 : 16,
        transition: "padding 0.3s",
      }}>
        {/* Title — compact when chatting */}
        <div style={{ textAlign: "center", maxWidth: 900 }}>
          {!hasChat ? (
            <>
              <h1 style={{
                fontSize: 42, fontWeight: 700, color: "#fff",
                letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 8,
              }}>
                Find Short-Supply Medicines Globally.
              </h1>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                Search drugs, upload bulk lists, or scan a barcode. Real-time data from 30 regulatory sources.
              </p>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <img src="/logo-white.png" alt="Mederti" style={{ height: 18 }} />
              <button
                onClick={clearChat}
                title="New search"
                style={{
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                  color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500,
                  fontFamily: "var(--font-inter), sans-serif",
                }}
              >
                <RotateCcw style={{ width: 11, height: 11 }} />
                New
              </button>
            </div>
          )}
        </div>

        {/* ── Input bar ──────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          style={{ maxWidth: 860, width: "100%", padding: "0" }}
        >
          {/* Attached file chips */}
          {files.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6,
              padding: "8px 12px 4px",
              background: "#fff",
              borderRadius: "12px 12px 0 0",
              border: "1px solid var(--app-border)",
              borderBottom: "none",
            }}>
              {files.map((f) => (
                <div key={f.id} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 8px 4px 10px", borderRadius: 6,
                  background: "var(--app-bg)",
                  fontSize: 12, color: "var(--app-text-3)",
                }}>
                  {f.preview ? (
                    <img src={f.preview} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover" }} />
                  ) : fileIcon(f.type)}
                  <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                  <button type="button" onClick={() => removeFile(f.id)} style={{
                    background: "none", border: "none", cursor: "pointer", padding: 2,
                    color: "var(--app-text-4)", display: "flex",
                  }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{
            display: "flex", alignItems: "center",
            background: "#fff",
            border: `1.5px solid ${focused ? "var(--teal)" : "var(--app-border)"}`,
            borderRadius: files.length > 0 ? "0 0 12px 12px" : 12,
            boxShadow: focused
              ? "0 0 0 3px rgba(13,148,136,0.12), 0 4px 20px rgba(0,0,0,0.06)"
              : "0 2px 12px rgba(0,0,0,0.05)",
            transition: "border-color 0.15s, box-shadow 0.15s",
            overflow: "hidden",
          }}>
            {/* Attach */}
            <button type="button" onClick={() => fileRef.current?.click()}
              title="Attach files (CSV, Excel, PDF, images)"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px 0 14px", display: "flex", alignItems: "center", color: "var(--app-text-4)", transition: "color 0.12s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--teal)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--app-text-4)"; }}
            >
              <Paperclip style={{ width: 16, height: 16, strokeWidth: 1.5 }} />
            </button>

            {/* Camera / scan */}
            <button type="button" onClick={() => cameraRef.current?.click()}
              title="Scan barcode or take photo of product"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 8px 0 4px", display: "flex", alignItems: "center", color: "var(--app-text-4)", transition: "color 0.12s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--teal)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--app-text-4)"; }}
            >
              <ScanBarcode style={{ width: 16, height: 16, strokeWidth: 1.5 }} />
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={hasChat ? "Ask a follow-up..." : "Search drugs, upload a file, or scan a barcode..."}
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1, padding: "14px 8px",
                border: "none", outline: "none",
                fontSize: 15, color: "var(--app-text)",
                fontFamily: "var(--font-inter), sans-serif",
                background: "transparent",
              }}
            />

            {/* Clear */}
            {query && (
              <button type="button" onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center", color: "var(--app-text-4)" }}>
                <X style={{ width: 14, height: 14, strokeWidth: 1.5 }} />
              </button>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading || (!query.trim() && files.length === 0)}
              style={{
                margin: 5, padding: 8,
                background: (query.trim() || files.length > 0) ? "var(--teal)" : "var(--app-bg)",
                border: "none", borderRadius: 8,
                color: (query.trim() || files.length > 0) ? "#fff" : "var(--app-text-4)",
                cursor: (query.trim() || files.length > 0) ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.12s, color 0.12s",
              }}>
              <ArrowUp style={{ width: 18, height: 18, strokeWidth: 2 }} />
            </button>
          </div>

          {/* Hint bar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
            padding: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Paperclip style={{ width: 10, height: 10 }} /> CSV, Excel, PDF
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Camera style={{ width: 10, height: 10 }} /> Photo or barcode
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Search style={{ width: 10, height: 10 }} /> Drug search
            </span>
          </div>
        </form>

        {/* Suggestion pills — only when no chat */}
        {!hasChat && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 860 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s}
                onClick={() => { handleSubmit(undefined, s); }}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 20,
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                  color: "rgba(255,255,255,0.55)", cursor: "pointer",
                  fontFamily: "var(--font-inter), sans-serif",
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(255,255,255,0.14)";
                  el.style.color = "rgba(255,255,255,0.8)";
                  el.style.borderColor = "rgba(255,255,255,0.3)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(255,255,255,0.08)";
                  el.style.color = "rgba(255,255,255,0.55)";
                  el.style.borderColor = "rgba(255,255,255,0.15)";
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Trust bar — only when no chat */}
        {!hasChat && (
          <div className="lp-trust-bar" style={{
            display: "flex", alignItems: "center", gap: 24, flexWrap: "nowrap",
            marginTop: 4,
          }}>
            {[
              { val: totalActive, label: "active shortages", href: "/shortages?status=active" },
              { val: "30",   label: "regulatory sources", href: "/shortages" },
              { val: "11",   label: "countries",          href: "/shortages" },
              { val: "live", label: "data feed",          href: "/shortages" },
            ].map(({ val, label, href }) => (
              <Link key={label} href={href} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12, color: "rgba(255,255,255,0.45)",
                textDecoration: "none",
              }}>
                <span style={{
                  fontFamily: "var(--font-dm-mono), monospace",
                  color: "rgba(255,255,255,0.75)", fontWeight: 500,
                }}>{val}</span>
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── CONTENT AREA ─────────────────────────────────────── */}
      {hasChat ? (
        /* Chat messages */
        <div style={{
          maxWidth: 860, width: "100%", margin: "0 auto",
          padding: "24px 24px 48px",
          display: "flex", flexDirection: "column", gap: 20,
          minHeight: 300,
        }}>
          {messages.map((msg) => (
            <div key={msg.id} style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}>
              <div style={{
                maxWidth: msg.role === "assistant" && msg.drugs ? "100%" : "85%",
                width: msg.role === "assistant" && msg.drugs ? "100%" : undefined,
              }}>
                {/* Bubble */}
                <div style={{
                  padding: "12px 16px",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: msg.role === "user" ? "var(--teal)" : "#fff",
                  color: msg.role === "user" ? "#fff" : "var(--app-text)",
                  fontSize: 14, lineHeight: 1.6,
                  border: msg.role === "assistant" ? "1px solid var(--app-border)" : "none",
                  boxShadow: msg.role === "assistant" ? "0 1px 4px rgba(0,0,0,0.04)" : "none",
                  whiteSpace: "pre-line",
                }}>
                  {/* Files in user message */}
                  {msg.files && msg.files.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: msg.text ? 10 : 0 }}>
                      {msg.files.map((f) => (
                        <div key={f.id} style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 10px", borderRadius: 8,
                          background: msg.role === "user" ? "rgba(255,255,255,0.15)" : "var(--app-bg)",
                          fontSize: 12,
                        }}>
                          {f.preview ? (
                            <img src={f.preview} alt={f.name}
                              style={{ width: 20, height: 20, borderRadius: 4, objectFit: "cover" }} />
                          ) : fileIcon(f.type)}
                          <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {f.name}
                          </span>
                          <span style={{ opacity: 0.6, fontSize: 11 }}>{fmtSize(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.text}
                </div>

                {/* Drug cards */}
                {msg.drugs && msg.drugs.length > 0 && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: 10, marginTop: 12,
                  }}>
                    {msg.drugs.map((drug) => {
                      const sev = sevStyle(drug.active_shortage_count);
                      return (
                        <button key={drug.drug_id}
                          onClick={() => router.push(`/drugs/${drug.drug_id}`)}
                          style={{
                            display: "flex", flexDirection: "column", gap: 6,
                            padding: "14px 16px", borderRadius: 10,
                            background: "#fff", border: "1px solid var(--app-border)",
                            cursor: "pointer", textAlign: "left",
                            transition: "border-color 0.12s, box-shadow 0.12s",
                            fontFamily: "var(--font-inter), sans-serif",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)";
                            (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(13,148,136,0.12)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--app-border)";
                            (e.currentTarget as HTMLElement).style.boxShadow = "none";
                          }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <Pill style={{ width: 14, height: 14, color: "var(--teal)", flexShrink: 0 }} />
                              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
                                {drug.generic_name}
                              </span>
                            </div>
                            <ExternalLink style={{ width: 12, height: 12, color: "var(--app-text-4)", flexShrink: 0 }} />
                          </div>
                          {drug.brand_names?.length > 0 && (
                            <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                              {drug.brand_names.slice(0, 3).join(" \u00B7 ")}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                            {drug.active_shortage_count > 0 ? (
                              <span style={{
                                display: "flex", alignItems: "center", gap: 4,
                                fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                                background: sev.bg, color: sev.color,
                                border: `1px solid ${sev.border}`,
                              }}>
                                <AlertTriangle style={{ width: 11, height: 11 }} />
                                {drug.active_shortage_count} shortage{drug.active_shortage_count !== 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 4,
                                background: "rgba(34,197,94,0.08)", color: "#16a34a",
                                border: "1px solid rgba(34,197,94,0.2)",
                              }}>
                                No shortages
                              </span>
                            )}
                            {drug.atc_code && (
                              <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                                {drug.atc_code}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Shortage rows */}
                {msg.shortages && msg.shortages.length > 0 && (
                  <div style={{ marginTop: 12, borderRadius: 10, border: "1px solid var(--app-border)", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
                          {["Drug", "Country", "Status", "Severity", "Since"].map((h) => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--app-text-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.shortages.map((s, i) => (
                          <tr key={s.shortage_id ?? i} style={{ borderBottom: i < msg.shortages!.length - 1 ? "1px solid var(--app-border)" : "none" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 500, color: "var(--app-text)" }}>{s.generic_name ?? "—"}</td>
                            <td style={{ padding: "8px 12px", color: "var(--app-text-3)" }}>{s.country_code ?? s.country ?? "—"}</td>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{
                                fontSize: 11, fontWeight: 500, padding: "2px 7px", borderRadius: 4,
                                background: s.status === "active" ? "var(--crit-bg)" : s.status === "anticipated" ? "var(--high-bg)" : "var(--app-bg)",
                                color: s.status === "active" ? "var(--crit)" : s.status === "anticipated" ? "var(--high)" : "var(--app-text-4)",
                              }}>{s.status}</span>
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              {s.severity && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                                  background: s.severity === "critical" ? "var(--crit-bg)" : s.severity === "high" ? "var(--high-bg)" : "var(--app-bg)",
                                  color: s.severity === "critical" ? "var(--crit)" : s.severity === "high" ? "var(--high)" : "var(--app-text-4)",
                                }}>{s.severity}</span>
                              )}
                            </td>
                            <td style={{ padding: "8px 12px", color: "var(--app-text-4)", fontSize: 12, fontFamily: "var(--font-dm-mono), monospace" }}>
                              {s.start_date ? new Date(s.start_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Summary card */}
                {msg.summary && (
                  <div style={{
                    marginTop: 12, padding: 16, borderRadius: 10,
                    background: "var(--app-bg)", border: "1px solid var(--app-border)",
                  }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
                      {[
                        { label: "Active", value: msg.summary.total_active, color: "var(--crit)" },
                        { label: "New this month", value: msg.summary.new_this_month, color: "var(--high)" },
                        { label: "Resolved this month", value: msg.summary.resolved_this_month, color: "#16a34a" },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ minWidth: 100 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "var(--font-dm-mono), monospace" }}>{value.toLocaleString()}</div>
                          <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {Object.entries(msg.summary.by_severity).filter(([, v]) => v > 0).map(([sev, count]) => (
                        <span key={sev} style={{
                          fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 4,
                          background: sev === "critical" ? "var(--crit-bg)" : sev === "high" ? "var(--high-bg)" : "var(--app-bg)",
                          color: sev === "critical" ? "var(--crit)" : sev === "high" ? "var(--high)" : "var(--app-text-3)",
                          border: `1px solid ${sev === "critical" ? "var(--crit-b)" : sev === "high" ? "var(--high-b)" : "var(--app-border)"}`,
                        }}>{sev}: {count.toLocaleString()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                padding: "12px 16px", borderRadius: "16px 16px 16px 4px",
                background: "#fff", border: "1px solid var(--app-border)",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 14, color: "var(--app-text-4)",
              }}>
                <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                Thinking...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      ) : (
        /* Marketing content */
        <LandingContent />
      )}

      {/* ── Hidden file inputs ─────────────────────────────── */}
      <input ref={fileRef} type="file" multiple
        accept=".csv,.xlsx,.xls,.pdf,image/*,.tsv"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        style={{ display: "none" }} />
      <input ref={cameraRef} type="file"
        accept="image/*" capture="environment"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        style={{ display: "none" }} />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
