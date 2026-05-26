"use client";

import { useContext } from "react";
import type { DrugDetailBundle } from "@/lib/chat/types";
import { PaneContext } from "../PaneContext";
import { pickNotableRecall } from "../cardUtils";

// Inline safety alert when the drug has a recent significant recall.
// Renders null in the (common) case where nothing meets the bar — so adding
// this to a card is zero-cost noise-wise.
export function RecallCallout({ bundle }: { bundle: DrugDetailBundle }) {
  const pane = useContext(PaneContext);
  const recall = pickNotableRecall(bundle.recalls);
  if (!recall) return null;

  const dateLabel = formatDate(recall.announced_date);
  const cls = recall.recall_class ? `Class ${recall.recall_class}` : "Recall";
  const product = recall.brand_name || recall.generic_name || "this drug";
  const country = recall.country_code ? ` · ${recall.country_code}` : "";
  const reason = recall.reason ? truncate(recall.reason, 110) : null;

  return (
    <div className="recall-callout" data-class={recall.recall_class ?? ""}>
      <div className="recall-callout-head">
        <span className="recall-callout-icon" aria-hidden>⚠</span>
        <span className="recall-callout-class">{cls}{country}</span>
        <span className="recall-callout-date">{dateLabel}</span>
      </div>
      <div className="recall-callout-body">
        <span className="recall-callout-prod">{product}</span>
        {reason ? <> — {reason}</> : null}
      </div>
      <div className="recall-callout-foot">
        <button
          type="button"
          className="recall-callout-link"
          onClick={() => pane?.open(bundle.drug.drug_id)}
        >
          View all recalls →
        </button>
        {recall.press_release_url ? (
          <a
            className="recall-callout-link"
            href={recall.press_release_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Source ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}
