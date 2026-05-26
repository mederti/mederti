"use client";

import { useContext, type ReactNode } from "react";
import type { DrugDetail, Persona, SubstituteRow } from "@/lib/chat/types";
import { DrugCard } from "./DrugCard";
import { SubCard } from "./SubCard";
import { PaneContext } from "./PaneContext";

export type KpiTile = { value: string; label: string };

/** One regulator chip in the SourceTrail. `freshness` is a free-form display
 *  string ("scraped today", "scraped 3d ago — stale", "latest event 6d ago",
 *  "freshness unknown") emitted by the model from the tool's pre-computed
 *  freshness_label — model never composes its own freshness string.
 *  A trailing "stale" segment (after "—") flips the chip into the stale
 *  visual variant — so the renderer doesn't need separate plumbing. */
export type SourceChip = {
  code: string;
  country: string;
  rows?: number;
  freshness?: string;
  url?: string;
};

function chipIsStale(c: { freshness?: string }): boolean {
  if (!c.freshness) return false;
  const f = c.freshness.toLowerCase();
  return f.includes("stale") || f.includes("unknown") || f.startsWith("latest event");
}

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "drug"; id: string; persona?: Persona }
  | { kind: "sub"; id: string; match: string }
  | { kind: "followups"; items: string[] }
  | { kind: "alternates"; items: Array<{ id: string; name: string }> }
  | { kind: "kpis"; items: KpiTile[] }
  | { kind: "sources"; items: SourceChip[] };

// Match <drug_card id="..." /> with optional persona="..." (any attribute order).
const DRUG_TAG_RE = /<drug_card\s+([^>]+?)\/>/g;
const SUB_TAG_RE = /<sub_card\s+id="([^"]+)"(?:\s+match="([^"]+)")?\s*\/>/g;
const FOLLOWUP_RE = /<followups>([\s\S]*?)<\/followups>/g;
// Tolerant fallback: model sometimes omits the closing tag (truncation, sloppy output).
// Anchor to end-of-string so we only consume an unclosed trailing block, never mid-message.
const FOLLOWUP_UNCLOSED_RE = /<followups>([\s\S]*?)$/g;
// <alternates>uuid:Name|uuid:Name</alternates> — disambiguation chips when search returned >1 plausible match.
const ALTERNATES_RE = /<alternates>([\s\S]*?)<\/alternates>/g;
const ALTERNATES_UNCLOSED_RE = /<alternates>([\s\S]*?)$/g;
// <kpis>value:label|value:label|...</kpis> — visual KPI tile grid for Mode C
// landscape headers. Lead with 3–4 of the most important numbers the user
// asked about — "91 active shortages", "11 countries", etc.
const KPIS_RE = /<kpis>([\s\S]*?)<\/kpis>/g;
const KPIS_UNCLOSED_RE = /<kpis>([\s\S]*?)$/g;
// <sources>CODE:COUNTRY:rows:freshness:url|...</sources> — regulator chips
// proving Mederti pulled from authoritative feeds, not generic web search.
// Each field after CODE:COUNTRY is optional; first colon splits code from
// country, the rest splits on ':' positionally.
const SOURCES_RE = /<sources>([\s\S]*?)<\/sources>/g;
const SOURCES_UNCLOSED_RE = /<sources>([\s\S]*?)$/g;

function extractAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function normalisePersona(v?: string): Persona | undefined {
  if (v === "pharmacist" || v === "procurement" || v === "supplier") return v;
  return undefined;
}

type Hit = { kind: "drug" | "sub" | "followup" | "alternates" | "kpis" | "sources"; index: number; length: number; data: any };

function parseSourcesBody(inner: string): SourceChip[] {
  return inner
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): SourceChip | null => {
      // Format: CODE:COUNTRY[:rows[:freshness[:url]]]
      // We split max 5 parts but the URL may contain colons (https://), so the
      // URL is anchored to the FIRST occurrence of "http" and everything from
      // there is the URL.
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

export function parseAgentResponse(raw: string): ParsedPart[] {
  const hits: Hit[] = [];

  DRUG_TAG_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = DRUG_TAG_RE.exec(raw)) !== null; ) {
    const attrs = m[1];
    const id = extractAttr(attrs, "id");
    if (!id) continue;
    const persona = normalisePersona(extractAttr(attrs, "persona"));
    hits.push({ kind: "drug", index: m.index, length: m[0].length, data: { id, persona } });
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
  // Catch an unclosed trailing <followups>... — only if it doesn't overlap a closed match.
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
    hits.push({ kind: "alternates" as any, index: m.index, length: m[0].length, data: { items } });
    closedAlternatesRanges.push([m.index, m.index + m[0].length]);
  }
  // Tolerant fallback for unclosed <alternates>...
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
    hits.push({ kind: "alternates" as any, index: m.index, length: m[0].length, data: { items } });
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
  // <sources>...</sources> regulator provenance chips
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
    if (h.kind === "drug") parts.push({ kind: "drug", id: h.data.id, persona: h.data.persona });
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

type Props = {
  parts: ParsedPart[];
  drugs: Record<string, DrugDetail>;
  subs: Record<string, SubstituteRow>;
  onFollowup: (q: string) => void;
  /** Map of drug name (as it appears in prose / tables) → drug_id, used to
   *  make bolded drug names clickable. Built post-stream from /api/search. */
  drugIdByName?: Record<string, string>;
};

export function RenderedResponse({ parts, drugs, subs, onFollowup, drugIdByName }: Props): ReactNode {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") {
          const trimmed = p.text.trim();
          if (!trimmed) return null;
          return <TextBlock key={i} text={trimmed} drugIdByName={drugIdByName} />;
        }
        if (p.kind === "drug") {
          const d = drugs[p.id];
          if (!d) {
            return (
              <div key={i} className="err">
                Missing drug data for id <span className="font-mono">{p.id}</span>.
              </div>
            );
          }
          return <DrugCard key={i} drug={d} personaAttr={p.persona} />;
        }
        if (p.kind === "sub") {
          const s = subs[p.id];
          if (!s) {
            return (
              <div key={i} className="err">
                Missing substitute data for id <span className="font-mono">{p.id}</span>.
              </div>
            );
          }
          return <SubCard key={i} sub={s} matchOverride={p.match} />;
        }
        if (p.kind === "followups") {
          return (
            <div key={i} className="followups">
              {p.items.map((q, k) => (
                <button key={k} type="button" className="followup-chip" onClick={() => onFollowup(q)}>
                  {q}
                </button>
              ))}
            </div>
          );
        }
        if (p.kind === "kpis") {
          if (p.items.length === 0) return null;
          return (
            <div key={i} className={`kpi-grid kpi-grid-${Math.min(p.items.length, 4)}`}>
              {p.items.map((tile, k) => (
                <div key={k} className="kpi-tile">
                  <div className="kpi-value">{tile.value}</div>
                  <div className="kpi-label">{tile.label}</div>
                </div>
              ))}
            </div>
          );
        }
        if (p.kind === "alternates") {
          if (p.items.length === 0) return null;
          return (
            <div key={i} className="alternates">
              <span className="alternates-label">Also matched —</span>
              {p.items.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  className="alternates-chip"
                  onClick={() => onFollowup(`Show me ${alt.name} instead`)}
                  title={alt.id}
                >
                  {alt.name}
                </button>
              ))}
            </div>
          );
        }
        if (p.kind === "sources") {
          if (p.items.length === 0) return null;
          return <SourceTrail key={i} chips={p.items} />;
        }
        return null;
      })}
    </>
  );
}

function TextBlock({ text, drugIdByName }: { text: string; drugIdByName?: Record<string, string> }) {
  // Split into blocks (paragraph or table) separated by blank lines.
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="msg-bubble-assistant">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const table = parseTableBlock(lines);
        if (table) {
          return <TableBlock key={i} header={table.header} rows={table.rows} blockIdx={i} drugIdByName={drugIdByName} />;
        }
        return <p key={i}>{renderInline(block, `b${i}`, drugIdByName)}</p>;
      })}
    </div>
  );
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
  blockIdx,
  drugIdByName,
}: {
  header: string[];
  rows: string[][];
  blockIdx: number;
  drugIdByName?: Record<string, string>;
}) {
  return (
    <div className="msg-table-wrap">
      <table className="msg-table">
        <thead>
          <tr>
            {header.map((h, ci) => (
              <th key={ci}>{renderInline(h, `t${blockIdx}-h${ci}`, drugIdByName)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{renderInline(cell, `t${blockIdx}-r${ri}-c${ci}`, drugIdByName)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceTrail({ chips }: { chips: SourceChip[] }) {
  const freshCount = chips.filter((c) => !chipIsStale(c)).length;
  const staleCount = chips.length - freshCount;
  return (
    <div className="source-trail">
      <div className="source-trail-label">
        <span className="source-trail-dot" aria-hidden />
        Verified across {chips.length} regulator{chips.length === 1 ? "" : "s"}
        {staleCount > 0 ? (
          <span className="source-trail-stale-note">
            {" "}· {staleCount} stale
          </span>
        ) : null}
      </div>
      <div className="source-trail-chips">
        {chips.map((c, i) => {
          const stale = chipIsStale(c);
          const inner = (
            <>
              <span className="source-chip-code">{c.code}</span>
              <span className="source-chip-country">{c.country}</span>
              {c.rows != null ? (
                <span className="source-chip-rows">· {c.rows.toLocaleString()} rows</span>
              ) : null}
              {c.freshness ? (
                <span className={stale ? "source-chip-fresh-stale" : "source-chip-fresh"}>
                  · {c.freshness}
                </span>
              ) : null}
            </>
          );
          const cls = `source-chip${c.url ? " source-chip-link" : ""}${stale ? " source-chip-stale" : ""}`;
          return c.url ? (
            <a
              key={i}
              className={cls}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${c.code} (${c.country}) at source`}
            >
              {inner}
            </a>
          ) : (
            <span key={i} className={cls}>
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function lookupDrugId(name: string, map?: Record<string, string>): string | null {
  if (!map) return null;
  if (map[name]) return map[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(map)) if (k.toLowerCase() === lower) return map[k];
  return null;
}

function DrugLink({ name, drugId }: { name: string; drugId: string }) {
  const ctx = useContext(PaneContext);
  return (
    <button
      type="button"
      className="msg-drug-link"
      onClick={() => ctx?.open(drugId)}
    >
      {name}
    </button>
  );
}

function renderInline(
  text: string,
  keyPrefix: string,
  drugIdByName?: Record<string, string>
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const inner = m[1];
    const drugId = lookupDrugId(inner, drugIdByName);
    if (drugId) {
      out.push(<DrugLink key={`${keyPrefix}-${k++}`} name={inner} drugId={drugId} />);
    } else {
      out.push(<strong key={`${keyPrefix}-${k++}`}>{inner}</strong>);
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
