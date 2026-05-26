"use client";

/*
 * localStorage-backed watchlist store for /chat2.
 * Same pattern as chatStore.ts — swap read/write bodies for Supabase calls
 * once we add auth. The store is a flat JSON blob keyed by STORAGE_KEY.
 */

import { useEffect, useState } from "react";

export type WatchlistStatus = "red" | "amber" | "green";

export type WatchlistEntry = {
  drug_id: string;
  drug_name: string;
  status: WatchlistStatus;
  addedAt: number;
};

export type Watchlist = {
  id: string;
  name: string;
  createdAt: number;
  items: WatchlistEntry[];
};

type Store = { watchlists: Watchlist[] };

const STORAGE_KEY = "chat2:watchlists:v1";
const CHANGE_EVENT = "chat2:watchlists-changed";

function readStore(): Store {
  if (typeof window === "undefined") return { watchlists: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { watchlists: [] };
    const parsed = JSON.parse(raw);
    if (parsed?.watchlists) return parsed as Store;
  } catch {}
  return { watchlists: [] };
}

function writeStore(s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function listWatchlists(): Watchlist[] {
  return readStore().watchlists;
}

export function createWatchlist(name: string): Watchlist {
  const store = readStore();
  const wl: Watchlist = {
    id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "My Watchlist",
    createdAt: Date.now(),
    items: [],
  };
  store.watchlists.push(wl);
  writeStore(store);
  return wl;
}

export function renameWatchlist(id: string, name: string) {
  const store = readStore();
  const wl = store.watchlists.find((w) => w.id === id);
  if (!wl) return;
  wl.name = name.trim() || wl.name;
  writeStore(store);
}

export function deleteWatchlist(id: string) {
  const store = readStore();
  store.watchlists = store.watchlists.filter((w) => w.id !== id);
  writeStore(store);
}

export function addDrugToWatchlist(
  watchlistId: string,
  entry: Omit<WatchlistEntry, "addedAt">
) {
  const store = readStore();
  const wl = store.watchlists.find((w) => w.id === watchlistId);
  if (!wl) return;
  if (wl.items.some((i) => i.drug_id === entry.drug_id)) return; // no duplicates
  wl.items.push({ ...entry, addedAt: Date.now() });
  writeStore(store);
}

export function removeDrugFromWatchlist(watchlistId: string, drugId: string) {
  const store = readStore();
  const wl = store.watchlists.find((w) => w.id === watchlistId);
  if (!wl) return;
  wl.items = wl.items.filter((i) => i.drug_id !== drugId);
  writeStore(store);
}

export function isDrugInWatchlist(watchlistId: string, drugId: string): boolean {
  const wl = readStore().watchlists.find((w) => w.id === watchlistId);
  return wl ? wl.items.some((i) => i.drug_id === drugId) : false;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useWatchlists(): Watchlist[] {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  useEffect(() => {
    const refresh = () => setWatchlists(listWatchlists());
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) refresh();
    };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onLocal as EventListener);
    };
  }, []);
  return watchlists;
}
