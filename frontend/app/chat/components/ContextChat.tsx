"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { ToolSteps, type ToolStep, type Turn } from "./ChatMain";
import { parseAgentResponse, RenderedResponse } from "./parser2";
import { Send, ChatBubble } from "./icons";

// Distil a short label from a tool-input object for the step rows.
function pickToolQuery(input: Record<string, unknown>): string {
  for (const k of ["query", "generic_name", "drug_name", "name", "class", "country"]) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 120) return v;
  }
  return "";
}

export interface ContextChatProps {
  // Changing this resets the conversation (new article slug / new view).
  contextKey: string;
  // Human title of what's on screen — shown in the empty state + sent as the
  // grounding title.
  title: string;
  // Grounding text: the article body, or a description of the view's content.
  bodyText: string;
  // Optional context label sent to the model (e.g. "Supply Chain article",
  // "National dashboard").
  category?: string;
  // Header strip label. Defaults to "Ask about this".
  headerLabel?: string;
  // Lead sentence in the empty state. Defaults to a generic article line.
  emptyLead?: React.ReactNode;
  // Suggested starter questions.
  starters?: string[];
}

const DEFAULT_STARTERS = [
  "Summarise the key takeaways",
  "Which drugs are most exposed?",
  "What should I do about this?",
];

/**
 * Right-hand chat column shown while viewing content (an intelligence article,
 * a dashboard, or an analytical view). Self-contained: its own turns,
 * streaming, and drug map. Every send carries the content as `article_context`
 * so /api/chat grounds answers in what's on screen. No persistence — this Q&A
 * is scoped to the viewing session.
 */
export function ContextChat({
  contextKey,
  title,
  bodyText,
  category,
  headerLabel = "Ask about this",
  emptyLead,
  starters = DEFAULT_STARTERS,
}: ContextChatProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [drugsMap, setDrugsMap] = useState<Record<string, DrugDetail>>({});
  const [subsMap, setSubsMap] = useState<Record<string, SubstituteRow>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const idRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the conversation whenever the context changes.
  useEffect(() => {
    setTurns([]);
    setDrugsMap({});
    setSubsMap({});
    setDraft("");
    idRef.current = 0;
  }, [contextKey]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, pending]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [draft]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || pending) return;

      const userTurn: Turn = { id: ++idRef.current, role: "user", text: q };
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setDraft("");
      setPending(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 270_000);

      try {
        const payload = nextTurns.map((t) => ({ role: t.role, text: t.text }));
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: payload,
            article_context: { title, category, summary: title, body: bodyText },
          }),
          signal: controller.signal,
        });

        if (!resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
          let errMsg = `Request failed (${resp.status})`;
          try {
            const j = (await resp.json()) as { error?: string };
            if (j?.error) errMsg = j.error;
          } catch {}
          setTurns([...nextTurns, { id: ++idRef.current, role: "assistant", text: "", error: errMsg }]);
          return;
        }
        if (!resp.body) throw new Error(`Server error (${resp.status}) — please try again`);

        const assistantId = ++idRef.current;
        let assistantTurn: Turn = { id: assistantId, role: "assistant", text: "", tool_steps: [] };
        let working = [...nextTurns, assistantTurn];
        setTurns(working);

        let done: { content: string; drugs?: Record<string, DrugDetail>; subs?: Record<string, SubstituteRow> } | null = null;
        let streamErr: string | null = null;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const flush = () => setTurns(working.map((t) => (t.id === assistantId ? assistantTurn : t)));

        try {
          while (true) {
            const { value, done: rdDone } = await reader.read();
            if (rdDone) break;
            buffer += decoder.decode(value, { stream: true });
            let nl = buffer.indexOf("\n");
            while (nl !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              nl = buffer.indexOf("\n");
              if (!line) continue;
              try {
                const evt = JSON.parse(line);
                if (evt.type === "text_delta") {
                  assistantTurn = { ...assistantTurn, text: assistantTurn.text + evt.delta };
                  flush();
                } else if (evt.type === "tool_start") {
                  const step: ToolStep = { id: evt.id, name: evt.name, query: pickToolQuery(evt.input ?? {}), done: false };
                  assistantTurn = { ...assistantTurn, tool_steps: [...(assistantTurn.tool_steps ?? []), step] };
                  flush();
                } else if (evt.type === "tool_done") {
                  const steps: ToolStep[] = (assistantTurn.tool_steps ?? []).map((s: ToolStep): ToolStep =>
                    s.id === evt.id ? { ...s, done: true, result_count: evt.result_count, error: evt.error } : s
                  );
                  assistantTurn = { ...assistantTurn, tool_steps: steps };
                  flush();
                } else if (evt.type === "done") {
                  done = { content: evt.content, drugs: evt.drugs, subs: evt.subs };
                } else if (evt.type === "error") {
                  streamErr = evt.message;
                }
              } catch {
                // Skip malformed NDJSON line.
              }
            }
          }
        } finally {
          try { reader.releaseLock(); } catch {}
        }

        if (streamErr) {
          assistantTurn = { id: assistantId, role: "assistant", text: assistantTurn.text, error: streamErr };
          flush();
          return;
        }
        if (done) {
          if (done.drugs) setDrugsMap((m) => ({ ...m, ...done!.drugs }));
          if (done.subs) setSubsMap((m) => ({ ...m, ...done!.subs }));
          assistantTurn = {
            id: assistantId,
            role: "assistant",
            text: done.content || assistantTurn.text,
            tool_steps: assistantTurn.tool_steps,
          };
          flush();
        }
      } catch (e) {
        const isAbort = e instanceof DOMException && e.name === "AbortError";
        const msg = isAbort
          ? "The request timed out — try a more specific question."
          : e instanceof Error
          ? e.message
          : String(e);
        setTurns((prev) => [...prev, { id: ++idRef.current, role: "assistant", text: "", error: msg }]);
      } finally {
        clearTimeout(timeoutId);
        setPending(false);
      }
    },
    [pending, turns, title, category, bodyText]
  );

  const isEmpty = turns.length === 0;

  return (
    <aside className="context-rail hidden min-[1080px]:flex flex-col shrink-0 w-[380px] bg-white border-l border-slate-200">
      <div className="h-14 flex items-center gap-2 px-5 shrink-0 border-b border-slate-100">
        <ChatBubble size={15} className="text-teal-600" />
        <div className="text-[13px] font-semibold text-slate-900">{headerLabel}</div>
        <span className="ml-auto text-[11px] text-slate-400">Mederti AI</span>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5">
        {isEmpty ? (
          <div className="pt-2">
            <p className="text-[13px] text-slate-500 leading-relaxed mb-4">
              {emptyLead ?? (
                <>
                  I&apos;ve read <span className="font-medium text-slate-700">{title}</span>. Ask me anything
                  about it — I&apos;ll ground answers in it and pull live Mederti data where it helps.
                </>
              )}
            </p>
            <div className="flex flex-col gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="flex justify-end">
                  <div className="max-w-[85%] bg-slate-100 border border-slate-200 px-3.5 py-2.5 rounded-2xl rounded-br-md text-[13.5px] text-slate-900 leading-relaxed">
                    {t.text}
                  </div>
                </div>
              ) : (
                <div key={t.id}>
                  {t.tool_steps && t.tool_steps.length > 0 ? (
                    <ToolSteps steps={t.tool_steps} hasText={t.text.length > 0} />
                  ) : null}
                  {t.error ? (
                    <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                      {t.error}
                    </div>
                  ) : (
                    <RenderedResponse
                      parts={parseAgentResponse(t.text)}
                      drugs={drugsMap}
                      subs={subsMap}
                      drugIdByName={{}}
                      onFollowup={send}
                    />
                  )}
                </div>
              )
            )}
            {pending ? (
              <div className="flex items-center gap-1.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "240ms" }} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3 border-t border-slate-100">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-all flex items-end gap-1 pl-3 pr-1.5 py-1.5">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Ask about what you're viewing…"
            rows={1}
            disabled={pending}
            className="flex-1 border-0 outline-none bg-transparent text-[13.5px] text-slate-900 placeholder:text-slate-400 px-1 py-2 resize-none leading-snug max-h-[160px] min-h-[22px]"
          />
          <button
            type="button"
            onClick={() => send(draft)}
            disabled={pending || draft.trim().length === 0}
            aria-label="Send"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-900 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-100 disabled:hover:text-slate-500 transition-colors shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="text-center text-[10.5px] text-slate-400 mt-2">
          Grounded in this view + live Mederti data · Not medical advice
        </div>
      </div>
    </aside>
  );
}
