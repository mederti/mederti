"use client";

/*
 * Parses the AI agent response stream — same tag vocabulary as /chat's
 * parser.tsx. Renders the full rich <DrugCard> from /chat/components for
 * info density; the right preview pane is the *secondary* surface that
 * single-drug responses auto-open into.
 *
 * NOTE — currently importing DrugCard directly from /chat to avoid a 1.5k
 * line copy-paste while we're still iterating on chat2. When chat2 is
 * promoted to replace /chat we fork the cards and delete the old route;
 * if chat2 stays parallel long-term, this is the file to clone first.
 */

import { useContext, useEffect, useState, type ReactNode } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { DrugCard } from "@/app/chat/components/DrugCard";
import { PaneContext } from "@/app/chat/components/PaneContext";

// Lazy fallback: when a <drug_card> tag references a UUID not yet in
// drugsMap (mid-stream flash, or a chat turn persisted before the
// server populated `done.drugs`), fetch the drug from /api/drug/[id]
// instead of showing a red "Missing drug data" error. Falls back to
// the error only after the fetch actually fails or returns 404.
function LazyDrugCard({ id }: { id: string }) {
  const [drug, setDrug] = useState<DrugDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/drug/${id}?country=AU`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((bundle) => {
        if (cancelled) return;
        if (bundle?.drug) setDrug(bundle.drug as DrugDetail);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (drug) return <DrugCard drug={drug} />;
  if (failed) {
    return (
      <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 my-2">
        Missing drug data for <code>{id}</code>.
      </div>
    );
  }
  return (
    <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 animate-pulse">
      <div className="h-4 w-32 bg-slate-200 rounded mb-2" />
      <div className="h-3 w-48 bg-slate-200 rounded" />
    </div>
  );
}

export type KpiTile = { value: string; label: string };
export type SourceChip = {
  code: string;
  country: string;
  rows?: number;
  freshness?: string;
  url?: string;
};

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "drug"; id: string }
  | { kind: "sub"; id: string; match: string }
  | { kind: "followups"; items: string[] }
  | { kind: "alternates"; items: Array<{ id: string; name: string }> }
  | { kind: "kpis"; items: KpiTile[] }
  | { kind: "sources"; items: SourceChip[] };

const DRUG_TAG_RE = /<drug_card\s+([^>]+?)\/>/g;
const SUB_TAG_RE = /<sub_card\s+id="([^"]+)"(?:\s+match="([^"]+)")?\s*\/>/g;
const FOLLOWUP_RE = /<followups>([\s\S]*?)<\/followups>/g;
// Tolerant fallback for unclosed trailing tags (model truncation or sloppy output).
const FOLLOWUP_UNCLOSED_RE = /<followups>([\s\S]*?)$/g;
const ALTERNATES_RE = /<alternates>([\s\S]*?)<\/alternates>/g;
const ALTERNATES_UNCLOSED_RE = /<alternates>([\s\S]*?)$/g;
const KPIS_RE = /<kpis>([\s\S]*?)<\/kpis>/g;
const KPIS_UNCLOSED_RE = /<kpis>([\s\S]*?)$/g;
const SOURCES_RE = /<sources>([\s\S]*?)<\/sources>/g;
const SOURCES_UNCLOSED_RE = /<sources>([\s\S]*?)$/g;

function parseSourcesBody(inner: string): SourceChip[] {
  return inner
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): SourceChip | null => {
      const httpAt = s.search(/\bhttps?:\/\//);
      const head = httpAt === -1 ? s : s.slice(0, httpAt).replace(/:\s*$/, "");
      const url = httpAt === -1 ? undefined : s.slice(httpAt).trim();
      const parts = head.split(":").map((x) => x.trim());
      const [code, country, rowsRaw, freshness] = parts;
      if (!code || !country) return null;
      const rows = rowsRaw && /^\d+$/.test(rowsRaw) ? parseInt(rowsRaw, 10) : undefined;
      return { code, country, rows, freshness: freshness || undefined, url };
    })
    .filter((x): x is SourceChip => x !== null);
}

function parseKpiBody(inner: string): KpiTile[] {
  return inner
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf(":");
      if (idx === -1) return null;
      const value = s.slice(0, idx).trim();
      const label = s.slice(idx + 1).trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter((x): x is KpiTile => x !== null);
}

function extractAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m ? m[1] : undefined;
}

type Hit = { kind: "drug" | "sub" | "followup" | "alternates" | "kpis" | "sources"; index: number; length: number; data: any };

export function parseAgentResponse(raw: string): ParsedPart[] {
  const hits: Hit[] = [];

  DRUG_TAG_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = DRUG_TAG_RE.exec(raw)) !== null; ) {
    const id = extractAttr(m[1], "id");
    if (!id) continue;
    hits.push({ kind: "drug", index: m.index, length: m[0].length, data: { id } });
  }
  SUB_TAG_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = SUB_TAG_RE.exec(raw)) !== null; ) {
    hits.push({ kind: "sub", index: m.index, length: m[0].length, data: { id: m[1], match: m[2] || "" } });
  }
  FOLLOWUP_RE.lastIndex = 0;
  const closedFollowupRanges: Array<[number, number]> = [];
  for (let m: RegExpExecArray | null; (m = FOLLOWUP_RE.exec(raw)) !== null; ) {
    const items = m[1].split("|").map((s) => s.trim()).filter(Boolean);
    hits.push({ kind: "followup", index: m.index, length: m[0].length, data: { items } });
    closedFollowupRanges.push([m.index, m.index + m[0].length]);
  }
  FOLLOWUP_UNCLOSED_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = FOLLOWUP_UNCLOSED_RE.exec(raw)) !== null; ) {
    const overlaps = closedFollowupRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (overlaps) continue;
    const inner = m[1].replace(/<\/?followups>?$/, "");
    const items = inner.split("|").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) continue;
    hits.push({ kind: "followup", index: m.index, length: m[0].length, data: { items } });
  }
  ALTERNATES_RE.lastIndex = 0;
  const closedAlternatesRanges: Array<[number, number]> = [];
  for (let m: RegExpExecArray | null; (m = ALTERNATES_RE.exec(raw)) !== null; ) {
    const items = m[1]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const idx = s.indexOf(":");
        if (idx === -1) return null;
        const id = s.slice(0, idx).trim();
        const name = s.slice(idx + 1).trim();
        if (!/^[0-9a-f-]{36}$/i.test(id) || !name) return null;
        return { id, name };
      })
      .filter((x): x is { id: string; name: string } => x !== null);
    hits.push({ kind: "alternates", index: m.index, length: m[0].length, data: { items } });
    closedAlternatesRanges.push([m.index, m.index + m[0].length]);
  }
  ALTERNATES_UNCLOSED_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = ALTERNATES_UNCLOSED_RE.exec(raw)) !== null; ) {
    const overlaps = closedAlternatesRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (overlaps) continue;
    const inner = m[1].replace(/<\/?alternates>?$/, "");
    const items = inner
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const idx = s.indexOf(":");
        if (idx === -1) return null;
        const id = s.slice(0, idx).trim();
        const name = s.slice(idx + 1).trim();
        if (!/^[0-9a-f-]{36}$/i.test(id) || !name) return null;
        return { id, name };
      })
      .filter((x): x is { id: string; name: string } => x !== null);
    if (items.length === 0) continue;
    hits.push({ kind: "alternates", index: m.index, length: m[0].length, data: { items } });
  }
  // KPI grid (closed + unclosed-trailing fallback).
  KPIS_RE.lastIndex = 0;
  const closedKpisRanges: Array<[number, number]> = [];
  for (let m: RegExpExecArray | null; (m = KPIS_RE.exec(raw)) !== null; ) {
    const items = parseKpiBody(m[1]);
    if (items.length === 0) continue;
    hits.push({ kind: "kpis", index: m.index, length: m[0].length, data: { items } });
    closedKpisRanges.push([m.index, m.index + m[0].length]);
  }
  KPIS_UNCLOSED_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = KPIS_UNCLOSED_RE.exec(raw)) !== null; ) {
    const overlaps = closedKpisRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (overlaps) continue;
    const inner = m[1].replace(/<\/?kpis>?$/, "");
    const items = parseKpiBody(inner);
    if (items.length === 0) continue;
    hits.push({ kind: "kpis", index: m.index, length: m[0].length, data: { items } });
  }
  // <sources>...</sources> regulator chips
  SOURCES_RE.lastIndex = 0;
  const closedSourcesRanges: Array<[number, number]> = [];
  for (let m: RegExpExecArray | null; (m = SOURCES_RE.exec(raw)) !== null; ) {
    const items = parseSourcesBody(m[1]);
    if (items.length === 0) continue;
    hits.push({ kind: "sources", index: m.index, length: m[0].length, data: { items } });
    closedSourcesRanges.push([m.index, m.index + m[0].length]);
  }
  SOURCES_UNCLOSED_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = SOURCES_UNCLOSED_RE.exec(raw)) !== null; ) {
    const overlaps = closedSourcesRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (overlaps) continue;
    const inner = m[1].replace(/<\/?sources>?$/, "");
    const items = parseSourcesBody(inner);
    if (items.length === 0) continue;
    hits.push({ kind: "sources", index: m.index, length: m[0].length, data: { items } });
  }
  hits.sort((a, b) => a.index - b.index);

  const parts: ParsedPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.index > cursor) parts.push({ kind: "text", text: raw.slice(cursor, h.index) });
    if (h.kind === "drug") parts.push({ kind: "drug", id: h.data.id });
    else if (h.kind === "sub") parts.push({ kind: "sub", id: h.data.id, match: h.data.match });
    else if (h.kind === "alternates") parts.push({ kind: "alternates", items: h.data.items });
    else if (h.kind === "kpis") parts.push({ kind: "kpis", items: h.data.items });
    else if (h.kind === "sources") parts.push({ kind: "sources", items: h.data.items });
    else parts.push({ kind: "followups", items: h.data.items });
    cursor = h.index + h.length;
  }
  if (cursor < raw.length) parts.push({ kind: "text", text: raw.slice(cursor) });
  return parts;
}

/**
 * Scan a raw chat-response string for drug-name candidates worth resolving
 * server-side. Pulls (a) every **bolded** token and (b) the cells of every
 * markdown table — those are the surfaces the renderer will turn into
 * clickable preview-pane links if the candidate maps to a real drug.
 *
 * Heuristic filters keep the list small + sensible: 2–80 chars, contains a
 * letter, and skips known non-drug header words ("Drug", "ATC match", etc.)
 * so we don't waste round-trips. Final dedup happens after lowercasing.
 */
export function collectDrugCandidates(raw: string): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  const accept = (name: string) => {
    const t = name.trim();
    if (t.length < 2 || t.length > 80) return;
    if (!/[a-z]/i.test(t)) return;
    // Reject text that's mostly punctuation or contains markdown noise.
    if (/[<>{}|]/.test(t)) return;
    out.add(t);
  };

  // (a) Bolded tokens — `**foo**`.
  const boldRe = /\*\*([^*\n]{2,80})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(raw)) !== null) accept(m[1]);

  // (b) Markdown table cells — split block-by-block, parse, then push each
  // cell value through the same accept filter. We deliberately push every
  // cell (not just the first column) because layouts vary — the resolver
  // will reject the ones that aren't drugs.
  const blocks = raw.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const table = parseTableBlock(lines);
    if (!table) continue;
    for (const row of table.rows) {
      for (const cell of row) {
        // Strip surrounding bold so "**Amoxicillin**" → "Amoxicillin".
        const stripped = cell.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
        accept(stripped);
      }
    }
  }

  return Array.from(out);
}

export function Chat2SubRow({
  sub,
  onAsk,
}: {
  sub: SubstituteRow;
  onAsk: (q: string) => void;
}) {
  // Click → send a new chat turn asking the AI about this alternative.
  // The agent will reply with a full drug card below, matching the existing
  // `<alternates>` chip behaviour. We use the AI path (not the preview pane)
  // so the response lands in the conversation thread as the user asked.
  return (
    <button
      type="button"
      onClick={() => onAsk(`Show me ${sub.name}`)}
      className="group w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 my-2 flex items-center justify-between gap-3.5 text-left hover:bg-teal-50 hover:border-teal-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-slate-900 truncate group-hover:text-teal-700 flex items-center gap-1.5">
          {sub.name}
          <span className="text-slate-300 group-hover:text-teal-600 group-hover:translate-x-0.5 transition-all">→</span>
        </div>
        <div className="text-[12px] text-slate-500 mt-px">
          {sub.atc_code ? `${sub.atc_code} · ` : ""}{sub.drug_class || "Alternative"}
        </div>
      </div>
      {sub.similarity_score != null ? (
        <span
          className="text-[12px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded whitespace-nowrap"
          style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
        >
          {Math.round(sub.similarity_score * 100)}% match
        </span>
      ) : null}
    </button>
  );
}

function lookupDrugId(name: string, map?: Record<string, string>): string | null {
  if (!map) return null;
  const trimmed = name.trim();
  if (map[trimmed]) return map[trimmed];
  const lower = trimmed.toLowerCase();
  for (const k of Object.keys(map)) {
    if (k.toLowerCase() === lower) return map[k];
  }
  return null;
}

function DrugLink({ name, drugId, asCell }: { name: string; drugId: string; asCell?: boolean }) {
  const ctx = useContext(PaneContext);
  // Clear "click to see more" affordance: a persistent dotted underline marks
  // it as a link (not just hover), and a trailing up-right arrow signals it
  // opens the full detail. Tooltip spells it out.
  return (
    <button
      type="button"
      className={
        "group/dl font-medium text-teal-700 hover:text-teal-800 underline decoration-dotted decoration-teal-400/70 hover:decoration-solid underline-offset-2 cursor-pointer inline-flex items-baseline gap-0.5" +
        (asCell ? " text-left" : "")
      }
      onClick={() => ctx?.open(drugId)}
      title={`Open ${name} — see full detail`}
    >
      {name}
      <svg
        viewBox="0 0 24 24"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="self-center text-teal-500 opacity-70 group-hover/dl:opacity-100"
        aria-hidden="true"
      >
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </button>
  );
}

function renderInline(text: string, drugIdByName?: Record<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const inner = m[1];
    const drugId = lookupDrugId(inner, drugIdByName);
    if (drugId) {
      out.push(<DrugLink key={`b${m.index}`} name={inner} drugId={drugId} />);
    } else {
      out.push(
        <strong key={`b${m.index}`} className="font-semibold text-slate-900">
          {inner}
        </strong>
      );
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function parseTableBlock(
  lines: string[]
): { header: string[]; rows: string[][] } | null {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return null;
  if (!nonEmpty.every((l) => l.includes("|"))) return null;
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(nonEmpty[1])) return null;

  const splitRow = (row: string): string[] => {
    let r = row.trim();
    if (r.startsWith("|")) r = r.slice(1);
    if (r.endsWith("|")) r = r.slice(0, -1);
    return r.split("|").map((c) => c.trim());
  };

  const header = splitRow(nonEmpty[0]);
  const rows = nonEmpty.slice(2).map(splitRow);
  if (rows.length === 0) return null;
  return { header, rows };
}

function TableBlock({
  header,
  rows,
  drugIdByName,
}: {
  header: string[];
  rows: string[][];
  drugIdByName?: Record<string, string>;
}) {
  // Treat a cell as a "whole-cell drug link" when its text — stripped of
  // any leading/trailing bold markers — matches a known drug. Catches
  // model output that lists the name without bolding it.
  const cellWholeDrugId = (cell: string): string | null => {
    const stripped = cell.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
    if (!stripped) return null;
    return lookupDrugId(stripped, drugIdByName);
  };

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-[13px] text-left">
        <thead className="bg-slate-50">
          <tr>
            {header.map((h, ci) => (
              <th
                key={ci}
                className="px-3 py-2 font-semibold text-slate-900 border-b border-slate-200 align-bottom"
              >
                {renderInline(h, drugIdByName)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, ci) => {
                const wholeId = cellWholeDrugId(cell);
                const displayName = cell.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
                return (
                  <td key={ci} className="px-3 py-2 text-slate-700 align-top">
                    {wholeId ? (
                      <DrugLink name={displayName} drugId={wholeId} asCell />
                    ) : (
                      renderInline(cell, drugIdByName)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({ text, drugIdByName }: { text: string; drugIdByName?: Record<string, string> }) {
  // Split paragraphs, support h1/h2/hr/tables — same vocab as /chat.
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="text-[14px] leading-[1.65] text-slate-700">
      {blocks.map((p, i) => {
        const t = p.trim();
        if (!t) return null;
        const lines = p.split("\n");
        const table = parseTableBlock(lines);
        if (table) {
          return <TableBlock key={i} header={table.header} rows={table.rows} drugIdByName={drugIdByName} />;
        }
        if (t.startsWith("# ")) {
          return (
            <h1 key={i} className="text-[18px] font-semibold text-slate-900 mt-5 mb-3 tracking-tight">
              {renderInline(t.slice(2), drugIdByName)}
            </h1>
          );
        }
        if (t.startsWith("## ")) {
          return (
            <h2 key={i} className="text-[15px] font-semibold text-slate-900 mt-4 mb-2">
              {renderInline(t.slice(3), drugIdByName)}
            </h2>
          );
        }
        if (t === "---") {
          return <hr key={i} className="border-t border-slate-200 my-4" />;
        }
        return (
          <p key={i} className="mb-3.5">
            {renderInline(t, drugIdByName)}
          </p>
        );
      })}
    </div>
  );
}

type Props = {
  parts: ParsedPart[];
  drugs: Record<string, DrugDetail>;
  subs: Record<string, SubstituteRow>;
  onFollowup: (q: string) => void;
  /** Name → drug_id map built post-stream by /api/resolve-drug-names. Lets
   *  bolded names + first-column table cells become clickable, opening the
   *  preview pane. Undefined while resolution is in flight. */
  drugIdByName?: Record<string, string>;
};

export function RenderedResponse({ parts, drugs, subs, onFollowup, drugIdByName }: Props): ReactNode {
  const out: ReactNode[] = [];

  parts.forEach((p, i) => {
    if (p.kind === "drug") {
      const d = drugs[p.id];
      if (!d) {
        // Mid-stream or stale-localStorage case — fetch the drug on
        // the client instead of showing the alarming red error.
        out.push(<LazyDrugCard key={i} id={p.id} />);
      } else {
        // Full rich card (PharmacistCard / ProcurementCard / SupplierCard)
        // — clicking the drug name inside still opens the right preview pane
        // via the shared PaneContext provided by Chat2Client.
        out.push(<DrugCard key={i} drug={d} />);
      }
      return;
    }
    if (p.kind === "text") {
      if (p.text.trim()) out.push(<TextBlock key={i} text={p.text} drugIdByName={drugIdByName} />);
    } else if (p.kind === "sub") {
      const s = subs[p.id];
      if (s) out.push(<Chat2SubRow key={i} sub={s} onAsk={onFollowup} />);
    } else if (p.kind === "followups") {
      out.push(
        <div key={i} className="flex flex-wrap gap-2 mt-3.5">
          {p.items.map((q, k) => (
            <button
              key={k}
              type="button"
              onClick={() => onFollowup(q)}
              className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-[13px] text-slate-700 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      );
    } else if (p.kind === "kpis" && p.items.length > 0) {
      const cols = Math.min(p.items.length, 4);
      out.push(
        <div
          key={i}
          className="grid gap-3 mb-4 mt-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {p.items.map((tile, k) => (
            <div
              key={k}
              className="bg-slate-50 border border-slate-200 rounded-lg p-3.5"
            >
              <div className="text-[24px] font-semibold text-slate-900 leading-tight tracking-tight">
                {tile.value}
              </div>
              <div className="text-[12px] text-slate-500 mt-1.5 leading-snug">
                {tile.label}
              </div>
            </div>
          ))}
        </div>
      );
    } else if (p.kind === "sources" && p.items.length > 0) {
      const isStale = (c: { freshness?: string }) => {
        if (!c.freshness) return false;
        const f = c.freshness.toLowerCase();
        return f.includes("stale") || f.includes("unknown") || f.startsWith("latest event");
      };
      const staleCount = p.items.filter(isStale).length;
      out.push(
        <div key={i} className="mt-4 border-t border-slate-200 pt-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500" aria-hidden />
            Verified across {p.items.length} regulator{p.items.length === 1 ? "" : "s"}
            {staleCount > 0 ? (
              <span className="normal-case tracking-normal text-amber-700 font-semibold ml-1">
                · {staleCount} stale
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {p.items.map((c, k) => {
              const stale = isStale(c);
              const inner = (
                <>
                  <span className={stale ? "font-semibold text-amber-800" : "font-semibold text-slate-800"}>{c.code}</span>
                  <span className="text-slate-400">{c.country}</span>
                  {c.rows != null ? (
                    <span className="text-slate-500">· {c.rows.toLocaleString()} rows</span>
                  ) : null}
                  {c.freshness ? (
                    <span className={stale ? "text-amber-700" : "text-slate-500"}>· {c.freshness}</span>
                  ) : null}
                </>
              );
              const base = "inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors";
              const cls = stale
                ? `${base} bg-amber-50 border border-amber-200 ${c.url ? "hover:bg-amber-100 hover:border-amber-300" : ""}`
                : `${base} bg-white border border-slate-200 ${c.url ? "hover:border-teal-300 hover:bg-teal-50" : ""}`;
              return c.url ? (
                <a
                  key={k}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cls}
                  title={`Open ${c.code} (${c.country}) at source`}
                >
                  {inner}
                </a>
              ) : (
                <span key={k} className={cls}>{inner}</span>
              );
            })}
          </div>
        </div>
      );
    } else if (p.kind === "alternates" && p.items.length > 0) {
      out.push(
        <div key={i} className="flex flex-wrap gap-2 mt-3 items-center text-[12px] text-slate-500">
          <span>Also matched —</span>
          {p.items.map((alt) => (
            <button
              key={alt.id}
              type="button"
              onClick={() => onFollowup(`Show me ${alt.name} instead`)}
              className="bg-white border border-slate-200 rounded-full px-2.5 py-1 hover:border-teal-200 hover:text-teal-700"
            >
              {alt.name}
            </button>
          ))}
        </div>
      );
    }
  });

  return <>{out}</>;
}
