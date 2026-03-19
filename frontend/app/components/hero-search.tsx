"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, DrugHit } from "@/lib/api";

const SUGGESTIONS = [
  "Amoxicillin", "Metformin", "Atorvastatin", "Omeprazole",
  "Salbutamol", "Paracetamol", "Cisplatin", "Lithium Carbonate",
];

export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [apiError, setApiError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); setApiError(false); return; }
    setLoading(true);
    setApiError(false);
    try {
      const res = await api.search(q, 6);
      setResults(res.results);
      setOpen(true);
    } catch {
      setResults([]);
      setApiError(true);
      setOpen(true);
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

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCursor(-1);
        setApiError(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function go(drug: DrugHit) {
    setOpen(false);
    setQuery(drug.generic_name);
    router.push(`/drugs/${drug.drug_id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && cursor >= 0) { go(results[cursor]); }
    if (e.key === "Escape") { setOpen(false); setCursor(-1); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cursor >= 0 && results[cursor]) { go(results[cursor]); return; }
    if (results.length > 0) { go(results[0]); return; }
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  const sevColor = (sev: number) =>
    sev === 0 ? "var(--app-text-4)" : sev >= 3 ? "var(--crit)" : sev >= 1 ? "var(--high)" : "var(--low)";

  return (
    <div ref={boxRef} style={{ position: "relative", maxWidth: 580 }}>
      <form onSubmit={handleSubmit}>
        <div style={{
          display: "flex", alignItems: "center",
          background: "#fff",
          border: "1.5px solid var(--app-border-2)",
          borderRadius: 12,
          boxShadow: open
            ? "0 0 0 3px rgba(15,23,42,0.12), 0 4px 24px rgba(15,23,42,0.08)"
            : "0 2px 12px rgba(15,23,42,0.06)",
          transition: "box-shadow 0.15s",
          overflow: "hidden",
        }}>
          {/* Search icon */}
          <span style={{ padding: "0 16px", color: "var(--app-text-4)", fontSize: 16, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            placeholder="Search any drug — amoxicillin, metformin, cisplatin…"
            style={{
              flex: 1,
              padding: "16px 0",
              border: "none",
              outline: "none",
              fontSize: 16,
              color: "var(--app-text)",
              background: "transparent",
              fontFamily: "var(--font-inter), sans-serif",
            }}
            autoComplete="off"
            spellCheck={false}
          />

          {loading && (
            <span style={{ padding: "0 12px", color: "var(--app-text-4)", fontSize: 12 }}>…</span>
          )}

          <button type="submit" style={{
            margin: 6, padding: "10px 20px",
            background: "var(--app-text)", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 14, fontWeight: 600,
            fontFamily: "var(--font-inter), sans-serif",
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            Search
          </button>
        </div>
      </form>

      {/* DROPDOWN */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 200,
          background: "#fff",
          border: "1px solid var(--app-border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(15,23,42,0.12)",
          overflow: "hidden",
        }}>
          {apiError ? (
            <div style={{ padding: "16px", fontSize: 13, color: "var(--app-text-3)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#dc2626" }}>⚠</span>
              Unable to reach search API — press Enter to search the full database
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "16px", fontSize: 13, color: "var(--app-text-4)" }}>
              No drugs matched &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {results.map((hit, i) => (
                <div
                  key={hit.drug_id}
                  onMouseDown={() => go(hit)}
                  onMouseEnter={() => setCursor(i)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px",
                    background: cursor === i ? "var(--app-bg)" : "#fff",
                    cursor: "pointer",
                    borderBottom: i < results.length - 1 ? "1px solid var(--app-border)" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>
                      {hit.generic_name}
                    </div>
                    {hit.brand_names?.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 1 }}>
                        {hit.brand_names.slice(0, 3).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {hit.active_shortage_count > 0 && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                        background: hit.active_shortage_count >= 3 ? "var(--crit-bg)" : "var(--high-bg)",
                        color: sevColor(hit.active_shortage_count),
                        border: `1px solid ${hit.active_shortage_count >= 3 ? "var(--crit-b)" : "var(--high-b)"}`,
                      }}>
                        {hit.active_shortage_count} shortage{hit.active_shortage_count !== 1 ? "s" : ""}
                      </span>
                    )}
                    {hit.atc_code && (
                      <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                        {hit.atc_code}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div style={{
                padding: "8px 16px", fontSize: 12, color: "var(--app-text-4)",
                borderTop: "1px solid var(--app-border)", background: "var(--app-bg)",
              }}>
                ↵ Enter to select · ↑↓ to navigate
              </div>
            </>
          )}
        </div>
      )}

      {/* SUGGESTION PILLS — shown when input empty */}
      {!query && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 12, color: "var(--app-text-4)", alignSelf: "center", marginRight: 4 }}>Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setQuery(s); inputRef.current?.focus(); }}
              style={{
                fontSize: 12, padding: "5px 12px", borderRadius: 6,
                background: "#fff", border: "1px solid var(--app-border)",
                color: "var(--app-text-3)", cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
