"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, type DrugHit, type ShortageEvent } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Extended drug hit with shortage breakdown
interface DrugResult extends DrugHit {
  shortages?: ShortageEvent[];
  loadingShortages?: boolean;
}

function severityColor(s: string | null) {
  if (s === "critical") return { color: "var(--crit)", bg: "var(--crit-bg)" };
  if (s === "high")     return { color: "var(--high)", bg: "var(--high-bg)" };
  if (s === "medium")   return { color: "var(--med)",  bg: "var(--med-bg)"  };
  return                       { color: "var(--low)",  bg: "var(--low-bg)"  };
}

function DrugCard({ drug, altCounts }: { drug: DrugResult; altCounts: Record<string, number> }) {
  const activeShortages = (drug.shortages || []).filter(s => s.status === "active" || s.status === "anticipated");
  const countries = [...new Set(activeShortages.map(s => s.country_code))];
  const topSeverity = activeShortages.find(s => s.severity === "critical")?.severity
    || activeShortages.find(s => s.severity === "high")?.severity
    || activeShortages[0]?.severity;
  const alts = altCounts[drug.drug_id] ?? 0;

  return (
    <Link href={`/drugs/${drug.drug_id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{
        background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
        padding: "20px 24px", cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(13,148,136,0.1)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--app-border)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 4, letterSpacing: "-0.01em" }}>
              {drug.generic_name}
            </div>
            {drug.brand_names.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                {drug.brand_names.slice(0, 3).join(" · ")}
                {drug.brand_names.length > 3 && ` +${drug.brand_names.length - 3} more`}
              </div>
            )}
          </div>
          {drug.atc_code && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--teal)", background: "var(--teal-bg)",
              padding: "3px 8px", borderRadius: 4, fontFamily: "var(--font-dm-mono), monospace",
              flexShrink: 0,
            }}>
              {drug.atc_code}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {drug.active_shortage_count > 0 ? (
            <>
              {topSeverity && (
                <span style={{
                  ...severityColor(topSeverity),
                  fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {topSeverity}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                {drug.active_shortage_count} active shortage{drug.active_shortage_count !== 1 ? "s" : ""}
              </span>
              {countries.length > 0 && (
                <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                  · {countries.slice(0, 5).join(", ")}{countries.length > 5 ? ` +${countries.length - 5}` : ""}
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--low)", fontWeight: 500 }}>
              ✓ No active shortages
            </span>
          )}
          {alts > 0 && (
            <span style={{ fontSize: 12, color: "var(--app-text-4)", marginLeft: "auto" }}>
              {alts} alternative{alts !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const initialQ = params.get("q") ?? "";

  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<DrugResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [altCounts, setAltCounts] = useState<Record<string, number>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const data = await api.search(q, 20);
      setResults(data.results.map(d => ({ ...d })));
      setTotal(data.total);

      // Fetch alternatives counts in parallel
      const counts: Record<string, number> = {};
      await Promise.all(
        data.results.map(async (drug) => {
          try {
            const alts = await api.getDrugAlternatives(drug.drug_id);
            counts[drug.drug_id] = alts.length;
          } catch { /* ignore */ }
        })
      );
      setAltCounts(counts);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run initial search on mount
  useEffect(() => { if (initialQ) search(initialQ); }, [initialQ, search]);

  function handleChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const url = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(url, { scroll: false });
      search(q);
    }, 300);
  }

  return (
    <>
      {/* Search bar */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ position: "relative", maxWidth: 600 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--app-text-4)", fontSize: 16, pointerEvents: "none" }}>
            ⌕
          </span>
          <input
            autoFocus
            value={query}
            onChange={e => handleChange(e.target.value)}
            placeholder="Search drug name, brand name, or ATC code…"
            style={{
              width: "100%", padding: "14px 16px 14px 40px", fontSize: 16,
              border: "1px solid var(--app-border-2)", borderRadius: 10,
              fontFamily: "var(--font-inter), sans-serif",
              outline: "none", background: "#fff", color: "var(--app-text)",
              boxSizing: "border-box",
            }}
            onFocus={e => (e.target.style.borderColor = "var(--teal)")}
            onBlur={e => (e.target.style.borderColor = "var(--app-border-2)")}
          />
        </div>
        {query.trim() && !loading && (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--app-text-4)" }}>
            {total === 0 ? "No drugs found" : `${total} drug${total !== 1 ? "s" : ""} matched`}
            {total > 20 && " · showing top 20"}
          </div>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{
              height: 82, background: "var(--app-bg)", border: "1px solid var(--app-border)",
              borderRadius: 12, animation: "pulse 1.5s ease-in-out infinite",
              opacity: 1 - i * 0.12,
            }} />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {results.map(drug => (
            <DrugCard key={drug.drug_id} drug={drug} altCounts={altCounts} />
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>No results for &ldquo;{query}&rdquo;</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65, maxWidth: 400, margin: "0 auto" }}>
            Try a different spelling, the generic name, or a brand name. Shortage data covers 6,000+ drugs across 12 countries.
          </div>
        </div>
      )}

      {!loading && !query.trim() && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>💊</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>Search the shortage database</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65 }}>
            Try searching for <button onClick={() => handleChange("amoxicillin")} style={{ background: "none", border: "none", color: "var(--teal)", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-inter), sans-serif" }}>amoxicillin</button>,{" "}
            <button onClick={() => handleChange("insulin")} style={{ background: "none", border: "none", color: "var(--teal)", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-inter), sans-serif" }}>insulin</button>, or{" "}
            <button onClick={() => handleChange("salbutamol")} style={{ background: "none", border: "none", color: "var(--teal)", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-inter), sans-serif" }}>salbutamol</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        @media (max-width: 768px) {
          .search-nav { padding: 0 16px !important; }
          .search-hero { padding: 24px 16px 20px !important; }
          .search-main { padding: 24px 16px !important; }
        }
      `}</style>

      {/* NAV */}
      <nav className="search-nav" style={{
        height: 56, background: "var(--navy)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", position: "sticky", top: 0, zIndex: 50,
      }}>
        <Link href="/" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: "#fff", textDecoration: "none" }}>
          Mederti<span style={{ color: "var(--teal-l)" }}>.</span>
        </Link>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <Link href="/dashboard" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Dashboard</Link>
          <Link href="/shortages" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Shortages</Link>
          <Link href="/recalls" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Recalls</Link>
          <Link href="/login" style={{ fontSize: 13, fontWeight: 500, color: "#fff", background: "var(--teal)", padding: "7px 16px", borderRadius: 6, textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </nav>

      {/* DARK HERO */}
      <div style={{ background: "var(--navy)" }}>
        <div className="search-hero" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>⌕</span>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff", margin: 0 }}>
              Drug Shortage Search
            </h1>
          </div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", margin: 0 }}>
            6,000+ active shortages across 12 countries · Updated every 6 hours
          </p>
        </div>
      </div>

      <main className="search-main" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px" }}>
        <Suspense fallback={<div style={{ height: 60 }} />}>
          <SearchResults />
        </Suspense>
      </main>
    </div>
  );
}
