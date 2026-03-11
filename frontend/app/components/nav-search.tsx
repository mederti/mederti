"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, DrugHit } from "@/lib/api";

export function NavSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await api.search(q, 6);
      setResults(res.results);
      setOpen(res.results.length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(() => search(query), 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCursor(-1);
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function go(drug: DrugHit) {
    setOpen(false);
    setQuery("");
    setCursor(-1);
    inputRef.current?.blur();
    router.push(`/drugs/${drug.drug_id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (cursor >= 0 && results[cursor]) { go(results[cursor]); return; }
      if (results.length > 0) { go(results[0]); return; }
      if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
    if (e.key === "Escape") { setOpen(false); setCursor(-1); inputRef.current?.blur(); }
  }

  return (
    <div ref={boxRef} style={{ position: "relative", flex: 1, maxWidth: 360, minWidth: 220 }}>
      <div style={{
        display: "flex", alignItems: "center",
        background: focused ? "#fff" : "var(--app-bg)",
        border: `1.5px solid ${focused ? "var(--teal)" : "var(--app-border)"}`,
        borderRadius: 8,
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        boxShadow: focused ? "0 0 0 3px rgba(13,148,136,0.10)" : "none",
      }}>
        <span style={{ paddingLeft: 11, color: "var(--app-text-4)", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
          placeholder="Search drugs…"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            padding: "8px 10px",
            border: "none",
            outline: "none",
            fontSize: 13,
            color: "var(--app-text)",
            background: "transparent",
            fontFamily: "var(--font-inter), sans-serif",
          }}
        />
        {loading && (
          <span style={{ paddingRight: 10, fontSize: 11, color: "var(--app-text-4)" }}>…</span>
        )}
        {!loading && query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            style={{ paddingRight: 10, background: "none", border: "none", cursor: "pointer", color: "var(--app-text-4)", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center" }}
            tabIndex={-1}
          >
            ×
          </button>
        )}
        {!query && !focused && (
          <span style={{
            paddingRight: 10, fontSize: 11, color: "var(--app-text-4)",
            fontFamily: "var(--font-dm-mono), monospace",
            background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
            borderRadius: 4, padding: "2px 5px", margin: "0 8px",
            letterSpacing: 0, whiteSpace: "nowrap",
          }}>
            ⌘K
          </span>
        )}
      </div>

      {/* DROPDOWN */}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 500,
          background: "var(--panel)",
          border: "1px solid var(--app-border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(15,23,42,0.12)",
          overflow: "hidden",
          minWidth: 320,
        }}>
          {results.map((hit, i) => (
            <div
              key={hit.drug_id}
              onMouseDown={(e) => { e.preventDefault(); go(hit); }}
              onMouseEnter={() => setCursor(i)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px",
                background: cursor === i ? "var(--app-bg)" : "#fff",
                cursor: "pointer",
                borderBottom: i < results.length - 1 ? "1px solid var(--app-border)" : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {hit.generic_name}
                </div>
                {hit.brand_names?.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {hit.brand_names.slice(0, 2).join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 12 }}>
                {hit.active_shortage_count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                    background: hit.active_shortage_count >= 3 ? "var(--crit-bg)" : "var(--high-bg)",
                    color: hit.active_shortage_count >= 3 ? "var(--crit)" : "var(--high)",
                    border: `1px solid ${hit.active_shortage_count >= 3 ? "var(--crit-b)" : "var(--high-b)"}`,
                    whiteSpace: "nowrap",
                  }}>
                    {hit.active_shortage_count} shortage{hit.active_shortage_count !== 1 ? "s" : ""}
                  </span>
                )}
                {hit.atc_code && (
                  <span style={{ fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {hit.atc_code}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div style={{
            padding: "6px 14px", fontSize: 11, color: "var(--app-text-4)",
            borderTop: "1px solid var(--app-border)", background: "var(--app-bg)",
            display: "flex", gap: 12,
          }}>
            <span>↵ select</span>
            <span>↑↓ navigate</span>
            <span>Esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
