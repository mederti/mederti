"use client";

import type { ReactNode } from "react";
import type { DrugDetail, Persona, SubstituteRow } from "@/lib/chat/types";
import { DrugCard } from "./DrugCard";
import { SubCard } from "./SubCard";

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "drug"; id: string; persona?: Persona }
  | { kind: "sub"; id: string; match: string }
  | { kind: "followups"; items: string[] }
  | { kind: "alternates"; items: Array<{ id: string; name: string }> };

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

function extractAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function normalisePersona(v?: string): Persona | undefined {
  if (v === "pharmacist" || v === "procurement" || v === "supplier") return v;
  return undefined;
}

type Hit = { kind: "drug" | "sub" | "followup" | "alternates"; index: number; length: number; data: any };

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
  hits.sort((a, b) => a.index - b.index);

  const parts: ParsedPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.index > cursor) parts.push({ kind: "text", text: raw.slice(cursor, h.index) });
    if (h.kind === "drug") parts.push({ kind: "drug", id: h.data.id, persona: h.data.persona });
    else if (h.kind === "sub") parts.push({ kind: "sub", id: h.data.id, match: h.data.match });
    else if (h.kind === "alternates") parts.push({ kind: "alternates", items: h.data.items });
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
};

export function RenderedResponse({ parts, drugs, subs, onFollowup }: Props): ReactNode {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") {
          const trimmed = p.text.trim();
          if (!trimmed) return null;
          return <TextBlock key={i} text={trimmed} />;
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
        return null;
      })}
    </>
  );
}

function TextBlock({ text }: { text: string }) {
  // Render paragraphs separated by blank lines; inline **bold** support.
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="msg-bubble-assistant">
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p)}</p>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    out.push(<strong key={`b${m.index}`}>{m[1]}</strong>);
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
