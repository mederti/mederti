"use client";

import { useEffect, useState } from "react";
import { Close, ChatBubble, ExternalLink } from "./icons";

export interface ArticlePreviewItem {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  read_time: string;
  tag: string;
  tag_tone: "high" | "regulatory" | "seasonal" | "neutral";
}

interface ArticleFull extends ArticlePreviewItem {
  paragraphs?: string[];
  related_country_codes?: string[];
}

const TAG_CLASS: Record<ArticlePreviewItem["tag_tone"], string> = {
  high:       "text-red-700 bg-red-50 border-red-200",
  regulatory: "text-indigo-700 bg-indigo-50 border-indigo-200",
  seasonal:   "text-amber-700 bg-amber-50 border-amber-200",
  neutral:    "text-slate-600 bg-slate-50 border-slate-200",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ArticlePreviewPane({
  article,
  onClose,
  onAsk,
}: {
  article: ArticlePreviewItem;
  onClose: () => void;
  onAsk: (q: string) => void;
}) {
  const [full, setFull] = useState<ArticleFull | null>(null);

  useEffect(() => {
    // Try to fetch the full article body. Falls back to summary-only if the
    // endpoint isn't implemented or the article is a static fallback row.
    let cancelled = false;
    fetch(`/api/intelligence/article/${encodeURIComponent(article.slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setFull({ ...article, paragraphs: j.paragraphs, related_country_codes: j.related_country_codes });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [article.slug, article]);

  const paragraphs = full?.paragraphs ?? [article.summary];

  return (
    <>
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="3xl:hidden fixed inset-0 z-20 bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in duration-150"
      />
      <aside
        className="w-full max-w-[560px] 3xl:max-w-[560px] fixed 3xl:static right-0 top-0 bottom-0 z-30 bg-white border-l border-slate-200 flex flex-col shadow-xl 3xl:shadow-none animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Intelligence article
          </div>
          <div className="flex items-center gap-1">
            <a
              href={`/intelligence/${article.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100"
              title="Open full page"
            >
              <ExternalLink size={12} />
              Full page
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <Close size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {article.category}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium ${TAG_CLASS[article.tag_tone] ?? TAG_CLASS.neutral}`}
            >
              {article.tag}
            </span>
          </div>

          <h2 className="text-[20px] font-semibold text-slate-900 leading-tight tracking-tight mb-2">
            {article.title}
          </h2>

          <div className="text-[12px] text-slate-400 mb-5">
            {formatDate(article.date)} · {article.read_time}
          </div>

          <div className="flex flex-col gap-3.5">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-[14px] text-slate-700 leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3 shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAsk(`Tell me more about: ${article.title}`)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 px-3 py-2 rounded-lg transition-colors"
          >
            <ChatBubble size={13} />
            Ask Mederti about this
          </button>
        </div>
      </aside>
    </>
  );
}
