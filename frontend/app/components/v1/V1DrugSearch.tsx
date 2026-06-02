"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Compact search bar for the top of the drug page's middle column — prefilled
// with the current medicine, re-searches on submit. Replaces the separate
// "+ New search" button and "← Search results" back link.
export default function V1DrugSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  function go() {
    const t = q.trim();
    if (t) router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  return (
    <form className="dsearch" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <span className="dsearch-ic">⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        placeholder="Search a medicine…"
        aria-label="Search a medicine"
      />
      <button type="submit">Search</button>
    </form>
  );
}
