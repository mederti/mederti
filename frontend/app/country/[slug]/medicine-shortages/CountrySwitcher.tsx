"use client";

import { useRouter } from "next/navigation";

/** Jump to another country's landing page. */
export default function CountrySwitcher({
  current,
  countries,
}: {
  current: string;
  countries: { slug: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--app-text-3, #6a7280)" }}>
      Country
      <select
        value={current}
        onChange={(e) => router.push(`/country/${e.target.value}/medicine-shortages`)}
        style={{
          padding: "6px 10px", fontSize: 13.5, borderRadius: 8, background: "#fff",
          border: "1px solid var(--app-border, #dde3e9)", color: "var(--app-text, #0c1118)",
        }}
      >
        {countries.map((c) => (
          <option key={c.slug} value={c.slug}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}
