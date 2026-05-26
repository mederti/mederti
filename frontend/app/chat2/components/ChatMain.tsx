"use client";

import { useEffect, useRef } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { BarChart, Bell, ChatBubble, Grid, Send } from "./icons";
import { parseAgentResponse, RenderedResponse } from "./parser2";
import { DashboardView } from "./DashboardView";
import { IntelligenceView } from "./IntelligenceView";

export type ActiveView = "chat" | "dashboard" | "intelligence";

export type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; error?: string };

const WELCOME_SUGGESTIONS = [
  "How will Iran's Strait of Hormuz closure affect critical injectable shortages?",
  "Is amoxicillin in shortage in Australia?",
  "Show me critical antibiotic shortages globally",
  "What's substitutable for hydrochlorothiazide?",
];

export function Chat2TopBar({
  activeView,
  onViewChange,
}: {
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
}) {
  const navBtn = (view: ActiveView, icon: React.ReactNode, label: string) => {
    const active = activeView === view;
    return (
      <button
        type="button"
        onClick={() => onViewChange(view)}
        className={`text-[13px] px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors ${
          active
            ? "text-slate-900 font-medium bg-slate-100"
            : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        }`}
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div className="h-14 flex items-center px-6 gap-3.5 shrink-0 border-b border-slate-100">
      <div className="mr-auto flex items-center gap-1">
        {navBtn("dashboard", <Grid size={14} />, "Dashboard")}
        {navBtn("chat", <ChatBubble size={14} />, "Chat")}
        {navBtn("intelligence", <BarChart size={14} />, "Intelligence")}
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
      >
        🇦🇺 AU
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell size={16} />
      </button>
    </div>
  );
}

export function ChatMain({
  turns,
  pending,
  drugsMap,
  subsMap,
  draft,
  onDraftChange,
  onSend,
  textareaRef,
  activeView,
  onViewChange,
  onAskFromView,
}: {
  turns: Turn[];
  pending: boolean;
  drugsMap: Record<string, DrugDetail>;
  subsMap: Record<string, SubstituteRow>;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
  // Called when a dashboard/intelligence row is clicked — switches to chat + sends
  onAskFromView: (q: string) => void;
}) {
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const lastUserId = (() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return turns[i].id;
    return null;
  })();

  useEffect(() => {
    if (lastUserId === null) return;
    lastUserMsgRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [lastUserId, pending]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const raf = requestAnimationFrame(() => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    });
    return () => cancelAnimationFrame(raf);
  }, [draft, textareaRef]);

  const isEmpty = turns.length === 0;

  return (
    <main className="flex-1 min-w-0 flex flex-col h-screen bg-white">
      <Chat2TopBar activeView={activeView} onViewChange={onViewChange} />

      {activeView === "dashboard" ? (
        <DashboardView onAsk={onAskFromView} />
      ) : activeView === "intelligence" ? (
        <IntelligenceView onAsk={onAskFromView} />
      ) : null}

      {activeView === "chat" ? (
        <>
        <div className="flex-1 overflow-y-auto pt-6 pb-8">
        <div className="max-w-[760px] mx-auto px-8">
          {isEmpty ? (
            <div className="text-center pt-14 pb-6">
              <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 mb-2.5">
                What do you need to know?
              </h1>
              <p className="text-[14px] text-slate-500 max-w-[480px] mx-auto">
                Ask about drug shortages, recalls, or substitutes across 22 countries. Mederti reads live regulator data and tells you the truth.
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-7">
                {WELCOME_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSend(s)}
                    className="bg-slate-50 border border-slate-200 rounded-full px-3.5 py-2 text-[13px] text-slate-700 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {turns.map((t) =>
                t.role === "user" ? (
                  <div
                    key={t.id}
                    ref={t.id === lastUserId ? lastUserMsgRef : undefined}
                    className="flex justify-end scroll-mt-20"
                  >
                    <div className="max-w-[80%] bg-slate-100 border border-slate-200 px-4 py-3 rounded-2xl rounded-br-md text-[14px] text-slate-900 leading-relaxed">
                      {t.text}
                    </div>
                  </div>
                ) : (
                  <div key={t.id} className="mb-2">
                    <div className="mb-3.5">
                      {/* Logomark indicator next to each AI reply.
                          Uses the real brand mark (app/icon.png — the
                          favicon/PWA icon source), not the placeholder
                          hex we shipped first. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/icon.png"
                        alt="Mederti"
                        style={{ width: 20, height: 20, display: "block" }}
                      />
                    </div>
                    {t.error ? (
                      <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                        {t.error}
                      </div>
                    ) : (
                      <RenderedResponse
                        parts={parseAgentResponse(t.text)}
                        drugs={drugsMap}
                        subs={subsMap}
                        onFollowup={onSend}
                      />
                    )}
                  </div>
                )
              )}
              {pending ? (
                <div className="flex items-center gap-1.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                    style={{ animationDelay: "120ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                    style={{ animationDelay: "240ms" }}
                  />
                </div>
              ) : null}
              <div className="min-h-[40vh]" aria-hidden />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-8 pt-3 pb-4 bg-white">
        <div className="max-w-[760px] mx-auto">
          <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-2xl pl-4 pr-1.5 py-1.5 shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-all">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend(draft);
                }
              }}
              placeholder="Ask anything about drug shortages…"
              rows={1}
              disabled={pending}
              className="flex-1 border-0 outline-none bg-transparent text-[14px] text-slate-900 placeholder:text-slate-400 py-2.5 resize-none leading-snug max-h-[200px] min-h-[24px]"
            />
            <button
              type="button"
              onClick={() => onSend(draft)}
              disabled={pending || draft.trim().length === 0}
              className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-900 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-100 disabled:hover:text-slate-500 transition-colors shrink-0"
              aria-label="Send"
            >
              <Send size={14} />
            </button>
          </div>
          <div className="text-center text-[11px] text-slate-400 mt-2.5">
            AI-powered · 30+ regulatory sources · Not medical advice
          </div>
        </div>
      </div>
        </>
      ) : null}
    </main>
  );
}
