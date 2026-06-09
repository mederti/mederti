"use client";

// Report identity + export action for the drug "report" page. Client island so
// the rest of V1DrugView can stay a server component. Export uses the browser's
// native print-to-PDF, driven by the @media print rules in V1DrugView's CSS.
export default function V1ReportActions({
  generatedLabel,
  marketLabel,
  sourceCount,
}: {
  generatedLabel: string;
  marketLabel: string;
  sourceCount: number;
}) {
  return (
    <div className="report-bar">
      <div className="report-bar-l">
        <div className="report-kicker">Mederti Drug Report</div>
        <div className="report-meta">
          Generated {generatedLabel} · {marketLabel}
          {sourceCount > 0 ? ` · ${sourceCount} regulatory source${sourceCount !== 1 ? "s" : ""}` : ""}
        </div>
      </div>
      <button
        type="button"
        className="report-export"
        onClick={() => window.print()}
      >
        <span aria-hidden>⭳</span> Export PDF
      </button>
    </div>
  );
}
