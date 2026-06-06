"use client";

import type { ArticlePreviewItem } from "./ArticlePreviewPane";
import { ChevronLeft, ExternalLink } from "./icons";

export interface ArticleSection {
  heading?: string;
  body: string;
}

// Full article payload from /api/intelligence/article/[slug]. A superset of
// the card metadata, with the structured body + flattened grounding text.
export interface ArticleFull extends ArticlePreviewItem {
  author?: string | null;
  pull_quote?: string | null;
  sections: ArticleSection[];
  paragraphs: string[];
  body_text: string;
  drug_id?: string | null;
  drug_name?: string | null;
}

const TAG_CLASS: Record<ArticlePreviewItem["tag_tone"], string> = {
  high: "text-red-700 bg-red-50 border-red-200",
  regulatory: "text-indigo-700 bg-indigo-50 border-indigo-200",
  seasonal: "text-amber-700 bg-amber-50 border-amber-200",
  neutral: "text-slate-600 bg-slate-50 border-slate-200",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Split a section body into display paragraphs on blank lines.
function paras(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * The middle reading column. Shows the full article body; the side chat
 * (ArticleChat) is grounded in the same content. `full` arrives async — until
 * it does we render the card header + summary so there's no blank flash.
 */
export function ArticleReader({
  article,
  full,
  loading,
  onClose,
}: {
  article: ArticlePreviewItem;
  full: ArticleFull | null;
  loading: boolean;
  onClose: () => void;
}) {
  const title = full?.title ?? article.title;
  const category = full?.category ?? article.category;
  const tag = full?.tag ?? article.tag;
  const tagTone = full?.tag_tone ?? article.tag_tone;
  const date = full?.date ?? article.date;
  const readTime = full?.read_time ?? article.read_time;
  const author = full?.author ?? null;

  // Body: real sections once loaded, else the card summary as a single block.
  const sections: ArticleSection[] =
    full && full.sections.length > 0
      ? full.sections
      : article.summary
      ? [{ body: article.summary }]
      : [];

  // Nothing to render (deep-link to a slug with no DB body) once the fetch has
  // settled — show a graceful note rather than a blank column.
  const noBody = !loading && sections.length === 0;

  return (
    <main className="flex-1 min-w-0 flex flex-col h-screen bg-white">
      {/* Header bar — back to the Intelligence list + open full page */}
      <div className="h-14 flex items-center px-6 gap-3 shrink-0 border-b border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 px-2 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft size={14} />
          Intelligence
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mx-1">
          Reading
        </span>
        <a
          href={`/intelligence/${article.slug}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100"
          title="Open full page in a new tab"
        >
          <ExternalLink size={12} />
          Full page
        </a>
      </div>

      <div className="flex-1 overflow-y-auto">
        <article className="max-w-[680px] mx-auto px-8 pt-8 pb-16">
          {/* Eyebrow: category + tag */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {category}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium ${TAG_CLASS[tagTone] ?? TAG_CLASS.neutral}`}
            >
              {tag}
            </span>
          </div>

          <h1 className="text-[30px] font-semibold text-slate-900 leading-[1.15] tracking-tight mb-3">
            {title}
          </h1>

          <div className="text-[12.5px] text-slate-400 mb-7 flex items-center gap-2 flex-wrap">
            {author ? (
              <>
                <span className="text-slate-500 font-medium">{author}</span>
                <span>·</span>
              </>
            ) : null}
            <span>{formatDate(date)}</span>
            {readTime ? (
              <>
                <span>·</span>
                <span>{readTime}</span>
              </>
            ) : null}
          </div>

          {full?.pull_quote ? (
            <blockquote className="border-l-[3px] border-teal-400 pl-5 my-7">
              <p className="text-[19px] font-medium italic leading-snug text-slate-900">
                &ldquo;{full.pull_quote}&rdquo;
              </p>
            </blockquote>
          ) : null}

          <div className="flex flex-col gap-5">
            {sections.map((s, i) => (
              <section key={i}>
                {s.heading ? (
                  <h2 className="text-[19px] font-semibold text-slate-900 tracking-tight mt-4 mb-3 leading-snug">
                    {s.heading}
                  </h2>
                ) : null}
                <div className="flex flex-col gap-3.5">
                  {paras(s.body).map((p, j) => (
                    <p key={j} className="text-[15px] text-slate-700 leading-[1.7]">
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {loading && !full ? (
            <div className="mt-6 text-[13px] text-slate-400">Loading the full article…</div>
          ) : null}

          {noBody ? (
            <div className="mt-2 text-[14px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5">
              The full text of this article isn&apos;t available here yet. You can still ask the assistant
              about it on the right, or{" "}
              <a
                href={`/intelligence/${article.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-teal-700 underline underline-offset-2"
              >
                open the full page
              </a>
              .
            </div>
          ) : null}
        </article>
      </div>
    </main>
  );
}
