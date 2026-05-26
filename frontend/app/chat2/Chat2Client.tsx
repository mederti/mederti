"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ChatApiResponse, ChatMessage, DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { ChatMain, type Turn } from "./components/ChatMain";
import { PreviewPane } from "./components/PreviewPane";
import { Sidebar } from "./components/Sidebar";

// /chat2 is intentionally public during layout iteration — no auth gate. The
// chat backend handles its own rate limiting; flip back on when promoting.

export default function Chat2Client({ chatId }: { chatId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drugIdParam = searchParams.get("drug");

  const [turns, setTurns] = useState<Turn[]>([]);
  const [drugsMap, setDrugsMap] = useState<Record<string, DrugDetail>>({});
  const [subsMap, setSubsMap] = useState<Record<string, SubstituteRow>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const idRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || pending) return;
      const userTurn: Turn = { id: ++idRef.current, role: "user", text: q };
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setDraft("");
      setPending(true);
      try {
        const payload: ChatMessage[] = nextTurns.map((t) => ({ role: t.role, text: t.text }));
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: payload }),
        });
        const data = (await resp.json()) as ChatApiResponse;
        if (!resp.ok || data.error) {
          setTurns((t) => [
            ...t,
            {
              id: ++idRef.current,
              role: "assistant",
              text: "",
              error: data.error || `Request failed (${resp.status})`,
            },
          ]);
          return;
        }
        if (data.drugs) setDrugsMap((prev) => ({ ...prev, ...data.drugs }));
        if (data.subs) setSubsMap((prev) => ({ ...prev, ...data.subs }));
        setTurns((t) => [
          ...t,
          { id: ++idRef.current, role: "assistant", text: data.content },
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTurns((t) => [
          ...t,
          { id: ++idRef.current, role: "assistant", text: "", error: msg },
        ]);
      } finally {
        setPending(false);
      }
    },
    [pending, turns]
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
        onOpenDrugPreview={(slug) => setToast(`Watchlist drug rows are seeded — wire to real drug IDs in v2`)}
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
