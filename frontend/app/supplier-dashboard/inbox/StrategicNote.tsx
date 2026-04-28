"use client";

import { useEffect, useState } from "react";
import { Sparkles, Target, Users, Clock } from "lucide-react";

interface Note {
  buyer_interpretation: string;
  win_factors: string[];
  competitive_landscape: string;
  recommended_response_time_hours: number;
  confidence: string;
  cached?: boolean;
}

interface StrategicNoteProps {
  enquiryId: string;
}

const CONF_COLOR: Record<string, string> = {
  high: "var(--low)",
  medium: "var(--high)",
  low: "var(--app-text-4)",
};

export default function StrategicNote({ enquiryId }: StrategicNoteProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  function loadIfNeeded() {
    if (note || loading) return;
    setLoading(true);
    fetch(`/api/supplier/insight/enquiry/${enquiryId}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setNote(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  // Lazy-load when opened
  useEffect(() => {
    if (open) loadIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div style={{
      marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--app-border)",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          color: open ? "var(--teal)" : "var(--app-text-4)",
          background: "none", border: "none", cursor: "pointer",
          textTransform: "uppercase", padding: 0,
        }}
      >
        <Sparkles size={12} />
        {open ? "Hide AI strategy" : "Show AI strategy"}
      </button>

      {open && (
        <div style={{
          marginTop: 10, padding: 14,
          background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
          color: "white", borderRadius: 8,
          fontSize: 12, lineHeight: 1.55,
        }}>
          {loading && (
            <div style={{ color: "#94A3B8" }}>Analysing this enquiry…</div>
          )}
          {!loading && !note && (
            <div style={{ color: "#94A3B8" }}>Could not generate strategy note.</div>
          )}
          {note && (
            <>
              {/* Buyer interpretation */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#5EEAD4", marginBottom: 4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
                  <Target size={11} /> Buyer interpretation
                </div>
                <div style={{ color: "white" }}>{note.buyer_interpretation}</div>
              </div>

              {/* Win factors */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#5EEAD4", marginBottom: 6, textTransform: "uppercase" }}>
                  Win factors
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#CADCFC" }}>
                  {note.win_factors.map((f, i) => <li key={i} style={{ marginBottom: 3 }}>{f}</li>)}
                </ul>
              </div>

              {/* Competitive */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#5EEAD4", marginBottom: 4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
                  <Users size={11} /> Competition
                </div>
                <div style={{ color: "#CADCFC" }}>{note.competitive_landscape}</div>
              </div>

              {/* Footer: response time + confidence */}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: 11, color: "#94A3B8" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Clock size={11} color="#5EEAD4" />
                  Quote within <strong style={{ color: "white", margin: "0 3px" }}>{note.recommended_response_time_hours}h</strong> for best win rate
                </span>
                <span>
                  Confidence: <span style={{ color: CONF_COLOR[note.confidence] ?? "var(--app-text-4)", fontWeight: 600 }}>{note.confidence}</span>
                  {note.cached && " · cached"}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
