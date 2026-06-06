"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChatApiResponse, ChatMessage, DrugDetail, SubstituteRow } from "@/lib/chat/types";
import {
  ChatMain,
  isSpreadsheet,
  type ActiveView,
  type AttachedFile,
  type ToolStep,
  type Turn,
} from "./components/ChatMain";
import { collectDrugCandidates } from "./components/parser2";
import { PreviewPane } from "./components/PreviewPane";
import { type ArticlePreviewItem } from "./components/ArticlePreviewPane";
import { ArticleReader, type ArticleFull } from "./components/ArticleReader";
import { ContextChat } from "./components/ContextChat";
import { GovDashboardView } from "./components/views/GovDashboardView";
import { EarlyWarningView } from "./components/views/EarlyWarningView";
import { ChevronLeft } from "./components/icons";
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

// Distill the most useful single string out of an arbitrary tool input
// object — preferring `query`, then a few common identifier-ish keys,
// then the first short string value as a last resort. Skips UUID-looking
// values so we don't render visual noise like an opaque drug id.
function pickToolQuery(input: Record<string, unknown>): string {
  const candidates = [
    "query",
    "search_query",
    "q",
    "generic_name",
    "drug_name",
    "name",
    "class",
    "atc",
    "country",
  ];
  for (const k of candidates) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 120) return v;
  }
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0 && v.length <= 60) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) continue;
      return v;
    }
  }
  return "";
}

// ── Reading "views": polished operational dashboards that open into the
// middle column with a grounded chat on the right (same pattern as articles).
// Each view is a self-contained component plus the metadata used to seed the
// side chat's grounding + starter questions.
type ViewKind = "dashboard" | "early-warning";

const VIEW_KINDS: ViewKind[] = ["dashboard", "early-warning"];

const VIEW_COMPONENT: Record<ViewKind, React.ComponentType> = {
  dashboard: GovDashboardView,
  "early-warning": EarlyWarningView,
};

const VIEW_CONFIG: Record<
  ViewKind,
  { title: string; category: string; headerLabel: string; bodyText: string; starters: string[] }
> = {
  dashboard: {
    title: "National Shortage Dashboard",
    category: "National medicines-supply dashboard (Australia)",
    headerLabel: "Ask about this dashboard",
    bodyText:
      "Mederti National Shortage Dashboard for Australia — the national medicines-supply picture across the TGA plus benchmarked regulators. Headline metrics: active shortages, essential medicines in shortage (WHO EML affected), medicines single-sourced nationally, median resolution time vs peers, and upstream alerts (India/China API sites). It lists the essential medicines currently in shortage (drug, class/ATC, suppliers active, duration, clinical risk, forecast return window), shows concentration risk by drug class (share dependent on a single API source), and benchmarks Australia's essential-medicine shortage burden against peer countries.",
    starters: [
      "Which essential medicines are at critical risk right now?",
      "How does Australia's shortage burden compare to peer countries?",
      "What's driving the beta-lactam antibiotic concentration risk?",
    ],
  },
  "early-warning": {
    title: "Early-warning radar",
    category: "Predictive early-warning radar (global)",
    headerLabel: "Ask about the radar",
    bodyText:
      "Mederti predictive early-warning radar (global). Forecasts which drugs are likely to go into shortage BEFORE official declaration, using upstream signals from 22 countries (e.g. India CDSCO GMP flags, China NMPA precursor export drops, environmental closures, recurring seasonal patterns, sponsor deregistrations). Drugs are ranked by probability × clinical impact, each with a signal driver, a predicted window, a probability, and a confidence score. Also surfaces a live upstream-site feed and the model's forecast-confidence / calibration.",
    starters: [
      "Why is cephalexin flagged as high-risk?",
      "What upstream signals feed amoxicillin supply?",
      "How accurate are these forecasts historically?",
    ],
  },
};

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
  // Name → drug_id map for clickable drug names inside markdown tables /
  // bolded prose. Populated by /api/resolve-drug-names after each assistant
  // turn; accumulates across the chat so once a drug is resolved, every
  // future mention of it (and re-renders of prior turns) is clickable.
  const [drugIdByName, setDrugIdByName] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  // Reading layout: an intelligence article opened into the middle column,
  // with ArticleChat grounded in it on the right. `readingArticle` is the card
  // metadata (instant header); `articleFull` is the fetched body (reader +
  // chat grounding). See the fetch effect below.
  const [readingArticle, setReadingArticle] = useState<ArticlePreviewItem | null>(null);
  const [articleFull, setArticleFull] = useState<ArticleFull | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  // A polished operational view (dashboard / early-warning / insights) opened
  // into the middle column with a grounded chat on the right. Mutually
  // exclusive with readingArticle.
  const [readingView, setReadingView] = useState<ViewKind | null>(null);
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
      setDrugIdByName({});
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
    const existingNameMap = saved.drugIdByName ?? {};
    setDrugIdByName(existingNameMap);
    // Make sure new turn IDs don't collide with loaded ones
    const maxId = saved.turns.reduce((m, t) => (t.id > m ? t.id : m), 0);
    idRef.current = maxId;

    // Back-fill the name map for chats saved before clickable table names
    // shipped — or for chats whose resolver call never completed (network
    // failure, tab closed mid-flight). Walk every assistant turn, gather
    // candidates, and resolve any we don't already know.
    const allText = saved.turns
      .filter((t) => t.role === "assistant" && !t.error)
      .map((t) => t.text)
      .join("\n\n");
    const candidates = collectDrugCandidates(allText);
    if (candidates.length === 0) return;
    const knownLower = new Set(Object.keys(existingNameMap).map((n) => n.toLowerCase()));
    const unresolved = candidates.filter((n) => !knownLower.has(n.toLowerCase()));
    if (unresolved.length === 0) return;

    void fetch("/api/resolve-drug-names", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names: unresolved }),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((resolved: Record<string, string>) => {
        if (activeIdRef.current !== chatId) return;
        if (!resolved || Object.keys(resolved).length === 0) return;
        const merged = { ...existingNameMap, ...resolved };
        setDrugIdByName(merged);
        // Persist so the next reload skips the round-trip.
        const current = getChat(chatId);
        if (current) {
          upsertChat({ ...current, drugIdByName: merged });
        }
      })
      .catch(() => {
        // Silent — clickable links are a nice-to-have, not critical.
      });
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
      nextSubs: Record<string, SubstituteRow>,
      nextNameMap: Record<string, string>
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
        drugIdByName: nextNameMap,
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
      persist(id!, nextTurns, drugsMap, subsMap, drugIdByName);
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

        // Streaming-aware error handling. A streaming success returns 200
        // with an NDJSON body; on rate-limit or hard failure the route
        // still returns JSON (the pre-stream early returns). Try the body
        // as NDJSON; if there's no reader (e.g. Vercel HTML error page),
        // fall through to a thrown error.
        if (!resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
          let errBody: ChatApiResponse | null = null;
          try {
            errBody = (await resp.json()) as ChatApiResponse;
          } catch {
            // fall through
          }
          const errTurn: Turn = {
            id: ++idRef.current,
            role: "assistant",
            text: "",
            error: errBody?.error || `Request failed (${resp.status})`,
          };
          const finalTurns = [...nextTurns, errTurn];
          setTurns(finalTurns);
          persist(id!, finalTurns, drugsMap, subsMap, drugIdByName);
          return;
        }

        if (!resp.body) {
          throw new Error(`Server error (${resp.status}) — please try again`);
        }

        // Add the assistant turn upfront with an empty body; text_delta
        // events from the route mutate its `text` in place as they arrive.
        // This is what makes tokens appear immediately instead of after a
        // 30–40s wait.
        const assistantTurnId = ++idRef.current;
        let assistantTurn: Turn = {
          id: assistantTurnId,
          role: "assistant",
          text: "",
          tool_steps: [],
        };
        let turnsWithAssistant = [...nextTurns, assistantTurn];
        setTurns(turnsWithAssistant);

        // Final-event payload — assembled from the terminal "done" frame.
        // We only run the drug-name resolver / preview-auto-open / persist
        // logic once "done" arrives, since those depend on the complete
        // text and the full drugs map.
        let doneData: {
          content: string;
          drugs?: Record<string, DrugDetail>;
          subs?: Record<string, SubstituteRow>;
        } | null = null;
        let streamError: string | null = null;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Pull complete lines out of the buffer; keep the trailing
            // partial line for the next chunk.
            let nl = buffer.indexOf("\n");
            while (nl !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (line) {
                try {
                  const evt = JSON.parse(line) as
                    | { type: "text_delta"; delta: string }
                    | {
                        type: "tool_start";
                        name: string;
                        id: string;
                        input?: Record<string, unknown>;
                      }
                    | {
                        type: "tool_done";
                        name: string;
                        id: string;
                        ms: number;
                        result_count?: number;
                        error?: boolean;
                      }
                    | {
                        type: "done";
                        content: string;
                        drugs?: Record<string, DrugDetail>;
                        subs?: Record<string, SubstituteRow>;
                      }
                    | { type: "error"; message: string };

                  if (evt.type === "text_delta") {
                    // Bail if the user switched chats mid-stream.
                    if (activeIdRef.current !== id) {
                      try { await reader.cancel(); } catch {}
                      return;
                    }
                    // Mutate the assistant turn's text in place and re-set
                    // turns so React renders the new text. Using a fresh
                    // object identity for the mutated turn forces the
                    // diff for that row.
                    assistantTurn = {
                      ...assistantTurn,
                      text: assistantTurn.text + evt.delta,
                    };
                    turnsWithAssistant = turnsWithAssistant.map((t) =>
                      t.id === assistantTurnId ? assistantTurn : t
                    );
                    setTurns(turnsWithAssistant);
                  } else if (evt.type === "tool_start") {
                    const newStep: ToolStep = {
                      id: evt.id,
                      name: evt.name,
                      query: pickToolQuery(evt.input ?? {}),
                      done: false,
                    };
                    assistantTurn = {
                      ...assistantTurn,
                      tool_steps: [...(assistantTurn.tool_steps ?? []), newStep],
                    };
                    turnsWithAssistant = turnsWithAssistant.map((t) =>
                      t.id === assistantTurnId ? assistantTurn : t
                    );
                    setTurns(turnsWithAssistant);
                  } else if (evt.type === "tool_done") {
                    const doneEvt = evt;
                    const steps: ToolStep[] = (assistantTurn.tool_steps ?? []).map(
                      (s): ToolStep =>
                        s.id === doneEvt.id
                          ? {
                              ...s,
                              done: true,
                              result_count: doneEvt.result_count,
                              error: doneEvt.error,
                            }
                          : s
                    );
                    assistantTurn = { ...assistantTurn, tool_steps: steps };
                    turnsWithAssistant = turnsWithAssistant.map((t) =>
                      t.id === assistantTurnId ? assistantTurn : t
                    );
                    setTurns(turnsWithAssistant);
                  } else if (evt.type === "done") {
                    doneData = {
                      content: evt.content,
                      drugs: evt.drugs,
                      subs: evt.subs,
                    };
                  } else if (evt.type === "error") {
                    streamError = evt.message;
                  }
                } catch {
                  // Malformed NDJSON line — skip it rather than crash.
                }
              }
              nl = buffer.indexOf("\n");
            }
          }
        } finally {
          try { reader.releaseLock(); } catch {}
        }

        if (streamError) {
          const errTurn: Turn = {
            id: assistantTurnId,
            role: "assistant",
            text: assistantTurn.text,
            error: streamError,
          };
          const finalTurns = turnsWithAssistant.map((t) =>
            t.id === assistantTurnId ? errTurn : t
          );
          setTurns(finalTurns);
          persist(id!, finalTurns, drugsMap, subsMap, drugIdByName);
          return;
        }

        // No "done" frame — the stream closed early. Keep whatever text
        // we've accumulated; just persist and bail without the
        // drugs/subs/preview side-effects.
        if (!doneData) {
          persist(id!, turnsWithAssistant, drugsMap, subsMap, drugIdByName);
          return;
        }

        const newDrugs = doneData.drugs ? { ...drugsMap, ...doneData.drugs } : drugsMap;
        const newSubs = doneData.subs ? { ...subsMap, ...doneData.subs } : subsMap;
        if (doneData.drugs) setDrugsMap(newDrugs);
        if (doneData.subs) setSubsMap(newSubs);

        // Replace the streamed text with the canonical `content` from the
        // server — handles edge cases (e.g. structured text-block
        // extraction with web-search citations) where the deltas and the
        // final message may not exactly agree.
        const okTurn: Turn = {
          id: assistantTurnId,
          role: "assistant",
          text: doneData.content || assistantTurn.text,
          tool_steps: assistantTurn.tool_steps,
        };

        // Seed the drug-name map with the canonical name → id pairs the
        // chat API already returned (one per cited <drug_card>). Free hits
        // — no extra round-trip needed for these.
        const seedFromTurnDrugs: Record<string, string> = {};
        if (doneData.drugs) {
          for (const [id2, det] of Object.entries(doneData.drugs)) {
            const name = (det as { generic_name?: string }).generic_name;
            if (name) seedFromTurnDrugs[name] = id2;
          }
        }
        const nameMapSeed = { ...drugIdByName, ...seedFromTurnDrugs };

        const finalTurns = turnsWithAssistant.map((t) =>
          t.id === assistantTurnId ? okTurn : t
        );
        setTurns(finalTurns);
        // Persist the seed so reloads keep links live even if the resolver
        // round-trip below never completes.
        persist(id!, finalTurns, newDrugs, newSubs, nameMapSeed);
        if (Object.keys(seedFromTurnDrugs).length > 0) {
          setDrugIdByName(nameMapSeed);
        }

        // Resolve the rest of the drug-name candidates from this response
        // (bolded names + markdown table cells) so they become clickable
        // into the preview pane. Fire-and-forget — failures just leave the
        // names as plain text.
        const candidates = collectDrugCandidates(okTurn.text || "");
        const knownLower = new Set(Object.keys(nameMapSeed).map((n) => n.toLowerCase()));
        const unresolved = candidates.filter((n) => !knownLower.has(n.toLowerCase()));

        if (unresolved.length > 0) {
          void fetch("/api/resolve-drug-names", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ names: unresolved }),
          })
            .then((r) => (r.ok ? r.json() : {}))
            .then((resolved: Record<string, string>) => {
              if (activeIdRef.current !== id) return;
              if (!resolved || Object.keys(resolved).length === 0) return;
              const merged = { ...nameMapSeed, ...resolved };
              setDrugIdByName(merged);
              // Re-persist with the resolver hits folded in so they
              // survive a reload of this chat.
              persist(id!, finalTurns, newDrugs, newSubs, merged);
            })
            .catch(() => {
              // Silent — clickable links are a nice-to-have, not critical.
            });
        }

        // Auto-open preview when this *response* references exactly one
        // drug. We look at the freshly-returned drugs (not the full map)
        // so a multi-drug history doesn't suppress single-drug responses.
        // Read window.location to bypass the stale searchParams closure.
        const newDrugIds = doneData.drugs ? Object.keys(doneData.drugs) : [];
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
        persist(id!, finalTurns, drugsMap, subsMap, drugIdByName);
      } finally {
        clearTimeout(timeoutId);
        setPending(false);
      }
    },
    [pending, turns, drugsMap, subsMap, drugIdByName, persist]
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
    setDrugIdByName({});
    setDraft("");
    setAttachedFiles([]);
    setBulkFile(null);
    setActiveView("chat");
    idRef.current = 0;
    setDrugId(null);
    setReadingArticle(null);
    setArticleFull(null);
    setReadingView(null);
    lastArticleSlugRef.current = null;
    lastViewKeyRef.current = null;
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

  // ── Reading layout: open / close an intelligence article ──
  // Reflect the open article in the URL (?article=<slug>) via
  // history.replaceState — same reasoning as setDrugInUrl: avoid Next.js
  // routing so we don't remount mid-session, while keeping refresh/share live.
  const openReadingArticle = useCallback((article: ArticlePreviewItem) => {
    setReadingView(null);
    setReadingArticle(article);
    setActiveView("intelligence");
    const params = new URLSearchParams(window.location.search);
    params.set("article", article.slug);
    params.delete("view");
    params.delete("drug");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  const closeReadingArticle = useCallback(() => {
    setReadingArticle(null);
    setArticleFull(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("article");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  // ── Reading layout: open / close an operational view ──
  const openView = useCallback((kind: ViewKind) => {
    setReadingArticle(null);
    setArticleFull(null);
    setReadingView(kind);
    setActiveView("intelligence");
    const params = new URLSearchParams(window.location.search);
    params.set("view", kind);
    params.delete("article");
    params.delete("drug");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  const closeView = useCallback(() => {
    setReadingView(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  // Fetch the full article body when the reading article changes. Feeds both
  // the reader (sections) and the side chat (body_text grounding). Also folds
  // the canonical metadata back into readingArticle so deep-links (?article=,
  // which start with only a slug) get a real title/summary for the chat.
  useEffect(() => {
    const slug = readingArticle?.slug;
    if (!slug) {
      setArticleFull(null);
      return;
    }
    let cancelled = false;
    setArticleLoading(true);
    setArticleFull(null);
    fetch(`/api/intelligence/article/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ArticleFull | { error: string } | null) => {
        if (cancelled || !j || "error" in j) return;
        setArticleFull(j);
        setReadingArticle((prev) =>
          prev && prev.slug === slug
            ? {
                ...prev,
                title: j.title,
                category: j.category,
                summary: j.summary,
                date: j.date,
                read_time: j.read_time,
                tag: j.tag,
                tag_tone: j.tag_tone,
              }
            : prev
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setArticleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readingArticle?.slug]);

  // ── URL seed: ?article=<slug> deep link ──
  // Powers the standalone /intelligence page links (router pushes
  // /chat?article=<slug>). Opens the reading layout from a bare slug; the
  // fetch effect above fills in the body + metadata.
  const lastArticleSlugRef = useRef<string | null>(null);
  useEffect(() => {
    const slug = searchParams.get("article");
    if (!slug || lastArticleSlugRef.current === slug) return;
    lastArticleSlugRef.current = slug;
    if (readingArticle?.slug === slug) return;
    setReadingView(null);
    // Readable placeholder title from the slug so a deep-link doesn't flash
    // "Loading…" — the fetch effect replaces it with the canonical title.
    const prettyTitle = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setReadingArticle({
      slug,
      category: "Intelligence",
      title: prettyTitle,
      summary: "",
      date: new Date().toISOString(),
      read_time: "",
      tag: "Intelligence",
      tag_tone: "neutral",
    });
    setActiveView("intelligence");
  }, [searchParams, readingArticle?.slug]);

  // ── URL seed: ?view=<kind> deep link ──
  // Opens an operational view (dashboard / early-warning / insights) directly,
  // e.g. from a link elsewhere in the app.
  const lastViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const v = searchParams.get("view");
    if (!v || lastViewKeyRef.current === v) return;
    if (!VIEW_KINDS.includes(v as ViewKind)) return;
    lastViewKeyRef.current = v;
    setReadingArticle(null);
    setArticleFull(null);
    setReadingView(v as ViewKind);
    setActiveView("intelligence");
  }, [searchParams]);

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

            {readingArticle ? (
              /* Reading layout: article fills the middle column, the
                 article-grounded chat sits on the right. Replaces ChatMain +
                 drug preview while active; the Sidebar stays. */
              <>
                <ArticleReader
                  article={readingArticle}
                  full={articleFull}
                  loading={articleLoading}
                  onClose={closeReadingArticle}
                />
                <ContextChat
                  key={`article:${readingArticle.slug}`}
                  contextKey={readingArticle.slug}
                  title={readingArticle.title}
                  category={`${readingArticle.category} article`}
                  bodyText={articleFull?.body_text ?? readingArticle.summary}
                  headerLabel="Ask about this article"
                  emptyLead={
                    <>
                      I&apos;ve read{" "}
                      <span className="font-medium text-slate-700">{readingArticle.title}</span>. Ask me
                      anything about it — I&apos;ll ground answers in the article and pull live Mederti
                      data where it helps.
                    </>
                  }
                  starters={[
                    "Summarise the key takeaways",
                    "Which drugs are most exposed?",
                    "What should a pharmacist do about this?",
                  ]}
                />
              </>
            ) : readingView ? (
              /* Operational view (dashboard / early-warning / insights) fills
                 the middle column with a grounded chat on the right. */
              (() => {
                const cfg = VIEW_CONFIG[readingView];
                const ViewComp = VIEW_COMPONENT[readingView];
                return (
                  <>
                    <main className="flex-1 min-w-0 flex flex-col h-screen bg-white">
                      <div className="h-14 flex items-center px-6 gap-3 shrink-0 border-b border-slate-100">
                        <button
                          type="button"
                          onClick={closeView}
                          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 px-2 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
                        >
                          <ChevronLeft size={14} />
                          Back
                        </button>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mx-1">
                          Live view
                        </span>
                      </div>
                      <div className="flex-1 min-h-0">
                        <ViewComp />
                      </div>
                    </main>
                    <ContextChat
                      key={`view:${readingView}`}
                      contextKey={readingView}
                      title={cfg.title}
                      category={cfg.category}
                      bodyText={cfg.bodyText}
                      headerLabel={cfg.headerLabel}
                      emptyLead={
                        <>
                          You&apos;re viewing{" "}
                          <span className="font-medium text-slate-700">{cfg.title}</span>. Ask me anything
                          about it — I&apos;ll use live Mederti data for specifics.
                        </>
                      }
                      starters={cfg.starters}
                    />
                  </>
                );
              })()
            ) : (
              <>
                <ChatMain
                  turns={turns}
                  pending={pending}
                  drugsMap={drugsMap}
                  subsMap={subsMap}
                  drugIdByName={drugIdByName}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={send}
                  textareaRef={textareaRef}
                  activeView={activeView}
                  onViewChange={setActiveView}
                  onAskFromView={askFromView}
                  onOpenArticle={openReadingArticle}
                  onOpenView={openView}
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
              </>
            )}

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
