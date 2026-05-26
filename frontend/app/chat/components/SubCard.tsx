"use client";

import { useContext } from "react";
import type { SubstituteRow } from "@/lib/chat/types";
import { ChatContext } from "./ChatContext";

export function SubCard({ sub, matchOverride }: { sub: SubstituteRow; matchOverride?: string }) {
  const chat = useContext(ChatContext);
  const matchPct =
    matchOverride && matchOverride.length > 0
      ? matchOverride.endsWith("%") ? matchOverride : `${matchOverride}%`
      : sub.similarity_score != null
        ? `${Math.round(sub.similarity_score * 100)}%`
        : "—";

  const inShortage = sub.active_shortage_count > 0;

  return (
    <button
      type="button"
      className="sub-card sub-card-button"
      onClick={() => chat?.send(`Tell me about ${sub.name}`)}
      aria-label={`Open ${sub.name} as a new card`}
    >
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div className="sub-card-name">{sub.name}</div>
        <div className="sub-card-meta">
          {sub.atc_code ? <span className="font-mono">{sub.atc_code}</span> : null}
          {sub.drug_class ? <> · {sub.drug_class}</> : null}
          {sub.clinical_evidence_level ? <> · evidence {sub.clinical_evidence_level}</> : null}
          {sub.requires_monitoring ? <> · monitoring required</> : null}
          {inShortage ? (
            <> · <span style={{ color: "var(--high)" }}>also in shortage ({sub.active_shortage_count})</span></>
          ) : null}
        </div>
      </div>
      <div className="sub-card-match">{matchPct} match</div>
    </button>
  );
}
