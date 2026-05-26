"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  ChatBubble,
  ChevronDown,
  ChevronRight,
  Folder,
  Hex,
  Kebab,
  Pencil,
  Plus,
  Search,
  Star,
  Trash,
} from "./icons";
import {
  RECENT_BUCKET_LABELS,
  SEED_FOLDERS,
  SEED_RECENT_CHATS,
  SEED_WATCHLISTS,
  type RecentChat,
  type Status,
  type WatchlistItem,
} from "../seedData";
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketFor,
  deleteChat,
  renameChat,
  toggleStarChat,
  type Bucket,
  type SavedChat,
} from "../chatStore";

const LS_FOLDERS = "chat2:sidebar:expandedFolders";
const LS_WATCHLISTS = "chat2:sidebar:expandedWatchlists";

function useExpandedSet(key: string, defaultOpen: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setOpen(new Set(arr));
      }
    } catch {}
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(open)));
    } catch {}
  }, [key, open, hydrated]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return { open, toggle };
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === "red" ? "bg-red-600" : status === "amber" ? "bg-yellow-600" : "bg-green-600";
  return <span className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${cls}`} />;
}

function ItemKebab({
  onClick,
  visible,
}: {
  onClick?: (e: React.MouseEvent) => void;
  visible?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick?.(e);
      }}
      className={`w-[18px] h-[18px] inline-flex items-center justify-center rounded text-slate-400 transition-opacity hover:bg-slate-900/[0.08] hover:text-slate-600 shrink-0 ${
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
      title="More"
    >
      <Kebab />
    </button>
  );
}

function SectionHeader({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400 select-none">
      <span>{label}</span>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="w-[18px] h-[18px] inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-900/[0.06] hover:text-slate-600"
          title={`New ${label.toLowerCase()}`}
        >
          <Plus size={11} />
        </button>
      ) : null}
    </div>
  );
}

function GroupRow({
  isOpen,
  icon,
  label,
  count,
  onClick,
}: {
  isOpen: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] text-slate-700 hover:bg-slate-900/[0.04] hover:text-slate-900 transition-colors text-left"
    >
      <span className={`inline-flex items-center justify-center w-3 h-3 text-slate-400 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`}>
        <ChevronRight size={10} />
      </span>
      <span className="inline-flex items-center justify-center text-slate-400 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[10px] font-mono text-slate-400" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
        {count}
      </span>
    </button>
  );
}

function ChatKebabMenu({
  isSaved,
  isStarred,
  onClose,
  onRename,
  onToggleStar,
  onDelete,
  onStub,
}: {
  isSaved: boolean;
  isStarred: boolean;
  onClose: () => void;
  onRename: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onStub: (label: string) => void;
}) {
  const folders = SEED_FOLDERS;
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        className="absolute top-full right-0 mt-1 z-30 bg-white border border-slate-200 rounded-lg min-w-[200px] p-1"
        style={{ boxShadow: "0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] uppercase tracking-wider text-slate-400 px-2 pt-1.5 pb-1">
          Move to folder
        </div>
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onStub(`Moved to ${f.name} — folders persist in Pass 4`)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-100 rounded text-left"
          >
            <Folder size={12} />
            {f.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onStub("New folder — coming in Pass 4")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-teal-600 hover:bg-teal-50 rounded text-left"
        >
          <Plus size={12} />
          New folder…
        </button>
        <div className="h-px bg-slate-200 my-1" />
        <button
          type="button"
          onClick={isSaved ? onRename : () => onStub("Save the chat first")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-100 rounded text-left disabled:opacity-40"
          disabled={!isSaved}
        >
          <Pencil size={12} />
          Rename
        </button>
        <button
          type="button"
          onClick={isSaved ? onToggleStar : () => onStub("Save the chat first")}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] hover:bg-slate-100 rounded text-left disabled:opacity-40 ${
            isStarred ? "text-amber-600" : "text-slate-700"
          }`}
          disabled={!isSaved}
        >
          <Star size={12} filled={isStarred} />
          {isStarred ? "Unstar" : "Star"}
        </button>
        <button
          type="button"
          onClick={isSaved ? onDelete : () => onStub("Save the chat first")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50 rounded text-left disabled:opacity-40"
          disabled={!isSaved}
        >
          <Trash size={12} />
          Delete chat
        </button>
      </div>
    </>
  );
}

function ChatHistoryItem({
  chatId,
  title,
  active,
  isStarred,
  isPersisted,
  onToast,
}: {
  chatId: string;
  title: string;
  active?: boolean;
  isStarred?: boolean;
  // True when this row represents a chat in the real localStorage store.
  // Seeded-demo rows pass false; their kebab actions stay stubbed.
  isPersisted: boolean;
  onToast: (msg: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  const handleRename = () => {
    setMenuOpen(false);
    // window.prompt is ugly — replace with inline edit in a later pass once
    // we have the headroom. Functional and unmistakable for v1.
    const next = window.prompt("Rename chat", title);
    if (next == null) return;
    renameChat(chatId, next);
  };

  const handleDelete = () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    deleteChat(chatId);
    if (active) router.replace("/chat2");
  };

  const handleToggleStar = () => {
    setMenuOpen(false);
    toggleStarChat(chatId);
  };

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => {
          router.push(`/chat2/${chatId}`);
        }}
        className={`w-full flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-md transition-colors text-left ${
          active
            ? "bg-white text-slate-900 font-medium"
            : "text-slate-700 hover:bg-slate-900/[0.04] hover:text-slate-900"
        }`}
        style={active ? { boxShadow: "inset 0 0 0 1px rgb(226 232 240)" } : undefined}
      >
        {isStarred ? (
          <span className="text-amber-500 shrink-0">
            <Star size={11} filled />
          </span>
        ) : null}
        <span className="flex-1 truncate text-[13px] leading-snug">{title}</span>
        <span className="w-[18px] h-[18px] shrink-0" />
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <ItemKebab onClick={() => setMenuOpen(true)} visible={menuOpen} />
      </div>
      {menuOpen ? (
        <ChatKebabMenu
          isSaved={isPersisted}
          isStarred={!!isStarred}
          onClose={() => setMenuOpen(false)}
          onRename={handleRename}
          onToggleStar={handleToggleStar}
          onDelete={handleDelete}
          onStub={(label) => {
            setMenuOpen(false);
            onToast(label);
          }}
        />
      ) : null}
    </div>
  );
}

function WatchlistDrugRow({
  item,
  active,
  onOpen,
}: {
  item: WatchlistItem;
  active: boolean;
  onOpen: (slug: string) => void;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => onOpen(item.drug_slug)}
        className={`w-full flex items-center gap-2.5 pl-2.5 pr-7 py-1.5 rounded-md text-[13px] text-left transition-colors ${
          active
            ? "bg-teal-50 text-teal-900"
            : "text-slate-700 hover:bg-slate-900/[0.04] hover:text-slate-900"
        }`}
      >
        <StatusDot status={item.status} />
        <span className="flex-1 truncate">{item.drug_name}</span>
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <ItemKebab />
      </div>
    </div>
  );
}

export function Sidebar({
  activeChatId,
  activeDrugSlug,
  isDemo,
  chats,
  onOpenDrugPreview,
  onToast,
}: {
  activeChatId: string | null;
  activeDrugSlug: string | null;
  isDemo: boolean;
  // Real chats from the localStorage store (already sorted updatedAt desc).
  chats: SavedChat[];
  onOpenDrugPreview: (slug: string) => void;
  onToast: (msg: string) => void;
}) {
  const wl = useExpandedSet(LS_WATCHLISTS, ["wl-1"]);
  const fl = useExpandedSet(LS_FOLDERS, ["f-1"]);

  // Watchlists + folders stay seeded for now (Pass 3 & 4). Recents is the
  // real localStorage list once we have any saved chats — falls back to
  // seed only in demo mode for design review.
  const watchlists = isDemo ? SEED_WATCHLISTS : [];
  const folders = isDemo ? SEED_FOLDERS : [];

  // Bucket real chats by recency. Starred chats float to the top of their
  // bucket so they stay discoverable as the list grows.
  const realRecentsByBucket = useMemo(() => {
    const groups = new Map<Bucket, SavedChat[]>();
    const sorted = [...chats].sort((a, b) => {
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    for (const c of sorted) {
      const bucket = bucketFor(c.updatedAt);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket)!.push(c);
    }
    return BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => [b, groups.get(b)!] as const);
  }, [chats]);

  // Fall back to seeded recents in demo mode if there are no real chats.
  const showSeedRecents = isDemo && chats.length === 0;
  const seedRecentsByBucket = useMemo(() => {
    if (!showSeedRecents) return [] as Array<[RecentChat["bucket"], RecentChat[]]>;
    const groups = new Map<RecentChat["bucket"], RecentChat[]>();
    for (const r of SEED_RECENT_CHATS) {
      if (!groups.has(r.bucket)) groups.set(r.bucket, []);
      groups.get(r.bucket)!.push(r);
    }
    return Array.from(groups.entries());
  }, [showSeedRecents]);

  const hasAnyChat =
    chats.length > 0 ||
    showSeedRecents ||
    folders.some((f) => f.chats.length > 0);
  const hasAnyContent = watchlists.length > 0 || folders.length > 0 || hasAnyChat;

  return (
    <aside className="w-[268px] shrink-0 bg-slate-50/60 border-r border-slate-200 flex flex-col h-screen">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3.5">
        <span className="inline-flex items-center justify-center text-slate-900">
          <Hex size={24} />
        </span>
        <span className="text-[17px] font-medium tracking-tight text-slate-900">mederti</span>
      </div>

      {/* Primary actions — Search hides until there's history to search */}
      <div className="px-2.5 pb-2.5 flex flex-col gap-0.5">
        <Link
          href="/chat2"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors"
        >
          <Plus size={14} />
          <span>New chat</span>
        </Link>
        {hasAnyChat ? (
          <button
            type="button"
            onClick={() => onToast("Search chats — coming soon")}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-slate-700 hover:bg-slate-900/[0.04] hover:text-slate-900 transition-colors text-left"
          >
            <Search size={14} />
            <span>Search chats</span>
          </button>
        ) : null}
      </div>

      {/* Scrolling sections — each hides when empty so a fresh sidebar
          shows just New chat + footer, like Claude / ChatGPT on day one. */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {watchlists.length > 0 ? (
          <div className="mt-1">
            <SectionHeader label="Watchlists" onAdd={() => onToast("New watchlist — coming soon")} />
            {watchlists.map((w) => {
              const isOpen = wl.open.has(w.id);
              const count = w.items.length || w.itemCount || 0;
              return (
                <div key={w.id}>
                  <GroupRow
                    isOpen={isOpen}
                    icon={<Bookmark size={13} />}
                    label={w.name}
                    count={count}
                    onClick={() => wl.toggle(w.id)}
                  />
                  {isOpen && w.items.length > 0 ? (
                    <div className="pl-[18px] mt-px">
                      {w.items.map((it) => (
                        <WatchlistDrugRow
                          key={it.drug_slug}
                          item={it}
                          active={it.drug_slug === activeDrugSlug}
                          onOpen={onOpenDrugPreview}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {folders.length > 0 ? (
          <div className="mt-3.5">
            <SectionHeader label="Folders" onAdd={() => onToast("New folder — coming soon")} />
            {folders.map((f) => {
              const isOpen = fl.open.has(f.id);
              const count = f.chats.length || f.chatCount || 0;
              return (
                <div key={f.id}>
                  <GroupRow
                    isOpen={isOpen}
                    icon={<Folder size={13} />}
                    label={f.name}
                    count={count}
                    onClick={() => fl.toggle(f.id)}
                  />
                  {isOpen && f.chats.length > 0 ? (
                    <div className="pl-[18px] mt-px">
                      {f.chats.map((c) => (
                        <ChatHistoryItem
                          key={c.id}
                          chatId={c.id}
                          title={c.title}
                          active={c.id === activeChatId}
                          isPersisted={false}
                          onToast={onToast}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {realRecentsByBucket.length > 0 ? (
          <div className="mt-3.5">
            {realRecentsByBucket.map(([bucket, items]) => (
              <div key={bucket}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 px-2.5 pt-2.5 pb-1">
                  {BUCKET_LABELS[bucket]}
                </div>
                {items.map((c) => (
                  <ChatHistoryItem
                    key={c.id}
                    chatId={c.id}
                    title={c.title}
                    active={c.id === activeChatId}
                    isStarred={c.isStarred}
                    isPersisted
                    onToast={onToast}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : showSeedRecents ? (
          <div className="mt-3.5">
            {seedRecentsByBucket.map(([bucket, items]) => (
              <div key={bucket}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 px-2.5 pt-2.5 pb-1">
                  {RECENT_BUCKET_LABELS[bucket]}
                </div>
                {items.map((c) => (
                  <ChatHistoryItem
                    key={c.id}
                    chatId={c.id}
                    title={c.title}
                    active={c.id === activeChatId}
                    isPersisted={false}
                    onToast={onToast}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {/* Empty-state hint — only shown when sidebar is completely empty.
            Deliberately quiet: no big illustration, no row of CTAs. The
            sidebar's job in this state is to stay out of the way while the
            user types their first question. */}
        {!hasAnyContent ? (
          <div className="px-2.5 pt-4 text-[12px] text-slate-400 leading-relaxed">
            Your chats and saved drugs will appear here as you use Mederti.
          </div>
        ) : null}
      </div>

      {/* User footer */}
      <div className="border-t border-slate-200 px-3 py-2.5 flex items-center gap-2.5 bg-slate-50/60">
        <span
          className="w-7 h-7 rounded-full inline-flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
          style={{ background: "linear-gradient(135deg, #0d9488, #14b8a6)" }}
        >
          R
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-900 leading-tight">Rob</div>
          <div className="text-[11px] text-slate-400 leading-tight">Mederti · Founder</div>
        </div>
        <button
          type="button"
          onClick={() => onToast("User menu — coming soon")}
          className="text-slate-400 hover:text-slate-700 text-base px-1"
          title="More"
        >
          ⋯
        </button>
      </div>
    </aside>
  );
}
