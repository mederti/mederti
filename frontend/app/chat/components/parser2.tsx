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

import { useContext, type ReactNode } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";
import { DrugCard } from "@/app/chat/components/DrugCard";
import { PaneContext } from "@/app/chat/components/PaneContext";

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

// Inline button wrapping a bold drug name that opens the preview pane on
// click. Falls back to a plain <strong> when the name doesn't resolve to a
// known drug_id (most bold spans aren't drugs — class names, severities, etc.).
function DrugLink({ id, label }: { id: string; label: string }) {
  const pane = useContext(PaneContext);
  if (!pane) {
    return <strong className="font-semibold text-slate-900">{label}</strong>;
  }
  return (
    <button
      type="button"
      onClick={() => pane.open(id)}
      className="font-semibold text-slate-900 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-teal-700 hover:decoration-teal-500 transition-colors"
    >
      {label}
    </button>
  );
}

function renderInline(
  text: string,
  drugIdByName?: Record<string, string>
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const label = m[1];
    const trimmed = label.trim();
    const id = drugIdByName?.[trimmed];
    if (id) {
      out.push(<DrugLink key={`b${m.index}`} id={id} label={label} />);
    } else {
      out.push(
        <strong key={`b${m.index}`} className="font-semibold text-slate-900">
          {label}
        </strong>
      );
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

const splitRow = (row: string): string[] => {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|")) r = r.slice(0, -1);
  return r.split("|").map((c) => c.trim());
};

const SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const ROW_RE = /^\s*\|?[^|]*(\|[^|]*){2,}\|?\s*$/;

function parseTableBlock(
  lines: string[]
): { header: string[]; rows: string[][] } | null {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return null;
  if (!nonEmpty.every((l) => l.includes("|"))) return null;

  // Mode A — proper GFM table (header + separator + rows).
  if (SEPARATOR_RE.test(nonEmpty[1])) {
    const header = splitRow(nonEmpty[0]);
    const rows = nonEmpty.slice(2).map(splitRow);
    if (rows.length === 0) return null;
    return { header, rows };
  }

  // Mode B — headerless data block. Happens when the model splits a long
  // table across paragraphs and the continuation block has no separator. We
  // render it as a table with the column count inferred from the first row.
  // Guard: every line must look like a row (≥3 cells once split), otherwise
  // we'd swallow legit prose that happens to contain a pipe.
  if (nonEmpty.length >= 1 && nonEmpty.every((l) => ROW_RE.test(l))) {
    const rows = nonEmpty.map(splitRow);
    const cols = rows[0].length;
    if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
    return { header: [], rows };
  }
  return null;
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
  // Headerless tables come from the "Mode B" continuation case in
  // parseTableBlock — model split a long table across paragraphs. We skip
  // the <thead> entirely; the body stands on its own.
  const showHeader = header.length > 0;
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-[13px] text-left">
        {showHeader ? (
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
        ) : null}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-slate-700 align-top">
                  {renderInline(cell, drugIdByName)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({
  text,
  drugIdByName,
}: {
  text: string;
  drugIdByName?: Record<string, string>;
}) {
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
          return (
            <TableBlock
              key={i}
              header={table.header}
              rows={table.rows}
              drugIdByName={drugIdByName}
            />
          );
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
  /** Map of **bold subject** → drug_id, resolved async after the response
   *  arrives. Bold names matching an entry render as clickable buttons that
   *  open the preview pane. Names not in the map render as plain <strong>. */
  drugIdByName?: Record<string, string>;
  onFollowup: (q: string) => void;
};

export function RenderedResponse({
  parts,
  drugs,
  subs,
  drugIdByName,
  onFollowup,
}: Props): ReactNode {
  const out: ReactNode[] = [];

  parts.forEach((p, i) => {
    if (p.kind === "drug") {
      const d = drugs[p.id];
      if (!d) {
        out.push(
          <div key={i} className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 my-2">
            Missing drug data for <code>{p.id}</code>.
          </div>
        );
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
