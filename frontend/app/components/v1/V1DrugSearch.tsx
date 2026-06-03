"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

// AutocompleteDropdown is styled with the shared app's --app-*/--high*/--teal/--crit-bg
// tokens. The V1 drug page defines a different palette (--ink/--green/--border/...), so map
// the dropdown's tokens onto it here — without this the dropdown renders with unresolved
// colors. position:relative anchors the absolutely-positioned dropdown to this wrapper.
const DROPDOWN_TOKENS = {
  "--app-border": "var(--border)",
  "--app-text": "var(--text)",
  "--app-text-4": "var(--text-4)",
  "--app-bg": "var(--bg-2)",
  "--crit-bg": "#fff1f3",
  "--high-bg": "#fffbeb",
  "--high": "var(--med)",
  "--high-b": "var(--med-b)",
  "--teal": "var(--green-d)",
  position: "relative",
} as CSSProperties;

// Compact search bar for the top of the drug page's middle column — prefilled
// with the current medicine, with predictive typeahead (matches the home search).
// Selecting a suggestion jumps straight to that drug; Enter/Search runs a query.
export default function V1DrugSearch({ initial }: { initial: string }) {
  const router = useRouter();

  function go(value: string) {
    const t = value.trim();
    if (t) router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  const ac = useAutocomplete({
    minChars: 2,
    initialQuery: initial,
    onSelect: (item) => {
      ac.setIsOpen(false);
      router.push(item.href);
    },
    onSubmit: go,
  });

  return (
    <div ref={ac.containerRef} style={DROPDOWN_TOKENS}>
      <form className="dsearch" onSubmit={(e) => { e.preventDefault(); go(ac.query); }}>
        <span className="dsearch-ic">⌕</span>
        <input
          {...ac.inputProps}
          onFocus={(e) => { e.currentTarget.select(); ac.inputProps.onFocus(); }}
          placeholder="Search a medicine…"
          aria-label="Search a medicine"
        />
        <button type="submit">Search</button>
      </form>
      {ac.isOpen && (
        <AutocompleteDropdown
          items={ac.items}
          cursor={ac.cursor}
          loading={ac.loading}
          query={ac.query}
          listId={ac.inputProps["aria-controls"]}
          onSelect={(item) => {
            ac.setIsOpen(false);
            router.push(item.href);
          }}
          onHover={() => {}}
        />
      )}
    </div>
  );
}
