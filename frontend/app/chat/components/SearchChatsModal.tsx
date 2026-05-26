"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Star } from "./icons";
import { BUCKET_LABELS, bucketFor, type SavedChat } from "../chatStore";

type Match = {
  chat: SavedChat;
  score: number;
  // The piece of context we found the match in — title or a turn snippet.
  // Pre-formatted with a single highlighted span; the modal just renders it.
  preview: { before: string; hit: string; after: string } | null;
  source: "title" | "turn";
};

function rankAndFilter(chats: SavedChat[], query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // No query — show most recent, starred floats up.
    return [...chats]
      .sort((a, b) => {
        if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      })
      .map((chat) => ({ chat, score: 0, preview: null, source: "title" as const }));
  }

  const out: Match[] = [];
  for (const chat of chats) {
    const title = chat.title.toLowerCase();
    const titleIdx = title.indexOf(q);
    if (titleIdx !== -1) {
      out.push({
        chat,
        // Title hits rank well above turn hits, with a tiny boost for
        // matches near the start of the title.
        score: 1000 - titleIdx,
        preview: snippet(chat.title, titleIdx, q.length, 60),
        source: "title",
      });
      continue;
    }
    // Fall back to scanning the conversation. We stop at the first hit; if
    // someone needs every match they can refine the query.
    let bestTurnHit: { idx: number; text: string } | null = null;
    for (const turn of chat.turns) {
      const text = turn.text ?? "";
      const idx = text.toLowerCase().indexOf(q);
      if (idx !== -1) {
        bestTurnHit = { idx, text };
        break;
      }
    }
    if (bestTurnHit) {
      out.push({
        chat,
        score: 100,
        preview: snippet(bestTurnHit.text, bestTurnHit.idx, q.length, 80),
        source: "turn",
      });
    }
  }
  // Secondary sort: recency.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.chat.updatedAt - a.chat.updatedAt;
  });
  return out;
}

function snippet(text: string, idx: number, len: number, radius: number) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + len + radius);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, idx),
    hit: text.slice(idx, idx + len),
    after: text.slice(idx + len, end) + (end < text.length ? "…" : ""),
  };
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SearchChatsModal({
  open,
  chats,
  onClose,
}: {
  open: boolean;
  chats: SavedChat[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => rankAndFilter(chats, query), [chats, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIdx(0);
    // Focus on next tick so the input is mounted.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Reset selection when query changes — top result is the most relevant.
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Keyboard nav (Esc / arrow keys / Enter).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const match = matches[selectedIdx];
        if (match) handleOpen(match.chat.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, matches, selectedIdx, onClose]);

  // Keep the selected row scrolled into view as the user arrows through.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleOpen = (id: string) => {
    onClose();
    router.push(`/chat/${id}`);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-slate-900/30 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search chats"
    >
      <div
        className="w-full max-w-[560px] bg-white rounded-xl border border-slate-200 overflow-hidden"
        style={{ boxShadow: "0 20px 60px rgba(15,23,42,0.16), 0 6px 16px rgba(15,23,42,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200">
          <span className="text-slate-400 shrink-0">
            <Search size={16} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={chats.length === 0 ? "No chats yet" : "Search your chats…"}
            className="flex-1 bg-transparent outline-none text-[14px] text-slate-900 placeholder:text-slate-400"
            disabled={chats.length === 0}
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-slate-100 border border-slate-200" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {chats.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-slate-500">
              Your chats will appear here as you use Mederti.
            </div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-slate-500">
              No chats match <span className="font-medium text-slate-700">"{query}"</span>
            </div>
          ) : (
            matches.map((m, i) => (
              <button
                key={m.chat.id}
                data-idx={i}
                type="button"
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => handleOpen(m.chat.id)}
                className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left transition-colors border-l-2 ${
                  i === selectedIdx
                    ? "bg-slate-50 border-teal-500"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <span className={`mt-[3px] shrink-0 ${m.chat.isStarred ? "text-amber-500" : "text-slate-300"}`}>
                  <Star size={12} filled={m.chat.isStarred} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-slate-900 truncate">
                      {m.source === "title" && m.preview ? (
                        <Highlighted preview={m.preview} />
                      ) : (
                        m.chat.title
                      )}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-auto" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
                      {relativeTime(m.chat.updatedAt)}
                    </span>
                  </div>
                  {m.source === "turn" && m.preview ? (
                    <div className="mt-0.5 text-[12px] text-slate-500 line-clamp-2 leading-snug">
                      <Highlighted preview={m.preview} />
                    </div>
                  ) : !query ? (
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {BUCKET_LABELS[bucketFor(m.chat.updatedAt)]}
                    </div>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        {matches.length > 0 ? (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-[10.5px] text-slate-400" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
            <span className="ml-auto">{matches.length} {matches.length === 1 ? "result" : "results"}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Highlighted({ preview }: { preview: { before: string; hit: string; after: string } }) {
  return (
    <>
      {preview.before}
      <mark className="bg-yellow-200/70 text-slate-900 rounded-sm px-0.5">{preview.hit}</mark>
      {preview.after}
    </>
  );
}
