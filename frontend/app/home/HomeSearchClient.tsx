"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

export default function HomeSearchClient() {
  const [query, setQuery]   = useState("");
  const [focused, setFocused] = useState(false);
  const router              = useRouter();
  const inputRef            = useRef<HTMLInputElement>(null);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={handleSearch} style={{ position: "relative", maxWidth: 860, width: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center",
        background: "var(--panel)",
        border: `1.5px solid ${focused ? "var(--teal)" : "var(--app-border)"}`,
        borderRadius: 12,
        boxShadow: focused
          ? "0 0 0 3px rgba(13,148,136,0.12), 0 4px 20px rgba(0,0,0,0.06)"
          : "0 2px 12px rgba(0,0,0,0.05)",
        transition: "border-color 0.15s, box-shadow 0.15s",
        overflow: "hidden",
      }}>
        <Search
          style={{ width: 18, height: 18, strokeWidth: 1.5, marginLeft: 16, flexShrink: 0, color: "var(--app-text-4)" }}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search drugs, generics, conditions…"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1, padding: "14px 12px",
            border: "none", outline: "none",
            fontSize: 15, color: "var(--app-text)",
            fontFamily: "var(--font-inter), sans-serif",
            background: "transparent",
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "0 8px", color: "var(--app-text-4)",
              display: "flex", alignItems: "center",
            }}
          >
            <X style={{ width: 15, height: 15, strokeWidth: 1.5 }} />
          </button>
        )}
        <button
          type="submit"
          style={{
            padding: "10px 20px", margin: "5px",
            background: "var(--teal)", border: "none",
            borderRadius: 8, color: "#fff",
            fontSize: 14, fontWeight: 600,
            cursor: "pointer", flexShrink: 0,
            fontFamily: "var(--font-inter), sans-serif",
          }}
        >
          Search
        </button>
      </div>
    </form>
  );
}
