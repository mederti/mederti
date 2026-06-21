"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { truncateDrugName } from "@/lib/utils";

// Safe fallback if the live trending fetch returns nothing — never an empty row.
const FALLBACK_SAMPLES = ["Amoxicillin", "Cisplatin", "Metformin", "Atorvastatin"];

// Whole weeks since the Unix epoch — stable for 7 days, then advances. Used to
// rotate a 4-wide window over the trending pool so the chips refresh weekly.
function weekIndex(): number {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

// Pick 4 drugs from the trending pool, windowed by week so the set changes each
// week but stays put within a week. Ranked most-reported-first upstream.
function weeklyPick(pool: string[]): string[] {
  if (pool.length <= 4) return pool;
  const start = (weekIndex() * 4) % pool.length;
  return Array.from({ length: 4 }, (_, i) => pool[(start + i) % pool.length]);
}

export default function V1Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [samples, setSamples] = useState<string[]>(FALLBACK_SAMPLES);

  // Build a trending pool from the most-reported active shortages, then window
  // it by week. Most-frequent generic names = the drugs the world is most short
  // of right now — a real "trending" signal, not a hand-picked list.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/shortages?status=active&sort=severity&page_size=100")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const rows = (data.results ?? []) as { generic_name?: string | null }[];
        const counts = new Map<string, number>();
        for (const r of rows) {
          const name = r.generic_name?.trim();
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const pool = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name);
        const picked = weeklyPick(pool);
        if (picked.length) setSamples(picked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
