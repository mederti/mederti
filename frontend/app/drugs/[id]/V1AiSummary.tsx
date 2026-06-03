"use client";

import { useEffect, useState } from "react";

/**
 * V1AiSummary — a short AI-composed commentary on the drug's current supply
 * situation, shown near the top of the V1 drug page (under the status card).
 *
 * Data comes from /api/drugs/[id]/so-what (Claude, Economist house style,
 * 12h-cached, grounded in live regulator/manufacturing/shortage signals). The
 * endpoint degrades to a 503 when ANTHROPIC_API_KEY is unset — in that case
 * this component renders nothing rather than fabricating a summary.
 */

interface Payload {
  headline: string;
  body: string;
  signal: "elevated" | "stable" | "improving" | "worsening";
  confidence: "high" | "medium" | "low";
  error?: string;
}

const SIGNAL: Record<Payload["signal"], { label: string; cls: string }> = {
  worsening: { label: "Worsening", cls: "crit" },
  elevated: { label: "Elevated", cls: "med" },
  improving: { label: "Improving", cls: "ok" },
  stable: { label: "Stable", cls: "neutral" },
};

export default function V1AiSummary({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const wrapCls = embedded ? "ai-sum embedded" : "ai-sum";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/drugs/${id}/so-what`)
      .then((r) => r.json())
      .then((d: Payload) => {
        if (alive && !d.error && d.body) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className={wrapCls}>
        <div className="ai-sum-head">
          <span className="ai-sum-spark">✦</span>
          <span className="ai-sum-label">Mederti AI summary</span>
        </div>
        <div className="ai-sum-skel">Reading today&rsquo;s signals…</div>
      </div>
    );
  }

  if (!data) return null;

  const sig = SIGNAL[data.signal] ?? SIGNAL.stable;

  return (
    <div className={wrapCls}>
      <div className="ai-sum-head">
        <span className="ai-sum-spark">✦</span>
        <span className="ai-sum-label">Mederti AI summary</span>
        <span className={`ai-sum-sig ${sig.cls}`}>{sig.label}</span>
      </div>
      {data.headline && <div className="ai-sum-hl">{data.headline}</div>}
      <div className="ai-sum-body">{data.body}</div>
      <div className="ai-sum-foot">
        Composed from live regulator &amp; supply signals · confidence {data.confidence}
      </div>
    </div>
  );
}
