"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import type { AutocompleteItem } from "@/app/api/drug-autocomplete/route";

export type { AutocompleteItem };

/* ── Session cache (persists within tab lifetime) ── */
const cache = new Map<string, AutocompleteItem[]>();

export interface UseAutocompleteOptions {
  minChars?: number;
  debounceMs?: number;
  limit?: number;
  onSelect: (item: AutocompleteItem) => void;
  onSubmit?: (query: string) => void;
  enabled?: boolean;
}

export interface UseAutocompleteReturn {
  query: string;
  setQuery: (q: string) => void;
  items: AutocompleteItem[];
  loading: boolean;
  isOpen: boolean;
  cursor: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  inputProps: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onFocus: () => void;
    autoComplete: "off";
    spellCheck: false;
    role: "combobox";
    "aria-expanded": boolean;
    "aria-activedescendant": string | undefined;
    "aria-autocomplete": "list";
    "aria-controls": string;
  };
  setIsOpen: (open: boolean) => void;
  clear: () => void;
}

export function useAutocomplete(
  opts: UseAutocompleteOptions,
): UseAutocompleteReturn {
  const {
    minChars = 2,
    debounceMs = 200,
    limit = 8,
    onSelect,
    onSubmit,
    enabled = true,
  } = opts;

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  // Stable refs for callbacks
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  /* ── Fetch logic ── */
  const fetchSuggestions = useCallback(
    async (q: string) => {
      const key = q.toLowerCase();
      if (cache.has(key)) {
        const cached = cache.get(key)!;
        setItems(cached);
        setIsOpen(cached.length > 0);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/drug-autocomplete?q=${encodeURIComponent(q)}&limit=${limit}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const results: AutocompleteItem[] = data.items ?? [];
        cache.set(key, results);
        setItems(results);
        setIsOpen(results.length > 0);
      } catch {
        setItems([]);
        setIsOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [limit],
  );

  /* ── Debounced query effect ── */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!enabled || query.length < minChars) {
      setItems([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(query), debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, enabled, minChars, debounceMs, fetchSuggestions]);

  /* ── Outside click ── */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCursor(-1);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Keyboard handler ── */
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen && e.key !== "ArrowDown") {
      // If dropdown is closed, only ArrowDown can open it; Enter falls through to onSubmit
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmitRef.current?.(query);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen && items.length > 0) {
          setIsOpen(true);
        }
        setCursor((c) => Math.min(c + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (cursor >= 0 && items[cursor]) {
          setIsOpen(false);
          setCursor(-1);
          onSelectRef.current(items[cursor]);
        } else {
          setIsOpen(false);
          setCursor(-1);
          onSubmitRef.current?.(query);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setCursor(-1);
        break;
      case "Tab":
        setIsOpen(false);
        setCursor(-1);
        // Don't preventDefault — let focus move naturally
        break;
    }
  }

  /* ── Input props ── */
  const inputProps = {
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setCursor(-1);
    },
    onKeyDown: handleKeyDown,
    onFocus: () => {
      if (items.length > 0 && enabled) setIsOpen(true);
    },
    autoComplete: "off" as const,
    spellCheck: false as const,
    role: "combobox" as const,
    "aria-expanded": isOpen,
    "aria-activedescendant":
      cursor >= 0 ? `${listId}-option-${cursor}` : undefined,
    "aria-autocomplete": "list" as const,
    "aria-controls": listId,
  };

  function clear() {
    setQuery("");
    setItems([]);
    setIsOpen(false);
    setCursor(-1);
  }

  return {
    query,
    setQuery,
    items,
    loading,
    isOpen,
    cursor,
    containerRef,
    inputProps,
    setIsOpen,
    clear,
  };
}
