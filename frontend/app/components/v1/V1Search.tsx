"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLES = ["Amoxicillin 500mg", "Cisplatin", "Metformin", "Atorvastatin"];

export default function V1Search() {
  const router = useRouter();
  const [q, setQ] = useState("");

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
        {SAMPLES.map((s) => (
          <button key={s} className="sample" onClick={() => run(s)}>
            {s}
          </button>
        ))}
      </div>
    </>
  );
}
