"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  ChatBubble,
  ChevronDown,
  ChevronRight,
  Folder,
  Kebab,
  PanelLeft,
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
  moveChatToFolder,
  renameChat,
  toggleStarChat,
  type Bucket,
  type SavedChat,
} from "../chatStore";
import { createWatchlist, useWatchlists, type Watchlist } from "../watchlistStore";
import { createFolder, useFolders, type Folder as FolderRecord } from "../folderStore";

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
  chatId,
  currentFolderId,
  folders,
  isSaved,
  isStarred,
  onClose,
  onRename,
  onToggleStar,
  onDelete,
  onToast,
}: {
  chatId: string;
  currentFolderId: string | null;
  folders: FolderRecord[];
  isSaved: boolean;
  isStarred: boolean;
  onClose: () => void;
  onRename: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onToast: (msg: string) => void;
}) {
  const handleMoveToFolder = (folderId: string | null) => {
    moveChatToFolder(chatId, folderId);
    onClose();
  };

  const handleNewFolder = () => {
    const name = window.prompt("Folder name", "New Folder");
    if (name == null) return;
    const f = createFolder(name);
    moveChatToFolder(chatId, f.id);
    onClose();
  };

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
        {currentFolderId ? (
          <button
            type="button"
            onClick={() => handleMoveToFolder(null)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-slate-500 hover:bg-slate-100 rounded text-left"
          >
            <Folder size={12} />
            Remove from folder
          </button>
        ) : null}
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => handleMoveToFolder(f.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] hover:bg-slate-100 rounded text-left ${
              currentFolderId === f.id ? "text-teal-700 font-medium" : "text-slate-700"
            }`}
          >
            <Folder size={12} />
            {f.name}
            {currentFolderId === f.id ? <span className="ml-auto text-teal-500 text-[10px]">✓</span> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={handleNewFolder}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-teal-600 hover:bg-teal-50 rounded text-left"
        >
          <Plus size={12} />
          New folder…
        </button>
        <div className="h-px bg-slate-200 my-1" />
        <button
          type="button"
          onClick={isSaved ? onRename : () => onToast("Save the chat first")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-100 rounded text-left disabled:opacity-40"
          disabled={!isSaved}
        >
          <Pencil size={12} />
          Rename
        </button>
        <button
          type="button"
          onClick={isSaved ? onToggleStar : () => onToast("Save the chat first")}
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
          onClick={isSaved ? onDelete : () => onToast("Save the chat first")}
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
  folderId,
  folders,
  isPersisted,
  onToast,
}: {
  chatId: string;
  title: string;
  active?: boolean;
  isStarred?: boolean;
  folderId?: string | null;
  folders: FolderRecord[];
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
    if (active) router.replace("/chat");
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
          router.push(`/chat/${chatId}`);
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
          chatId={chatId}
          currentFolderId={folderId ?? null}
          folders={folders}
          isSaved={isPersisted}
          isStarred={!!isStarred}
          onClose={() => setMenuOpen(false)}
          onRename={handleRename}
          onToggleStar={handleToggleStar}
          onDelete={handleDelete}
          onToast={(label) => {
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
  collapsed,
  onCollapse,
  onOpenDrugPreview,
  onToast,
}: {
  activeChatId: string | null;
  activeDrugSlug: string | null;
  isDemo: boolean;
  // Real chats from the localStorage store (already sorted updatedAt desc).
  chats: SavedChat[];
  // When true, renders the narrow icon rail instead of the full panel.
  collapsed: boolean;
  // Toggle collapse/expand.
  onCollapse: () => void;
  onOpenDrugPreview: (slug: string) => void;
  onToast: (msg: string) => void;
}) {
  const wl = useExpandedSet(LS_WATCHLISTS, ["wl-1"]);
  const fl = useExpandedSet(LS_FOLDERS, ["f-1"]);

  // Real stores — always preferred over seed data.
  const realWatchlists = useWatchlists();
  const realFolders = useFolders();

  // Fall back to seed data only in demo mode and only when the real store
  // is empty — so a first-time user in demo mode sees populated sections,
  // but any real data they create takes over immediately.
  const watchlists: Array<{ id: string; name: string; items: Array<{ drug_id?: string; drug_slug?: string; drug_name: string; status: "red" | "amber" | "green" }> }> =
    realWatchlists.length > 0
      ? realWatchlists
      : isDemo
      ? SEED_WATCHLISTS.map((w) => ({ ...w, items: w.items.map((i) => ({ ...i, drug_id: i.drug_slug })) }))
      : [];

  const handleNewWatchlist = () => {
    const name = window.prompt("Watchlist name", "My Watchlist");
    if (name == null) return;
    createWatchlist(name);
  };

  const handleNewFolder = () => {
    const name = window.prompt("Folder name", "New Folder");
    if (name == null) return;
    createFolder(name);
  };

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

  const hasAnyChat = chats.length > 0 || showSeedRecents;
  const hasAnyContent = watchlists.length > 0 || realFolders.length > 0 || hasAnyChat;

  // ── Icon rail (collapsed state) ───────────────────────────────────────────
  if (collapsed) {
    const railBtn =
      "w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700 transition-colors";
    return (
      <aside className="w-[52px] shrink-0 bg-slate-50/60 border-r border-slate-200 flex flex-col items-center h-screen py-3 gap-0.5">
        {/* Brand icon — clicking expands the sidebar */}
        <button
          type="button"
          onClick={onCollapse}
          className="mb-1 rounded-lg hover:bg-slate-900/[0.06] p-1 transition-colors"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="Mederti" style={{ width: 26, height: 26, display: "block" }} />
        </button>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={onCollapse}
          className={railBtn}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>

        {/* New chat */}
        <Link
          href="/chat"
          className={railBtn}
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={16} />
        </Link>

        {/* Search — only when there's history */}
        {hasAnyChat ? (
          <button
            type="button"
            onClick={() => {
              onCollapse(); // expand first, then toast
              onToast("Search chats — coming soon");
            }}
            className={railBtn}
            title="Search chats"
            aria-label="Search chats"
          >
            <Search size={15} />
          </button>
        ) : null}

        {/* Watchlists — only in demo */}
        {watchlists.length > 0 ? (
          <button
            type="button"
            onClick={onCollapse}
            className={railBtn}
            title="Watchlists"
            aria-label="Watchlists"
          >
            <Bookmark size={15} />
          </button>
        ) : null}

        {/* Folders */}
        {realFolders.length > 0 ? (
          <button
            type="button"
            onClick={onCollapse}
            className={railBtn}
            title="Folders"
            aria-label="Folders"
          >
            <Folder size={15} />
          </button>
        ) : null}

        {/* Chat history */}
        {hasAnyChat ? (
          <button
            type="button"
            onClick={onCollapse}
            className={railBtn}
            title="Chat history"
            aria-label="Chat history"
          >
            <ChatBubble size={15} />
          </button>
        ) : null}

        {/* Spacer */}
        <div className="flex-1" />

        {/* User avatar */}
        <span
          className="w-7 h-7 rounded-full inline-flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
          style={{ background: "linear-gradient(135deg, #0d9488, #14b8a6)" }}
          title="Account"
        >
          R
        </span>
      </aside>
    );
  }

  // ── Full sidebar ──────────────────────────────────────────────────────────
  return (
    <aside className="w-[268px] shrink-0 bg-slate-50/60 border-r border-slate-200 flex flex-col h-screen">
      {/* Brand row — collapse toggle on the right so the brand stays in
          its expected spot on the left. */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-black.png"
          alt="Mederti"
          style={{ height: 22, width: "auto", display: "block" }}
        />
        <button
          type="button"
          onClick={onCollapse}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-900/[0.06] hover:text-slate-700 transition-colors"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeft size={15} />
        </button>
      </div>

      {/* Primary actions — Search hides until there's history to search */}
      <div className="px-2.5 pb-2.5 flex flex-col gap-0.5">
        <Link
          href="/chat"
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

        {/* Watchlists */}
        {watchlists.length > 0 ? (
          <div className="mt-1">
            <SectionHeader label="Watchlists" onAdd={handleNewWatchlist} />
            {watchlists.map((w) => {
              const isOpen = wl.open.has(w.id);
              return (
                <div key={w.id}>
                  <GroupRow
                    isOpen={isOpen}
                    icon={<Bookmark size={13} />}
                    label={w.name}
                    count={w.items.length}
                    onClick={() => wl.toggle(w.id)}
                  />
                  {isOpen && w.items.length > 0 ? (
                    <div className="pl-[18px] mt-px">
                      {w.items.map((it) => {
                        const itemId = it.drug_id ?? (it as any).drug_slug ?? "";
                        return (
                          <WatchlistDrugRow
                            key={itemId}
                            item={{ drug_slug: itemId, drug_name: it.drug_name, status: it.status }}
                            active={itemId === activeDrugSlug}
                            onOpen={onOpenDrugPreview}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Folders — show real folders, fall back to seed in demo only */}
        {realFolders.length > 0 ? (
          <div className="mt-3.5">
            <SectionHeader label="Folders" onAdd={handleNewFolder} />
            {realFolders.map((f) => {
              const isOpen = fl.open.has(f.id);
              const folderChats = chats.filter((c) => c.folderId === f.id);
              return (
                <div key={f.id}>
                  <GroupRow
                    isOpen={isOpen}
                    icon={<Folder size={13} />}
                    label={f.name}
                    count={folderChats.length}
                    onClick={() => fl.toggle(f.id)}
                  />
                  {isOpen && folderChats.length > 0 ? (
                    <div className="pl-[18px] mt-px">
                      {folderChats.map((c) => (
                        <ChatHistoryItem
                          key={c.id}
                          chatId={c.id}
                          title={c.title}
                          active={c.id === activeChatId}
                          isStarred={c.isStarred}
                          folderId={c.folderId}
                          folders={realFolders}
                          isPersisted
                          onToast={onToast}
                        />
                      ))}
                    </div>
                  ) : isOpen ? (
                    <div className="pl-[28px] py-1.5 text-[11px] text-slate-400">
                      No chats yet — move a chat here from its menu
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Recent chats (not in any folder) */}
        {realRecentsByBucket.length > 0 ? (
          <div className="mt-3.5">
            {realRecentsByBucket
              .map(([bucket, items]) => ({
                bucket,
                items: items.filter((c) => !c.folderId),
              }))
              .filter(({ items }) => items.length > 0)
              .map(({ bucket, items }) => (
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
                      folderId={c.folderId}
                      folders={realFolders}
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
                    folders={realFolders}
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

      {/* User footer + profile popover */}
      <UserFooter onToast={onToast} />
    </aside>
  );
}

function UserFooter({ onToast }: { onToast: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative border-t border-slate-200 bg-slate-50/60">
      {/* Profile popover — opens upward */}
      {open ? (
        <div
          className="absolute bottom-full left-2 right-2 mb-2 bg-white border border-slate-200 rounded-xl p-1 z-40"
          style={{ boxShadow: "0 12px 32px rgba(15,23,42,0.10), 0 3px 10px rgba(15,23,42,0.06)" }}
        >
          {/* Profile header */}
          <div className="flex items-center gap-3 px-3 py-3">
            <span
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
              style={{ background: "linear-gradient(135deg, #0d9488, #14b8a6)" }}
            >
              R
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-slate-900 leading-tight">Rob</div>
              <div className="text-[11px] text-slate-500 leading-tight">Mederti · Founder</div>
            </div>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 shrink-0">
              Founder
            </span>
          </div>

          <div className="h-px bg-slate-100 mx-1 mb-1" />

          {/* Actions */}
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            Account settings
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); onToast("Keyboard shortcuts — coming soon"); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors text-left"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
            Keyboard shortcuts
          </button>

          <div className="h-px bg-slate-100 mx-1 my-1" />

          <Link
            href="/login"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
            onClick={() => setOpen(false)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </Link>
        </div>
      ) : null}

      {/* Footer row — click anywhere to open */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-100/70 transition-colors text-left"
      >
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
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
