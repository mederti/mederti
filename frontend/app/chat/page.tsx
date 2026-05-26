"use client";

/*
 * /chat — ported from the mederti-chat prototype, wrapped in the main site's
 * SiteNav and existing auth gate.
 *
 * Logged-out users see the sign-in card + SiteFooter (matches the rest of the site).
 * Logged-in users get the prototype's chat experience inside the SiteNav shell.
 *
 * Scoped styles live in ./chat.css under the .mederti-chat-root class so they
 * don't leak into the rest of the site.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { createBrowserClient } from "@/lib/supabase/client";

import type { ChatApiResponse, ChatMessage, DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { parseAgentResponse, RenderedResponse } from "./components/parser";
import { DrugPane } from "./components/DrugPane";
import { PaneContext, type PaneCtx } from "./components/PaneContext";
import { LeadCaptureModal, type LeadIntent } from "./components/LeadCaptureModal";
import { LeadContext, type LeadCtx } from "./components/LeadContext";
import { ChatContext, type ChatCtx } from "./components/ChatContext";

import "./chat.css";

type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; error?: string; drugIdByName?: Record<string, string> };

const SUGGESTIONS = [
  "Is amoxicillin in shortage in Australia?",
  "Show me critical antibiotic shortages globally",
  "What's substitutable for hydrochlorothiazide?",
  "Recent recalls in the US",
];

/**
 * Extract every `**bold**` span from the assistant's response and resolve each
 * one to a canonical drug_id via /api/search (FTS-ranked). The resulting map
 * lets parser.tsx wrap matching bold names in clickable DrugLink buttons that
 * open the PaneContext drug preview.
 *
 * Seed with drug_ids the API already hydrated (their generic_name → id is
 * known for free), then look up any remaining names in parallel.
 */
async function resolveDrugNames(
  content: string,
  hydrated: Record<string, DrugDetail>
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const id of Object.keys(hydrated)) {
    const d = hydrated[id];
    if (d?.generic_name) map[d.generic_name] = id;
  }
  // Strip <drug_card /> tag bodies and similar so we don't try to "resolve"
  // raw UUIDs or attribute names. Bold subjects are inside prose / tables.
  const stripped = content
    .replace(/<drug_card[^/]*\/>/g, "")
    .replace(/<sub_card[^/]*\/>/g, "")
    .replace(/<followups>[\s\S]*?<\/followups>/g, "")
    .replace(/<alternates>[\s\S]*?<\/alternates>/g, "");
  const names = [
    ...new Set(
      [...stripped.matchAll(/\*\*([^*\n]{2,80})\*\*/g)]
        .map((m) => m[1].trim())
        .filter((n) => n.length >= 2 && !map[n])
    ),
  ];
  if (names.length === 0) return map;

  await Promise.all(
    names.map(async (name) => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(name)}&limit=20`);
        if (!r.ok) return;
        const j = await r.json();
        const hits = (j.results ?? []) as Array<{ drug_id: string; generic_name: string; source: string }>;
        const drugHits = hits.filter((h) => h.source === "drugs");
        if (drugHits.length === 0) return;
        const lower = name.toLowerCase();
        const exact = drugHits.find((h) => h.generic_name.toLowerCase() === lower);
        const prefix = drugHits.find(
          (h) =>
            h.generic_name.toLowerCase().startsWith(lower + " ") ||
            h.generic_name.toLowerCase().startsWith(lower + "/")
        );
        const best = exact ?? prefix;
        // Only accept exact/prefix matches — otherwise a name like "Class II"
        // would resolve to the first drug containing "class" by FTS rank.
        if (best) map[name] = best.drug_id;
      } catch {
        // Network errors silently skip — the bold just stays unclickable.
      }
    })
  );
  return map;
}

function ChatPageInner() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [drugsMap, setDrugsMap] = useState<Record<string, DrugDetail>>({});
  const [subsMap, setSubsMap] = useState<Record<string, SubstituteRow>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paneStack, setPaneStack] = useState<string[]>([]);
  const paneDrugId = paneStack[paneStack.length - 1] ?? null;
  const previousPaneId = paneStack.length > 1 ? paneStack[paneStack.length - 2] : null;
  const [leadIntent, setLeadIntent] = useState<LeadIntent | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);

  // Id of the most-recent user turn — the scroll anchor.
  const lastUserId = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "user") return turns[i].id;
    }
    return null;
  }, [turns]);

  // Auth state — gate behind login (matches previous /chat behavior).
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  useEffect(() => {
    createBrowserClient().auth.getSession().then(({ data: { session } }) => {
      setIsAuthed(!!session);
      setAuthChecked(true);
    });
  }, []);

  // URL-seed support — when this page is opened (or re-navigated) with
  // ?q=<text>, prefill the composer; when ?send=1 is also present, auto-fire
  // the question. Used by deep links from elsewhere in the app (e.g. the
  // per-drug "Ask Mederti" CTA on /drugs/[id]) AND by the global SiteNav
  // search bar while on /chat (router.push to /chat?q=...&send=1 reroutes
  // drug autocomplete into the chat instead of /drugs/[id]). Fires once per
  // unique q+send combo, so re-navigating with new params triggers again.
  const searchParams = useSearchParams();
  const lastSeedKeyRef = useRef<string | null>(null);

  // Scroll the latest user question to the top of the viewport so the reader
  // starts at the beginning of the assistant's response, not the end.
  // Fires once when a new user message is sent, and again when the response
  // arrives (more content below means the message can now reach the top).
  // "auto" behavior lets the browser pick — smooth in real Chrome, instant in
  // headless environments — and avoids cases where a smooth scroll gets
  // dropped while another effect re-renders the list.
  useEffect(() => {
    if (lastUserId === null) return;
    lastUserMsgRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [lastUserId, pending]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Defer to next frame so CSS (padding, line-height) is applied before
    // we read scrollHeight — otherwise the first measurement can be stale
    // (200px on first mount, which then sticks until the user types).
    const raf = requestAnimationFrame(() => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    });
    return () => cancelAnimationFrame(raf);
  }, [draft]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;

    const userTurn: Turn = { id: ++idRef.current, role: "user", text: q };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setDraft("");
    setError(null);
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
        setError(data.error || `Request failed (${resp.status})`);
        setTurns((t) => [
          ...t,
          { id: ++idRef.current, role: "assistant", text: "", error: data.error || `Request failed (${resp.status})` },
        ]);
        return;
      }

      if (data.drugs) setDrugsMap((prev) => ({ ...prev, ...data.drugs }));
      if (data.subs) setSubsMap((prev) => ({ ...prev, ...data.subs }));

      const assistantId = ++idRef.current;
      setTurns((t) => [
        ...t,
        { id: assistantId, role: "assistant", text: data.content },
      ]);

      // Resolve bolded subject names → drug_ids so DrugLink can hook them up.
      // Seed with the drugs the API already hydrated (those have known UUIDs),
      // then fill any gaps via /api/search (FTS-ranked, prefers canonical).
      resolveDrugNames(data.content, data.drugs || {}).then((map) => {
        if (Object.keys(map).length === 0) return;
        setTurns((t) =>
          t.map((tt) =>
            tt.id === assistantId && tt.role === "assistant"
              ? { ...tt, drugIdByName: map }
              : tt
          )
        );
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setTurns((t) => [
        ...t,
        { id: ++idRef.current, role: "assistant", text: "", error: msg },
      ]);
    } finally {
      setPending(false);
    }
  }, [pending, turns]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }

  // Consume ?q= / ?send= once the user is past the auth gate. Re-fires when
  // the params change (e.g. the user picks a new drug from the SiteNav search
  // while staying on /chat), but only once per unique q+send combo.
  useEffect(() => {
    if (!authChecked || !isAuthed) return;
    const q = searchParams.get("q");
    if (!q) return;
    const sendFlag = searchParams.get("send");
    const key = `${q}|${sendFlag ?? ""}`;
    if (lastSeedKeyRef.current === key) return;
    lastSeedKeyRef.current = key;
    if (sendFlag === "1") {
      void send(q);
    } else {
      setDraft(q);
      textareaRef.current?.focus();
    }
  }, [authChecked, isAuthed, searchParams, send]);

  const paneCtx: PaneCtx = useMemo(
    () => ({
      open: (id: string) =>
        setPaneStack((stack) => (stack[stack.length - 1] === id ? stack : [...stack, id])),
      close: () => setPaneStack([]),
      back: () => setPaneStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack)),
      current: paneDrugId,
      previousId: previousPaneId,
    }),
    [paneDrugId, previousPaneId]
  );

  const leadCtx: LeadCtx = useMemo(
    () => ({ open: (intent: LeadIntent) => setLeadIntent(intent) }),
    []
  );

  const chatCtx: ChatCtx = useMemo(() => ({ send }), [send]);

  // ── Auth gate (logged-out users see sign-in card + footer) ──
  if (authChecked && !isAuthed) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        minHeight: "100vh", background: "var(--app-bg)",
        color: "var(--app-text)",
      }}>
        <SiteNav />
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, textAlign: "center", padding: 24,
        }}>
          <div style={{ marginBottom: 4, display: "flex", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Sign in to use Mederti Intelligence</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", maxWidth: 340, lineHeight: 1.6 }}>
            Get full access to AI-powered drug shortage intelligence, forecasting, and supplier connections.
          </div>
          <Link href="/login?next=/chat" style={{
            padding: "12px 24px", borderRadius: 10,
            background: "var(--teal)", color: "#fff",
            fontSize: 14, fontWeight: 500, textDecoration: "none",
          }}>
            Sign in
          </Link>
          <Link href="/signup" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
            Create free account
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // ── Authenticated chat experience ──
  const isEmpty = turns.length === 0;
  const paneOpen = !!paneDrugId;

  return (
    <PaneContext.Provider value={paneCtx}>
    <LeadContext.Provider value={leadCtx}>
    <ChatContext.Provider value={chatCtx}>
      <div className="mederti-chat-root">
        <SiteNav />
        <div className={`layout ${paneOpen ? "layout-pane-open" : ""}`}>
          <main className="chat-shell">
            {isEmpty ? (
              <div className="chat-welcome">
                <h1>What do you need to know?</h1>
                <p>
                  Ask about drug shortages, recalls, or substitutes across 22 countries. Mederti reads live regulator data and tells you the truth.
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="chat-suggestion" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="msg-list">
                {turns.map((t) =>
                  t.role === "user" ? (
                    <div
                      key={t.id}
                      className="msg msg-user"
                      ref={t.id === lastUserId ? lastUserMsgRef : undefined}
                    >
                      <div className="msg-bubble-user">{t.text}</div>
                    </div>
                  ) : (
                    <div key={t.id} className="msg">
                      {t.error ? (
                        <div className="err">{t.error}</div>
                      ) : (
                        <RenderedResponse
                          parts={parseAgentResponse(t.text)}
                          drugs={drugsMap}
                          subs={subsMap}
                          onFollowup={send}
                          drugIdByName={t.role === "assistant" ? t.drugIdByName : undefined}
                        />
                      )}
                    </div>
                  )
                )}
                {pending ? (
                  <div className="msg">
                    <div className="typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                ) : null}
                {/* Tail spacer: gives the last user message enough room
                    beneath it to actually scroll to the top of the viewport
                    when the response is short. */}
                <div className="msg-list-tail" aria-hidden />
              </div>
            )}

            {error && turns.length === 0 ? <div className="err">{error}</div> : null}

            <div className="composer-wrap">
              <div className="composer">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about a drug, shortage, or recall…"
                  rows={1}
                  disabled={pending}
                />
                <button
                  type="button"
                  className="composer-send"
                  disabled={pending || draft.trim().length === 0}
                  onClick={() => send(draft)}
                  aria-label="Send"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8L13 8M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="composer-foot">
                Mederti reads live regulator data · v0 demo · enter to send · shift+enter for newline
              </div>
            </div>
          </main>

          <DrugPane
            drugId={paneDrugId}
            previousDrugId={previousPaneId}
            previousDrugName={previousPaneId ? drugsMap[previousPaneId]?.name ?? null : null}
            onClose={() => setPaneStack([])}
            onOpenDrug={(id) =>
              setPaneStack((stack) => (stack[stack.length - 1] === id ? stack : [...stack, id]))
            }
            onBack={() => setPaneStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))}
          />

          <LeadCaptureModal
            intent={leadIntent}
            open={leadIntent !== null}
            onClose={() => setLeadIntent(null)}
          />
        </div>
      </div>
    </ChatContext.Provider>
    </LeadContext.Provider>
    </PaneContext.Provider>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
