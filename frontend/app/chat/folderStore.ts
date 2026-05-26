"use client";

/*
 * localStorage-backed folder store for /chat2.
 * Folders are lightweight containers — they just hold an id/name/timestamp.
 * Chats reference their folder via SavedChat.folderId (in chatStore.ts).
 */

import { useEffect, useState } from "react";

export type Folder = {
  id: string;
  name: string;
  createdAt: number;
};

type Store = { folders: Folder[] };

const STORAGE_KEY = "chat2:folders:v1";
const CHANGE_EVENT = "chat2:folders-changed";

function readStore(): Store {
  if (typeof window === "undefined") return { folders: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [] };
    const parsed = JSON.parse(raw);
    if (parsed?.folders) return parsed as Store;
  } catch {}
  return { folders: [] };
}

function writeStore(s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function listFolders(): Folder[] {
  return readStore().folders;
}

export function createFolder(name: string): Folder {
  const store = readStore();
  const folder: Folder = {
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "New Folder",
    createdAt: Date.now(),
  };
  store.folders.push(folder);
  writeStore(store);
  return folder;
}

export function renameFolder(id: string, name: string) {
  const store = readStore();
  const f = store.folders.find((x) => x.id === id);
  if (!f) return;
  f.name = name.trim() || f.name;
  writeStore(store);
}

export function deleteFolder(id: string) {
  const store = readStore();
  store.folders = store.folders.filter((f) => f.id !== id);
  writeStore(store);
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useFolders(): Folder[] {
  const [folders, setFolders] = useState<Folder[]>([]);
  useEffect(() => {
    const refresh = () => setFolders(listFolders());
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
  return folders;
}
