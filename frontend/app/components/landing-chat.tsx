"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Paperclip, Camera, ArrowUp, X, FileText,
  FileSpreadsheet, Image as ImageIcon, Pill, AlertTriangle,
  ExternalLink, ScanBarcode, Loader2,
} from "lucide-react";
import { api, DrugHit } from "@/lib/api";

/* ── types ─────────────────────────────────────────────────────── */

interface AttachedFile {
  id: string;
  name: string;
  type: string;       // mime
  size: number;
  preview?: string;   // data URL for images
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  drugs?: DrugHit[];
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

export default function LandingChatClient() {
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

  // scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── file handling ───────────────────────────────────────── */

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const arr = Array.from(fileList);
    arr.forEach((f) => {
      const af: AttachedFile = {
        id: uid(), name: f.name, type: f.type, size: f.size,
      };
      // generate preview for images
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

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q && files.length === 0) return;

    // Build user message
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
      // If there are files, respond with file analysis message
      if (userMsg.files && userMsg.files.length > 0 && !q) {
        await new Promise((r) => setTimeout(r, 600));
        const fileNames = userMsg.files.map((f) => f.name).join(", ");
        setMessages((prev) => [
          ...prev,
          {
            id: uid(), role: "assistant",
            text: `I've received your file${userMsg.files!.length > 1 ? "s" : ""}: ${fileNames}. Bulk drug shortage lookups from uploaded files are coming soon. In the meantime, you can type any drug name to search our database of 12,400+ shortage records.`,
            ts: Date.now(),
          },
        ]);
      } else {
        // Search for drugs
        const searchQ = q || "";
        const res = await api.search(searchQ, 6);

        if (res.results.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(), role: "assistant",
              text: `I found ${res.total} result${res.total !== 1 ? "s" : ""} for "${searchQ}". Here are the top matches:`,
              drugs: res.results,
              ts: Date.now(),
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(), role: "assistant",
              text: `No drugs matched "${searchQ}" in our database. Try searching for a generic drug name like "amoxicillin" or "metformin", or upload a CSV of drug names for bulk lookup.`,
              ts: Date.now(),
            },
          ]);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(), role: "assistant",
          text: "Sorry, I couldn't reach the search API right now. Please try again in a moment.",
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [query, files]);

  /* ── keyboard ────────────────────────────────────────────── */

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const hasChat = messages.length > 0;

  /* ── severity badge color ──────────────────────────────── */
  function sevStyle(count: number) {
    if (count >= 3) return { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" };
    if (count >= 1) return { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" };
    return { bg: "var(--app-bg)", color: "var(--app-text-4)", border: "var(--app-border)" };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>

      {/* ── Chat messages ──────────────────────────────────── */}
      {hasChat && (
        <div style={{
          maxWidth: 860, width: "100%", margin: "0 auto",
          padding: "0 24px",
          display: "flex", flexDirection: "column", gap: 20,
          paddingTop: 8,
        }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div style={{
                maxWidth: msg.role === "assistant" && msg.drugs ? "100%" : "85%",
                width: msg.role === "assistant" && msg.drugs ? "100%" : undefined,
              }}>
                {/* Message bubble */}
                <div style={{
                  padding: msg.role === "user" ? "12px 16px" : "4px 0",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : 0,
                  background: msg.role === "user" ? "var(--teal)" : "transparent",
                  color: msg.role === "user" ? "#fff" : "var(--app-text)",
                  fontSize: 14, lineHeight: 1.6,
                  border: "none",
                  boxShadow: "none",
                }}>
                  {/* Attached files in user message */}
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
                            <img
                              src={f.preview} alt={f.name}
                              style={{ width: 20, height: 20, borderRadius: 4, objectFit: "cover" }}
                            />
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

                {/* Drug result cards */}
                {msg.drugs && msg.drugs.length > 0 && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: 10, marginTop: 12,
                  }}>
                    {msg.drugs.map((drug) => {
                      const sev = sevStyle(drug.active_shortage_count);
                      return (
                        <button
                          key={drug.drug_id}
                          onClick={() => router.push(`/drugs/${drug.drug_id}`)}
                          style={{
                            display: "flex", flexDirection: "column", gap: 6,
                            padding: "14px 16px", borderRadius: 10,
                            background: "var(--app-bg-2, #f8fafc)", border: "1px solid var(--app-border)",
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
                          }}
                        >
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
                              {drug.brand_names.slice(0, 3).join(" · ")}
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
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                padding: "4px 0",
                background: "transparent",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 14, color: "var(--app-text-4)",
              }}>
                <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                Searching...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      )}

      {/* ── Suggestion pills (when no chat yet) ────────────── */}
      {!hasChat && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
          maxWidth: 860, margin: "0 auto", width: "100%", padding: "0 24px",
        }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setQuery(s); inputRef.current?.focus(); }}
              style={{
                fontSize: 12, padding: "6px 14px", borderRadius: 20,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.55)", cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.14)";
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.8)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.3)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ──────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        style={{
          maxWidth: 860, width: "100%", margin: hasChat ? "12px auto 0" : "16px auto 0",
          padding: "0 24px",
        }}
      >
        {/* Attached file chips */}
        {files.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6,
            padding: "8px 12px 4px",
            background: hasChat ? "#fff" : "rgba(255,255,255,0.06)",
            borderRadius: "12px 12px 0 0",
            border: hasChat ? "1px solid var(--app-border)" : "1px solid rgba(255,255,255,0.12)",
            borderBottom: "none",
          }}>
            {files.map((f) => (
              <div key={f.id} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 8px 4px 10px", borderRadius: 6,
                background: hasChat ? "var(--app-bg)" : "rgba(255,255,255,0.1)",
                fontSize: 12, color: hasChat ? "var(--app-text-3)" : "rgba(255,255,255,0.7)",
              }}>
                {f.preview ? (
                  <img src={f.preview} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover" }} />
                ) : fileIcon(f.type)}
                <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <button type="button" onClick={() => removeFile(f.id)} style={{
                  background: "none", border: "none", cursor: "pointer", padding: 2,
                  color: hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)",
                  display: "flex",
                }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center",
          background: hasChat ? "#fff" : "rgba(255,255,255,0.06)",
          border: hasChat
            ? `1.5px solid ${focused ? "var(--teal)" : "var(--app-border)"}`
            : `1.5px solid ${focused ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: files.length > 0 ? "0 0 12px 12px" : 12,
          boxShadow: focused
            ? hasChat
              ? "0 0 0 3px rgba(13,148,136,0.12), 0 4px 20px rgba(0,0,0,0.06)"
              : "0 0 0 3px rgba(255,255,255,0.06)"
            : hasChat
              ? "0 2px 12px rgba(0,0,0,0.05)"
              : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
          overflow: "hidden",
        }}>

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach files (CSV, Excel, PDF, images)"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "0 4px 0 14px", display: "flex", alignItems: "center",
              color: hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = hasChat ? "var(--teal)" : "rgba(255,255,255,0.7)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)"; }}
          >
            <Paperclip style={{ width: 16, height: 16, strokeWidth: 1.5 }} />
          </button>

          {/* Camera / scan button */}
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            title="Scan barcode or take photo of product"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "0 8px 0 4px", display: "flex", alignItems: "center",
              color: hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = hasChat ? "var(--teal)" : "rgba(255,255,255,0.7)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)"; }}
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
              fontSize: 15,
              color: hasChat ? "var(--app-text)" : "#fff",
              fontFamily: "var(--font-inter), sans-serif",
              background: "transparent",
            }}
          />

          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "0 6px", display: "flex", alignItems: "center",
                color: hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.4)",
              }}
            >
              <X style={{ width: 14, height: 14, strokeWidth: 1.5 }} />
            </button>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading || (!query.trim() && files.length === 0)}
            style={{
              margin: 5, padding: "8px 8px",
              background: (query.trim() || files.length > 0) ? "var(--teal)" : hasChat ? "var(--app-bg)" : "rgba(255,255,255,0.08)",
              border: "none", borderRadius: 8,
              color: (query.trim() || files.length > 0) ? "#fff" : hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.3)",
              cursor: (query.trim() || files.length > 0) ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.12s, color 0.12s",
            }}
          >
            <ArrowUp style={{ width: 18, height: 18, strokeWidth: 2 }} />
          </button>
        </div>

        {/* Sub-bar hint text */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
          padding: "8px 0 0",
          fontSize: 11,
          color: hasChat ? "var(--app-text-4)" : "rgba(255,255,255,0.3)",
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

      {/* ── Hidden file inputs ─────────────────────────────── */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,.pdf,image/*,.tsv"
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: "none" }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: "none" }}
      />

      {/* Spin animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
