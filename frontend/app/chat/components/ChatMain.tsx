"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";
import {
  BarChart, Bell, ChatBubble, Close, FileChip, Grid, ImageChip,
  Paperclip, ScanBarcode, Send, SheetChip,
} from "./icons";
import { parseAgentResponse, RenderedResponse } from "./parser2";
import { DashboardView } from "./DashboardView";
import { IntelligenceView } from "./IntelligenceView";
import BulkUpload from "@/app/components/bulk-upload";

export type ActiveView = "chat" | "dashboard" | "intelligence";

export type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; error?: string };

export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
}

const SPREADSHEET_EXTS = ["csv", "tsv", "xlsx", "xls"];

export function isSpreadsheet(f: File): boolean {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return SPREADSHEET_EXTS.includes(ext);
}

function chipIcon(type: string, name: string) {
  if (type.startsWith("image/")) return <ImageChip size={12} />;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (SPREADSHEET_EXTS.includes(ext)) return <SheetChip size={12} />;
  return <FileChip size={12} />;
}

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
  drugIdByName,
  draft,
  onDraftChange,
  onSend,
  textareaRef,
  activeView,
  onViewChange,
  onAskFromView,
  attachedFiles,
  onFilesPicked,
  onRemoveAttachment,
  bulkFile,
  onBulkClose,
}: {
  turns: Turn[];
  pending: boolean;
  drugsMap: Record<string, DrugDetail>;
  subsMap: Record<string, SubstituteRow>;
  // Name → drug_id map, accumulated across turns by Chat2Client, used by
  // the parser to make bold names + table cells clickable into the pane.
  drugIdByName: Record<string, string>;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
  // Called when a dashboard/intelligence row is clicked — switches to chat + sends
  onAskFromView: (q: string) => void;
  attachedFiles: AttachedFile[];
  onFilesPicked: (fl: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  bulkFile: File | null;
  onBulkClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const lastUserId = (() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return turns[i].id;
    return null;
  })();

  // Size the bottom spacer to exactly what's needed for the last user message
  // to scroll to the top of the viewport — no more, no less. Avoids the empty
  // gap under short answers while still allowing scroll-to-top on new turns.
  useLayoutEffect(() => {
    if (lastUserId === null) return;
    const scroller = scrollerRef.current;
    const lastMsg = lastUserMsgRef.current;
    const spacer = spacerRef.current;
    if (!scroller || !lastMsg || !spacer) return;

    const adjust = () => {
      const currentSpacer = spacer.offsetHeight;
      const scrollerRect = scroller.getBoundingClientRect();
      const lastMsgRect = lastMsg.getBoundingClientRect();
      const lastMsgTop = scroller.scrollTop + (lastMsgRect.top - scrollerRect.top);
      const tailWithoutSpacer = scroller.scrollHeight - lastMsgTop - currentSpacer;
      const needed = Math.max(0, scroller.clientHeight - tailWithoutSpacer);
      if (Math.abs(needed - currentSpacer) > 1) {
        spacer.style.height = `${needed}px`;
      }
    };

    adjust();
    const onResize = () => adjust();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [lastUserId, pending, turns]);

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

      {activeView === "chat" && bulkFile ? (
        <div className="flex-1 overflow-y-auto bg-slate-50">
          <BulkUpload file={bulkFile} onClose={onBulkClose} />
        </div>
      ) : null}

      {activeView === "chat" && !bulkFile ? (
        <>
        <div ref={scrollerRef} className="flex-1 overflow-y-auto pt-6 pb-8">
        <div className="max-w-[900px] mx-auto px-8">
          {isEmpty ? (
            <div className="text-center pt-14 pb-6">
              <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 mb-2.5">
                What do you need to know?
              </h1>
              <p className="text-[14px] text-slate-500 max-w-[480px] mx-auto">
                Ask about drug shortages, recalls, or substitutes across the markets Mederti indexes. Live regulator data — and honest about what's not covered.
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
                        drugIdByName={drugIdByName}
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
              <div ref={spacerRef} aria-hidden />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-8 pt-3 pb-4 bg-white">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-all overflow-hidden">
            {attachedFiles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1 border-b border-slate-100">
                {attachedFiles.map((f) => (
                  <div
                    key={f.id}
                    className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-slate-50 border border-slate-200 text-[12px] text-slate-700"
                  >
                    {f.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.preview} alt="" className="w-4 h-4 rounded-sm object-cover" />
                    ) : (
                      <span className="text-slate-400">{chipIcon(f.type, f.name)}</span>
                    )}
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(f.id)}
                      className="p-0.5 text-slate-400 hover:text-slate-700"
                      aria-label={`Remove ${f.name}`}
                    >
                      <Close size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-1 pl-2 pr-1.5 py-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
                title="Attach files (CSV, Excel, PDF, images)"
                aria-label="Attach files"
                className="w-9 h-9 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-teal-600 hover:bg-slate-50 transition-colors shrink-0"
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={pending}
                title="Scan barcode or take photo of product"
                aria-label="Scan barcode or take photo"
                className="w-9 h-9 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-teal-600 hover:bg-slate-50 transition-colors shrink-0"
              >
                <ScanBarcode size={16} />
              </button>
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
                placeholder="Ask anything, upload a spreadsheet, or scan a barcode…"
                rows={1}
                disabled={pending}
                className="flex-1 border-0 outline-none bg-transparent text-[14px] text-slate-900 placeholder:text-slate-400 px-2 py-2.5 resize-none leading-snug max-h-[200px] min-h-[24px]"
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
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.tsv,.xlsx,.xls,.pdf,image/*"
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />

          <div className="text-center text-[11px] text-slate-400 mt-2.5">
            AI-powered · regulatory sources worldwide · Not medical advice
          </div>
        </div>
      </div>
        </>
      ) : null}
    </main>
  );
}
