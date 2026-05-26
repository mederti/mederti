"use client";

/*
 * localStorage-backed chat history for /chat2.
 *
 * v1 keeps things deliberately simple:
 *   - One JSON blob at "chat2:chats:v1" — {chats: {[id]: SavedChat}}
 *   - Same-tab updates fire a custom "chat2:chats-changed" event so hooks
 *     re-read without polling.
 *   - Cross-tab updates ride the native "storage" event.
 *
 * When we eventually move to a real `chat` table with auth, this module is
 * the only thing the UI cares about — swap the read/write bodies for fetch
 * calls and keep the same surface.
 */

import { useEffect, useState } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";

export type SavedTurn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; error?: string };

export type SavedChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isStarred: boolean;
  folderId: string | null;
  turns: SavedTurn[];
  drugsMap: Record<string, DrugDetail>;
  subsMap: Record<string, SubstituteRow>;
};

type Store = { chats: Record<string, SavedChat> };

const STORAGE_KEY = "chat2:chats:v1";
const CHANGE_EVENT = "chat2:chats-changed";

function readStore(): Store {
  if (typeof window === "undefined") return { chats: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chats: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.chats) return parsed as Store;
  } catch {
    // corrupted blob — discard, start fresh rather than crash
  }
  return { chats: {} };
}

function writeStore(s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded — best we can do is silently drop. Future: surface a
    // toast and offer to prune old chats.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// ── Public mutations ──────────────────────────────────────────────────────

export function listChats(): SavedChat[] {
  const store = readStore();
  return Object.values(store.chats).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getChat(id: string): SavedChat | null {
  if (!id) return null;
  return readStore().chats[id] ?? null;
}

export function upsertChat(chat: SavedChat) {
  const store = readStore();
  store.chats[chat.id] = chat;
  writeStore(store);
}

export function deleteChat(id: string) {
  const store = readStore();
  if (!store.chats[id]) return;
  delete store.chats[id];
  writeStore(store);
}

export function renameChat(id: string, title: string) {
  const store = readStore();
  const chat = store.chats[id];
  if (!chat) return;
  chat.title = title.trim() || chat.title;
  chat.updatedAt = Date.now();
  writeStore(store);
}

export function toggleStarChat(id: string) {
  const store = readStore();
  const chat = store.chats[id];
  if (!chat) return;
  chat.isStarred = !chat.isStarred;
  writeStore(store);
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function newChatId(): string {
  // crypto.randomUUID is available in all modern browsers + Node 19+.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback — fine for an ID, not for security.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(firstUserText: string): string {
  const single = firstUserText.replace(/\s+/g, " ").trim();
  if (!single) return "New chat";
  return single.length > 60 ? single.slice(0, 57) + "…" : single;
}

export type Bucket = "today" | "yesterday" | "7d" | "30d" | "older";
export const BUCKET_LABELS: Record<Bucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  older: "Older",
};
export const BUCKET_ORDER: Bucket[] = ["today", "yesterday", "7d", "30d", "older"];

export function bucketFor(ts: number): Bucket {
  const now = new Date();
  const date = new Date(ts);
  if (now.toDateString() === date.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.toDateString() === date.toDateString()) return "yesterday";
  const ms = now.getTime() - date.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return "older";
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useChatList(): SavedChat[] {
  const [chats, setChats] = useState<SavedChat[]>([]);
  useEffect(() => {
    const refresh = () => setChats(listChats());
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
  return chats;
}
