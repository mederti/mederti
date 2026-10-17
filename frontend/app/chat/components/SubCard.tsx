"use client";

import { useContext } from "react";
import type { SubstituteRow } from "@/lib/chat/types";
import { ChatContext } from "./ChatContext";
import { ALTERNATIVES_CAVEAT } from "@/lib/alternatives";

// matchOverride is accepted (older answers carry match="NN") but ignored: no
// validated similarity score exists, so no percentage is ever shown.
export function SubCard({ sub }: { sub: SubstituteRow; matchOverride?: string }) {
  const chat = useContext(ChatContext);

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
          {inShortage ? (
            <> · <span style={{ color: "var(--high)" }}>also in shortage ({sub.active_shortage_count})</span></>
          ) : null}
        </div>
      </div>
      <div className="sub-card-match" title={ALTERNATIVES_CAVEAT}>{sub.match_basis ?? "Same ATC class"}</div>
    </button>
  );
}
