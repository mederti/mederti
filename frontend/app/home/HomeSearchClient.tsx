"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import { AutocompleteDropdown } from "@/app/components/autocomplete-dropdown";

const SUGGESTED = [
  "Amoxicillin",
  "Metformin",
  "Paracetamol IV",
  "Ozempic",
  "Lithium Carbonate",
  "Cisplatin",
];

export default function HomeSearchClient() {
  const router = useRouter();

  function doSearch(q: string) {
    const term = q.trim();
    if (!term) return;
    router.push(`/chat?q=${encodeURIComponent(term)}`);
  }

  const ac = useAutocomplete({
    minChars: 2,
    debounceMs: 200,
    limit: 8,
    onSelect: (item) => {
      router.push(item.href);
    },
    onSubmit: (q) => doSearch(q),
  });

  const chipStyle: React.CSSProperties = {
    padding: "7px 16px",
    borderRadius: 99,
    border: "1px solid var(--app-border)",
    background: "#fff",
    fontSize: 13,
    color: "var(--app-text-3)",
    cursor: "pointer",
    fontFamily: "var(--font-inter), sans-serif",
    transition: "border-color 0.15s, color 0.15s",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ maxWidth: 860, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      {/* Search bar with autocomplete */}
      <div ref={ac.containerRef} style={{ position: "relative", width: "100%" }}>
        <form onSubmit={(e) => { e.preventDefault(); doSearch(ac.query); }} style={{ width: "100%" }}>
          <div style={{
            display: "flex", alignItems: "center",
            background: "#fff",
            border: `1.5px solid ${ac.isOpen ? "var(--teal)" : "var(--app-border)"}`,
            borderRadius: 12,
            boxShadow: ac.isOpen
              ? "0 0 0 3px rgba(15,23,42,0.12), 0 4px 20px rgba(0,0,0,0.06)"
              : "0 2px 12px rgba(0,0,0,0.05)",
            transition: "border-color 0.15s, box-shadow 0.15s",
            overflow: "hidden",
          }}>
            <Search
              style={{ width: 18, height: 18, strokeWidth: 1.5, marginLeft: 16, flexShrink: 0, color: "var(--app-text-4)" }}
            />
            <input
              {...ac.inputProps}
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
            {ac.query && (
              <button
                type="button"
                onClick={() => ac.setQuery("")}
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

        {/* Autocomplete dropdown */}
        {ac.isOpen && ac.items.length > 0 && (
          <AutocompleteDropdown
            items={ac.items}
            cursor={ac.cursor}
            loading={ac.loading}
            listboxId={ac.inputProps["aria-controls"]}
          />
        )}
      </div>

      {/* Suggested searches */}
      <div style={{
        display: "flex", flexWrap: "wrap", justifyContent: "center",
        gap: 8,
      }}>
        {SUGGESTED.map((s) => (
          <button
            key={s}
            onClick={() => doSearch(s)}
            style={chipStyle}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--app-text-4)"; e.currentTarget.style.color = "var(--app-text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--app-border)"; e.currentTarget.style.color = "var(--app-text-3)"; }}
          >
            {s}
          </button>
        ))}
      </div>

    </div>
  );
}
