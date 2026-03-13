"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

export default function MedicineSearch() {
  const router = useRouter();
  const [focused, setFocused] = useState(false);

  const ac = useAutocomplete({
    minChars: 2,
    debounceMs: 200,
    limit: 8,
    onSelect: (item) => router.push(item.href),
  });

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "visible",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "rgba(13,148,136,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Search
              style={{ width: 14, height: 14, strokeWidth: 1.5 }}
              color="#0d9488"
            />
          </div>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}
          >
            Medicine Search
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
          }}
        >
          drug_products + drugs
        </span>
      </div>

      {/* Search input */}
      <div
        ref={ac.containerRef}
        style={{ padding: "14px 20px", position: "relative" }}
      >
        <div style={{ position: "relative" }}>
          <Search
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 16,
              height: 16,
              strokeWidth: 1.5,
              color: "#94a3b8",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            {...ac.inputProps}
            onFocus={() => { ac.inputProps.onFocus(); setFocused(true); }}
            onBlur={() => setFocused(false)}
            placeholder="Search by drug name or active ingredient…"
            style={{
              width: "100%",
              padding: "10px 36px 10px 38px",
              borderRadius: 8,
              border: `1.5px solid ${focused ? "#0d9488" : "#e2e8f0"}`,
              fontSize: 14,
              color: "#0f172a",
              background: "#f8fafc",
              outline: "none",
              fontFamily: "var(--font-inter), sans-serif",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
          />
          {ac.query && (
            <button
              onClick={() => ac.clear()}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X
                style={{ width: 14, height: 14, strokeWidth: 1.5 }}
                color="#94a3b8"
              />
            </button>
          )}
          {ac.loading && (
            <Loader2
              style={{
                position: "absolute",
                right: ac.query ? 30 : 10,
                top: "50%",
                transform: "translateY(-50%)",
                width: 14,
                height: 14,
                strokeWidth: 2,
                color: "#0d9488",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
        </div>

        {/* Autocomplete dropdown */}
        {ac.isOpen && (
          <AutocompleteDropdown
            items={ac.items}
            cursor={ac.cursor}
            loading={ac.loading}
            query={ac.query}
            listId={ac.inputProps["aria-controls"]}
            onSelect={(item) => { ac.setIsOpen(false); router.push(item.href); }}
            onHover={(i) => {/* cursor managed by hook via keyboard; hover sets visual only */}}
          />
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </div>
  );
}
