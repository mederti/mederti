"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChatApiResponse, ChatMessage, DrugDetail, SubstituteRow } from "@/lib/chat/types";
import {
  ChatMain,
  isSpreadsheet,
  type ActiveView,
  type AttachedFile,
  type Turn,
} from "./components/ChatMain";
import { PreviewPane } from "./components/PreviewPane";
import { Sidebar } from "./components/Sidebar";
import {
  deriveTitle,
  getChat,
  newChatId,
  upsertChat,
  useChatList,
  type SavedChat,
} from "./chatStore";
// Contexts the rich /chat drug cards expect. We provide them at this level
// so DrugCard → PharmacistCard / ProcurementCard / SupplierCard can open
// the preview pane, send follow-ups, and trigger lead-capture intents
// without knowing they're rendering inside chat2.
import { PaneContext } from "@/app/chat/components/PaneContext";
import { ChatContext } from "@/app/chat/components/ChatContext";
import { LeadContext } from "@/app/chat/components/LeadContext";
// The scoped chat.css defines the .mederti-chat-root variables and rules
// the cards rely on. Importing here puts the styles in the bundle; the
// wrapping <div className="mederti-chat-root"> below scopes them.
import "@/app/chat/chat.css";
import { DesktopOnly } from "@/app/components/DesktopOnly";

// /chat2 is intentionally public during layout iteration — no auth gate. The
// chat backend handles its own rate limiting; flip back on when promoting.

export default function Chat2Client({ chatId }: { chatId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Track the preview-pane drug ID in component state instead of reading it
  // straight from useSearchParams. Reason: we update the URL via
  // window.history.replaceState (see send() / setDrugInUrl below) to avoid
  // remounting Chat2Client across the /chat2 → /chat2/[id] page-segment
  // boundary mid-fetch, which used to orphan in-flight requests and dump the
  // user back on the welcome screen. useSearchParams doesn't pick up
  // history.replaceState changes, so state is the source of truth from here on.
  const [drugId, setDrugId] = useState<string | null>(searchParams.get("drug"));
  // ?demo=1 populates the sidebar with the seed watchlists/folders/recents
  // for design review. Default is the empty new-user state.
  const isDemo = searchParams.get("demo") === "1";

  const chatList = useChatList();

  // Sidebar collapse — persisted to localStorage so it survives reloads.
  // SSR safety: start collapsed=false, hydrate on mount.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("chat2:sidebar:collapsed") === "1") setSidebarCollapsed(true);
    } catch {}
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("chat2:sidebar:collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [drugsMap, setDrugsMap] = useState<Record<string, DrugDetail>>({});
  const [subsMap, setSubsMap] = useState<Record<string, SubstituteRow>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const idRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The "active" chat id — null on /chat2 (new chat). Once the user sends
  // their first message, we mint a uuid, save, and replace the URL so
  // refresh lands them in the same chat. We keep an internal ref so the
  // in-flight `send` knows which chat to write to even if the URL hasn't
  // caught up yet (router.replace is async).
  const activeIdRef = useRef<string | null>(chatId);

  // ── Load chat when chatId prop changes (URL navigation) ──
  useEffect(() => {
    activeIdRef.current = chatId;
    if (chatId === null) {
      // Switching to a fresh new-chat state
      setTurns([]);
      setDrugsMap({});
      setSubsMap({});
      idRef.current = 0;
      return;
    }
    const saved = getChat(chatId);
    if (!saved) {
      // Unknown id (link rot, deleted chat) — silently fall back to new chat
      router.replace("/chat", { scroll: false });
      return;
    }
    setTurns(saved.turns as Turn[]);
    setDrugsMap(saved.drugsMap);
    setSubsMap(saved.subsMap);
    // Make sure new turn IDs don't collide with loaded ones
    const maxId = saved.turns.reduce((m, t) => (t.id > m ? t.id : m), 0);
    idRef.current = maxId;
  }, [chatId, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const setDrugInUrl = useCallback(
    (id: string | null) => {
      setDrugId(id);
      // history.replaceState (not router.replace) so we don't trigger Next.js
      // routing — see the comment on `drugId` above. We read pathname from
      // window.location so this stays correct even after send() has soft-
      // updated the URL from /chat2 to /chat2/<id>.
      const params = new URLSearchParams(window.location.search);
      if (id) params.set("drug", id);
      else params.delete("drug");
      const qs = params.toString();
      const path = window.location.pathname;
      window.history.replaceState(null, "", `${path}${qs ? `?${qs}` : ""}`);
    },
    []
  );

  // Snapshot the in-memory chat state to storage. Called after every state
  // mutation that should persist (new user turn, AI response, error).
  const persist = useCallback(
    (
      id: string,
      nextTurns: Turn[],
      nextDrugs: Record<string, DrugDetail>,
      nextSubs: Record<string, SubstituteRow>
    ) => {
      const existing = getChat(id);
      const now = Date.now();
      const firstUser = nextTurns.find((t) => t.role === "user");
      const chat: SavedChat = {
        id,
        title: existing?.title ?? deriveTitle(firstUser?.text ?? ""),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        isStarred: existing?.isStarred ?? false,
        folderId: existing?.folderId ?? null,
        turns: nextTurns,
        drugsMap: nextDrugs,
        subsMap: nextSubs,
      };
      upsertChat(chat);
    },
    []
  );

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || pending) return;

      // Mint an id on first send if we don't have one yet, and replace the
      // URL so refresh / share works. We use the ref (not state) so the
      // request below sees the value immediately.
      let id = activeIdRef.current;
      const isNewChat = id === null;
      if (isNewChat) {
        id = newChatId();
        activeIdRef.current = id;
      }

      const userTurn: Turn = { id: ++idRef.current, role: "user", text: q };
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setDraft("");
      setPending(true);

      // Save eagerly so the chat shows up in the sidebar even if the
      // request is slow or fails.
      persist(id!, nextTurns, drugsMap, subsMap);
      if (isNewChat) {
        // Soft URL update — keeps refresh/share working without remounting
        // this Chat2Client across the /chat2 → /chat2/[id] page-segment
        // boundary. router.replace would orphan the in-flight fetch below.
        window.history.replaceState(null, "", `/chat/${id}`);
      }

      // 270-second client timeout — matches the Vercel maxDuration of 300s
      // minus a small buffer so we show a friendly error instead of a bare
      // network failure if the function is still running when Vercel cuts it.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 270_000);

      try {
        const payload: ChatMessage[] = nextTurns.map((t) => ({ role: t.role, text: t.text }));
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal,
        });

        // If the user switched chats mid-flight, drop the response on the
        // floor — it would corrupt whichever chat they're now viewing.
        if (activeIdRef.current !== id) return;

        // Vercel can return an HTML error page (504, etc.) — guard the parse.
        let data: ChatApiResponse;
        try {
          data = (await resp.json()) as ChatApiResponse;
        } catch {
          throw new Error(`Server error (${resp.status}) — please try again`);
        }

        if (!resp.ok || data.error) {
          const errTurn: Turn = {
            id: ++idRef.current,
            role: "assistant",
            text: "",
            error: data.error || `Request failed (${resp.status})`,
          };
          const finalTurns = [...nextTurns, errTurn];
          setTurns(finalTurns);
          persist(id!, finalTurns, drugsMap, subsMap);
          return;
        }
        const newDrugs = data.drugs ? { ...drugsMap, ...data.drugs } : drugsMap;
        const newSubs = data.subs ? { ...subsMap, ...data.subs } : subsMap;
        if (data.drugs) setDrugsMap(newDrugs);
        if (data.subs) setSubsMap(newSubs);
        const okTurn: Turn = {
          id: ++idRef.current,
          role: "assistant",
          text: data.content,
        };
        const finalTurns = [...nextTurns, okTurn];
        setTurns(finalTurns);
        persist(id!, finalTurns, newDrugs, newSubs);

        // Auto-open preview when this *response* references exactly one
        // drug. We look at the freshly-returned drugs (not the full map)
        // so a multi-drug history doesn't suppress single-drug responses.
        // Read window.location to bypass the stale searchParams closure.
        const newDrugIds = data.drugs ? Object.keys(data.drugs) : [];
        if (newDrugIds.length === 1) {
          const currentDrugParam = new URLSearchParams(window.location.search).get("drug");
          if (!currentDrugParam) {
            setDrugInUrl(newDrugIds[0]);
          }
        }
      } catch (e) {
        // Always show an error — even if the user has switched chats we want
        // the error stored so they see it when they come back (rather than
        // silently losing it). We only skip if the active chat has genuinely
        // changed to a *different* chat (not just navigating back to the same one).
        if (activeIdRef.current !== id && activeIdRef.current !== null) return;
        const isAbort = e instanceof DOMException && e.name === "AbortError";
        const msg = isAbort
          ? "The request timed out — this query takes a while. Try a more specific question."
          : e instanceof Error
          ? e.message
          : String(e);
        const errTurn: Turn = { id: ++idRef.current, role: "assistant", text: "", error: msg };
        const finalTurns = [...nextTurns, errTurn];
        setTurns(finalTurns);
        persist(id!, finalTurns, drugsMap, subsMap);
      } finally {
        clearTimeout(timeoutId);
        setPending(false);
      }
    },
    [pending, turns, drugsMap, subsMap, persist]
  );

  const openDrug = useCallback(
    (id: string) => {
      setDrugInUrl(id);
    },
    [setDrugInUrl]
  );

  // Reset to a fresh new-chat state. Can't just navigate to /chat because
  // send() writes the URL via history.replaceState — Next's router state is
  // still "/chat", so a <Link href="/chat"> no-ops. Reset state ourselves and
  // rewrite the URL the same way.
  const handleNewChat = useCallback(() => {
    activeIdRef.current = null;
    setTurns([]);
    setDrugsMap({});
    setSubsMap({});
    setDraft("");
    setAttachedFiles([]);
    setBulkFile(null);
    setActiveView("chat");
    idRef.current = 0;
    setDrugId(null);
    window.history.replaceState(null, "", "/chat");
  }, []);

  const closeDrug = useCallback(() => setDrugInUrl(null), [setDrugInUrl]);

  const askAboutDrug = useCallback(
    (name: string) => {
      const prompt = `Tell me more about ${name} — supply outlook, substitutes, who's affected.`;
      setDraft(prompt);
      // Defer focus to next frame so the textarea is mounted and re-measured.
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
      });
    },
    []
  );

  // Called when a dashboard or intelligence row is clicked. Switches to the
  // chat view and immediately sends the question so the user lands on a reply.
  const askFromView = useCallback(
    (q: string) => {
      setActiveView("chat");
      send(q);
    },
    [send]
  );

  // ── URL seed: ?q=<text>&send=1 deep links ──
  // Powers global SiteNav search bar (router.push to /chat?q=...&send=1) and
  // the per-drug "Ask Mederti" CTAs on /drugs/[id]. Pre-fills the composer or
  // auto-sends if send=1. Fires once per unique q+send combo, so re-navigating
  // with new params re-triggers. Ported from the old /chat page during the
  // chat2 → chat consolidation so deep links from the rest of the site keep
  // working after the merge.
  const lastSeedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const q = searchParams.get("q");
    if (!q) return;
    const sendFlag = searchParams.get("send");
    const key = `${q}|${sendFlag ?? ""}`;
    if (lastSeedKeyRef.current === key) return;
    lastSeedKeyRef.current = key;
    setActiveView("chat");
    if (sendFlag === "1") {
      void send(q);
    } else {
      setDraft(q);
      textareaRef.current?.focus();
    }
  }, [searchParams, send]);

  // A spreadsheet kicks off the BulkUpload flow immediately (takes over the
  // chat content area). Anything else (image, PDF, photo) lands as a chip in
  // the composer — visual parity with the landing-page search bar.
  const handleFilesPicked = useCallback((fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const list = Array.from(fl);
    const sheet = list.find(isSpreadsheet);
    if (sheet) {
      setActiveView("chat");
      setBulkFile(sheet);
      return;
    }
    const additions: AttachedFile[] = list.map((f) => ({
      id: Math.random().toString(36).slice(2, 10),
      name: f.name,
      type: f.type,
      size: f.size,
    }));
    setAttachedFiles((prev) => [...prev, ...additions]);
    list.forEach((f, i) => {
      if (!f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const targetId = additions[i].id;
        setAttachedFiles((prev) =>
          prev.map((p) => (p.id === targetId ? { ...p, preview: dataUrl } : p))
        );
      };
      reader.readAsDataURL(f);
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const closeBulkUpload = useCallback(() => setBulkFile(null), []);

  const paneCtx = useMemo(
    () => ({
      open: (id: string) => openDrug(id),
      close: closeDrug,
      back: closeDrug,
      current: drugId,
      previousId: null,
    }),
    [openDrug, closeDrug, drugId]
  );

  const chatCtx = useMemo(() => ({ send }), [send]);

  const leadCtx = useMemo(
    () => ({
      // Cards' Pre-order / Supplier-interest CTAs route here. v1 stub
      // until we want to surface the LeadCaptureModal in chat2 too.
      open: () => setToast("Lead capture flow not yet wired in chat2"),
    }),
    []
  );

  return (
    <PaneContext.Provider value={paneCtx}>
      <ChatContext.Provider value={chatCtx}>
        <LeadContext.Provider value={leadCtx}>
          {/* mederti-chat-root unlocks the scoped chat.css that the rich
              DrugCard variants depend on. It only sets CSS variables +
              styles inside the scope, so the rest of our Tailwind layout
              keeps working.

              Below 1024 the whole three-pane shell is replaced by a
              "best on desktop" splash (DesktopOnly). Between 1024 and 1439
              the sidebar + chat stay inline and PreviewPane becomes an
              overlay drawer (see its className + the backdrop below). */}
          <DesktopOnly>
          <div
            className="mederti-chat-root flex h-screen overflow-hidden bg-white text-slate-900"
            style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}
          >
            <Sidebar
              activeChatId={chatId}
              activeDrugSlug={drugId}
              isDemo={isDemo}
              chats={chatList}
              collapsed={sidebarCollapsed}
              onCollapse={toggleSidebar}
              onNewChat={handleNewChat}
              onOpenDrugPreview={() => setToast("Watchlist drug rows are seeded — wire to real drug IDs in v2")}
              onToast={setToast}
            />

            <ChatMain
              turns={turns}
              pending={pending}
              drugsMap={drugsMap}
              subsMap={subsMap}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              textareaRef={textareaRef}
              activeView={activeView}
              onViewChange={setActiveView}
              onAskFromView={askFromView}
              attachedFiles={attachedFiles}
              onFilesPicked={handleFilesPicked}
              onRemoveAttachment={removeAttachment}
              bulkFile={bulkFile}
              onBulkClose={closeBulkUpload}
            />

            {drugId ? (
              <>
                {/* Backdrop only renders below 3xl where the pane overlays
                    chat content. At 3xl+ the pane sits inline, so the
                    backdrop is hidden and chat stays usable beside it. */}
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={closeDrug}
                  className="3xl:hidden fixed inset-0 z-20 bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in duration-150"
                />
                <PreviewPane
                  key={drugId}
                  drugId={drugId}
                  onClose={closeDrug}
                  onOpenDrug={openDrug}
                  onAskAbout={askAboutDrug}
                  onToast={setToast}
                />
              </>
            ) : null}

            {toast ? (
              <div
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-slate-900 text-white text-[13px] rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
                role="status"
              >
                {toast}
              </div>
            ) : null}
          </div>
          </DesktopOnly>
        </LeadContext.Provider>
      </ChatContext.Provider>
    </PaneContext.Provider>
  );
}
