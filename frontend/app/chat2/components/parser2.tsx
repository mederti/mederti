"use client";

/*
 * Parses the AI agent response stream — same tag vocabulary as /chat's
 * parser.tsx, but the rendering swaps the heavy <DrugCard> for a compact
 * clickable <Chat2DrugRow>. The row, when clicked, opens the preview pane via
 * the ?drug= URL param.
 */

import type { ReactNode } from "react";
import type { DrugDetail, SubstituteRow } from "@/lib/chat/types";

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "drug"; id: string }
  | { kind: "sub"; id: string; match: string }
  | { kind: "followups"; items: string[] }
  | { kind: "alternates"; items: Array<{ id: string; name: string }> };

const DRUG_TAG_RE = /<drug_card\s+([^>]+?)\/>/g;
const SUB_TAG_RE = /<sub_card\s+id="([^"]+)"(?:\s+match="([^"]+)")?\s*\/>/g;
const FOLLOWUP_RE = /<followups>([\s\S]*?)<\/followups>/g;
const ALTERNATES_RE = /<alternates>([\s\S]*?)<\/alternates>/g;

function extractAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m ? m[1] : undefined;
}

type Hit = { kind: "drug" | "sub" | "followup" | "alternates"; index: number; length: number; data: any };

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
  for (let m: RegExpExecArray | null; (m = FOLLOWUP_RE.exec(raw)) !== null; ) {
    const items = m[1].split("|").map((s) => s.trim()).filter(Boolean);
    hits.push({ kind: "followup", index: m.index, length: m[0].length, data: { items } });
  }
  ALTERNATES_RE.lastIndex = 0;
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
  }
  hits.sort((a, b) => a.index - b.index);

  const parts: ParsedPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.index > cursor) parts.push({ kind: "text", text: raw.slice(cursor, h.index) });
    if (h.kind === "drug") parts.push({ kind: "drug", id: h.data.id });
    else if (h.kind === "sub") parts.push({ kind: "sub", id: h.data.id, match: h.data.match });
    else if (h.kind === "alternates") parts.push({ kind: "alternates", items: h.data.items });
    else parts.push({ kind: "followups", items: h.data.items });
    cursor = h.index + h.length;
  }
  if (cursor < raw.length) parts.push({ kind: "text", text: raw.slice(cursor) });
  return parts;
}

function severityForDrug(d: DrugDetail): "critical" | "high" | "medium" | "low" | null {
  const s = (d.worst_severity || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  if (d.active_shortage_count > 0) return "medium";
  return null;
}

function severityPill(sev: ReturnType<typeof severityForDrug>) {
  if (!sev || sev === "low") return null;
  const styles: Record<string, string> = {
    critical: "bg-red-50 text-red-600 border-red-200",
    high: "bg-orange-50 text-orange-600 border-orange-200",
    medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  };
  return (
    <span
      className={`inline-block text-[10px] font-semibold tracking-wider px-1.5 py-px rounded border uppercase ${styles[sev]}`}
    >
      {sev}
    </span>
  );
}

function firstCC(d: DrugDetail): string {
  const cc = d.shortages.find((s) => s.country_code)?.country_code;
  return cc?.toUpperCase() || "—";
}

function latestDate(d: DrugDetail): string {
  // Latest start_date across shortages.
  let latest: string | null = null;
  for (const s of d.shortages) {
    const v = s.start_date;
    if (!v) continue;
    if (!latest || v > latest) latest = v;
  }
  return latest || "";
}

export function Chat2DrugRow({
  drug,
  active,
  onOpen,
}: {
  drug: DrugDetail;
  active: boolean;
  onOpen: (drugId: string) => void;
}) {
  const sev = severityForDrug(drug);
  return (
    <button
      type="button"
      onClick={() => onOpen(drug.drug_id)}
      className={`group w-full grid items-center gap-3 px-2 py-2.5 -mx-2 rounded transition-colors text-left border-b last:border-b-0 ${
        active
          ? "bg-teal-50 border-teal-200"
          : "border-slate-200 hover:bg-slate-50"
      }`}
      style={{ gridTemplateColumns: "40px 1fr auto" }}
    >
      <span
        className="text-[11px] font-medium tracking-wider text-slate-400 uppercase"
        style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
      >
        {firstCC(drug)}
      </span>
      <span className="flex items-center gap-2.5 text-[14px] text-slate-900 font-medium min-w-0">
        <span className="truncate">{drug.name}</span>
        {severityPill(sev)}
      </span>
      <span
        className="text-[11px] text-slate-400"
        style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
      >
        {latestDate(drug)}
      </span>
    </button>
  );
}

export function Chat2SubRow({ sub }: { sub: SubstituteRow }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 my-2 flex items-center justify-between gap-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-slate-900 truncate">{sub.name}</div>
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
    out.push(<strong key={`b${m.index}`} className="font-semibold text-slate-900">{m[1]}</strong>);
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function TextBlock({ text }: { text: string }) {
  // Split paragraphs, support h1/h2/hr — same vocab as /chat.
  const lines = text.split(/\n{2,}/);
  return (
    <div className="text-[14px] leading-[1.65] text-slate-700">
      {lines.map((p, i) => {
        const t = p.trim();
        if (!t) return null;
        if (t.startsWith("# ")) {
          return (
            <h1 key={i} className="text-[18px] font-semibold text-slate-900 mt-5 mb-3 tracking-tight">
              {renderInline(t.slice(2))}
            </h1>
          );
        }
        if (t.startsWith("## ")) {
          return (
            <h2 key={i} className="text-[15px] font-semibold text-slate-900 mt-4 mb-2">
              {renderInline(t.slice(3))}
            </h2>
          );
        }
        if (t === "---") {
          return <hr key={i} className="border-t border-slate-200 my-4" />;
        }
        return (
          <p key={i} className="mb-3.5">
            {renderInline(t)}
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
  activeDrugId: string | null;
  onOpenDrug: (id: string) => void;
  onFollowup: (q: string) => void;
};

export function RenderedResponse({ parts, drugs, subs, activeDrugId, onOpenDrug, onFollowup }: Props): ReactNode {
  // Collapse consecutive drug rows into a single bordered group.
  const out: ReactNode[] = [];
  let drugGroup: { id: string; drug: DrugDetail }[] = [];
  const flush = () => {
    if (drugGroup.length === 0) return;
    out.push(
      <div key={`group-${out.length}`} className="mt-3 mb-3 px-2 -mx-2">
        {drugGroup.map(({ id, drug }) => (
          <Chat2DrugRow key={id} drug={drug} active={id === activeDrugId} onOpen={onOpenDrug} />
        ))}
      </div>
    );
    drugGroup = [];
  };

  parts.forEach((p, i) => {
    if (p.kind === "drug") {
      const d = drugs[p.id];
      if (d) drugGroup.push({ id: p.id, drug: d });
      else {
        flush();
        out.push(
          <div key={i} className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 my-2">
            Missing drug data for <code>{p.id}</code>.
          </div>
        );
      }
      return;
    }
    flush();
    if (p.kind === "text") {
      if (p.text.trim()) out.push(<TextBlock key={i} text={p.text} />);
    } else if (p.kind === "sub") {
      const s = subs[p.id];
      if (s) out.push(<Chat2SubRow key={i} sub={s} />);
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
  flush();

  return <>{out}</>;
}
