"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { truncateDrugName } from "@/lib/utils";

// Safe fallback if the server passes no trending set (cold cache / fetch miss)
// — never an empty chip row.
const FALLBACK_SAMPLES = ["Amoxicillin", "Cisplatin", "Metformin", "Atorvastatin"];

// Chips come pre-computed from the server (app/page.tsx) — the most-reported
// drugs among current active shortages, windowed by week. Rendered server-side
// so the live set is in the first paint: no fallback flash, no client fetch.
export default function V1Search({ initialSamples }: { initialSamples?: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const samples = initialSamples?.length ? initialSamples : FALLBACK_SAMPLES;

  function run(value: string) {
    const t = value.trim();
    if (!t) return;
    router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  return (
    <>
      <div className="searchbox">
        <span className="ic">⌕</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a drug — e.g. amoxicillin, cisplatin, metformin"
          onKeyDown={(e) => {
            if (e.key === "Enter") run(q);
          }}
        />
        <button onClick={() => run(q)}>Search</button>
      </div>
      <div className="samples">
        {samples.map((s) => (
          <button key={s} className="sample" onClick={() => run(s)}>
            {truncateDrugName(s, 24)}
          </button>
        ))}
      </div>
    </>
  );
}
