"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ChatApiResponse, ChatMessage, DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { ChatMain, type Turn } from "./components/ChatMain";
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

// /chat2 is intentionally public during layout iteration — no auth gate. The
// chat backend handles its own rate limiting; flip back on when promoting.

export default function Chat2Client({ chatId }: { chatId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drugIdParam = searchParams.get("drug");
  // ?demo=1 populates the sidebar with the seed watchlists/folders/recents
  // for design review. Default is the empty new-user state.
  const isDemo = searchParams.get("demo") === "1";

  const chatList = useChatList();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [drugsMap, setDrugsMap] = useState<Record<string, DrugDetail>>({});
  const [subsMap, setSubsMap] = useState<Record<string, SubstituteRow>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
      router.replace("/chat2", { scroll: false });
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
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("drug", id);
      else params.delete("drug");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams]
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
        router.replace(`/chat2/${id}`, { scroll: false });
      }

      try {
        const payload: ChatMessage[] = nextTurns.map((t) => ({ role: t.role, text: t.text }));
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: payload }),
        });
        const data = (await resp.json()) as ChatApiResponse;

        // If the user switched chats mid-flight, drop the response on the
        // floor — it would corrupt whichever chat they're now viewing.
        if (activeIdRef.current !== id) return;

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
      } catch (e) {
        if (activeIdRef.current !== id) return;
        const msg = e instanceof Error ? e.message : String(e);
        const errTurn: Turn = { id: ++idRef.current, role: "assistant", text: "", error: msg };
        const finalTurns = [...nextTurns, errTurn];
        setTurns(finalTurns);
        persist(id!, finalTurns, drugsMap, subsMap);
      } finally {
        setPending(false);
      }
    },
    [pending, turns, drugsMap, subsMap, persist, router]
  );

  const openDrug = useCallback(
    (id: string) => {
      setDrugInUrl(id);
    },
    [setDrugInUrl]
  );

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

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900" style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}>
      <Sidebar
        activeChatId={chatId}
        activeDrugSlug={drugIdParam}
        isDemo={isDemo}
        chats={chatList}
        onOpenDrugPreview={() => setToast("Watchlist drug rows are seeded — wire to real drug IDs in v2")}
        onToast={setToast}
      />

      <ChatMain
        turns={turns}
        pending={pending}
        drugsMap={drugsMap}
        subsMap={subsMap}
        activeDrugId={drugIdParam}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onOpenDrug={openDrug}
        textareaRef={textareaRef}
      />

      {drugIdParam ? (
        <PreviewPane
          key={drugIdParam}
          drugId={drugIdParam}
          onClose={closeDrug}
          onOpenDrug={openDrug}
          onAskAbout={askAboutDrug}
          onToast={setToast}
        />
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
  );
}
