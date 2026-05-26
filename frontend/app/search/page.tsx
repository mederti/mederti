"use client";

import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, type DrugHit, type ShortageEvent } from "@/lib/api";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import { truncateDrugName } from "@/lib/utils";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

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

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", AU: "Australia", GB: "United Kingdom",
  EU: "European Union", DE: "Germany", FR: "France", IT: "Italy", ES: "Spain",
  IE: "Ireland", FI: "Finland", NO: "Norway", CH: "Switzerland", NZ: "New Zealand",
};

function DrugCard({ drug, altCounts }: { drug: DrugResult; altCounts: Record<string, number> }) {
  const isCatalogue = drug.source === "catalogue";
  const activeShortages = (drug.shortages || []).filter(s => s.status === "active" || s.status === "anticipated");
  const countries = [...new Set(activeShortages.map(s => s.country_code))];
  const topSeverity = activeShortages.find(s => s.severity === "critical")?.severity
    || activeShortages.find(s => s.severity === "high")?.severity
    || activeShortages[0]?.severity;
  const alts = altCounts[drug.drug_id] ?? 0;

  const card = (
    <div style={{
      background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
      padding: "20px 24px", cursor: isCatalogue ? "default" : "pointer",
      transition: "border-color 0.15s, box-shadow 0.15s",
    }}
      onMouseEnter={e => { if (!isCatalogue) { (e.currentTarget as HTMLElement).style.borderColor = "var(--teal)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(15,23,42,0.1)"; } }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--app-border)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 4, letterSpacing: "-0.01em" }}>
            {truncateDrugName(drug.generic_name)}
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
        {isCatalogue ? (
          <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>
            Registered in {COUNTRY_NAMES[drug.source_country ?? ""] ?? drug.source_country} via {drug.source_name}
            {drug.registration_number && (
              <span style={{ color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", marginLeft: 6, fontSize: 11 }}>
                {drug.registration_number}
              </span>
            )}
          </span>
        ) : drug.active_shortage_count > 0 ? (
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
            No active shortages
          </span>
        )}
        {!isCatalogue && alts > 0 && (
          <span style={{ fontSize: 12, color: "var(--app-text-4)", marginLeft: "auto" }}>
            {alts} alternative{alts !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );

  if (isCatalogue) return card;
  return (
    <Link href={`/drugs/${drug.drug_id}`} style={{ textDecoration: "none", color: "inherit" }}>
      {card}
    </Link>
  );
}

function isConversational(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  // Starts with question/action word
  if (/^(find|show|list|get|search|compare|tell|look|what|where|when|how|why|which|who|do|does|is|are|can|should)\b/.test(t)) return true;
  // Contains availability/intent phrases
  if (/\b(availability|available in|shortage in|alternatives? to|across|between|compared to|versus|vs\.?)\b/.test(t)) return true;
  // 4+ words
  if (t.split(/\s+/).length >= 4) return true;
  return false;
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

  const conversational = isConversational(query);

  function askMederti(q: string) {
    const t = q.trim();
    if (!t) return;
    router.push(`/chat?q=${encodeURIComponent(t)}`);
  }

  const ac = useAutocomplete({
    minChars: 2,
    debounceMs: 200,
    limit: 8,
    onSelect: (item) => {
      ac.setIsOpen(false);
      router.push(item.href);
    },
    onSubmit: (q) => {
      ac.setIsOpen(false);
      if (isConversational(q)) askMederti(q);
    },
  });

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    // Skip keyword search for conversational queries — the UI surfaces an "Ask Mederti AI" CTA instead.
    if (isConversational(q)) { setResults([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await api.search(q, 20);
      setResults(data.results.map(d => ({ ...d })));
      setTotal(data.total);

      // Alternatives counts now come folded into /api/search. Map them
      // into the local lookup so existing DrugCard render keeps working.
      const counts: Record<string, number> = {};
      for (const drug of data.results) {
        counts[drug.drug_id] = drug.alternatives_count ?? 0;
      }
      setAltCounts(counts);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run initial search on mount
  useEffect(() => { if (initialQ) { search(initialQ); ac.setQuery(initialQ); } }, [initialQ, search]);

  function handleChange(q: string) {
    setQuery(q);
    ac.setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const url = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(url, { scroll: false });
      search(q);
    }, 150);
  }

  return (
    <>
      {/* Search bar */}
      <div style={{ marginBottom: 40 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isConversational(query)) askMederti(query);
          }}
        >
          <div ref={ac.containerRef} style={{ position: "relative", maxWidth: 600 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: conversational ? "var(--teal)" : "var(--app-text-4)", fontSize: 16, pointerEvents: "none", zIndex: 1 }}>
              {conversational ? "✦" : "⌕"}
            </span>
            <input
              autoFocus
              {...ac.inputProps}
              value={query}
              onChange={e => handleChange(e.target.value)}
              placeholder="Ask anything — e.g. find atorvastatin availability in Spain and Italy"
              style={{
                width: "100%", padding: "14px 16px 14px 40px", fontSize: 16,
                border: `1px solid ${conversational ? "var(--teal)" : "var(--app-border-2)"}`, borderRadius: 10,
                fontFamily: "var(--font-inter), sans-serif",
                outline: "none", background: "#fff", color: "var(--app-text)",
                boxSizing: "border-box",
              }}
              onFocus={e => { ac.inputProps.onFocus(); (e.target.style.borderColor = "var(--teal)"); }}
              onBlur={e => (e.target.style.borderColor = conversational ? "var(--teal)" : "var(--app-border-2)")}
            />

            {/* Autocomplete dropdown */}
            {ac.isOpen && !conversational && (
              <AutocompleteDropdown
                items={ac.items}
                cursor={ac.cursor}
                loading={ac.loading}
                query={query}
                listId={ac.inputProps["aria-controls"]}
                onSelect={(item) => { ac.setIsOpen(false); router.push(item.href); }}
                onHover={() => {}}
              />
            )}
          </div>
        </form>

        {conversational && (
          <div style={{ marginTop: 12, maxWidth: 600 }}>
            <button
              type="button"
              onClick={() => askMederti(query)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 16px",
                background: "var(--teal)", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font-inter), sans-serif",
              }}
            >
              <span style={{ fontSize: 14 }}>✦</span> Ask Mederti AI — &ldquo;{query.trim().length > 60 ? query.trim().slice(0, 60) + "…" : query.trim()}&rdquo;
            </button>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--app-text-4)" }}>
              Press Enter to get an AI-powered answer with live shortage, recall, and availability data.
            </div>
          </div>
        )}

        {!conversational && query.trim() && !loading && (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--app-text-4)" }}>
            {total === 0 ? "No drugs found" : `${total} drug${total !== 1 ? "s" : ""} matched`}
            {total > 20 && " · showing top 20"}
          </div>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, padding: "80px 20px",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-black.png"
            alt="Mederti"
            style={{ height: 38, animation: "mederti-pulse 1.4s ease-in-out infinite" }}
          />
          <div style={{
            fontSize: 13, color: "var(--app-text-3)",
            fontFamily: "var(--font-dm-mono), monospace",
            letterSpacing: "0.05em",
          }}>
            Searching the global registry…
          </div>
          <style>{`
            @keyframes mederti-pulse {
              0%, 100% { opacity: 1;   transform: scale(1); }
              50%      { opacity: 0.45; transform: scale(0.96); }
            }
          `}</style>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {results.map(drug => (
            <DrugCard key={drug.drug_id} drug={drug} altCounts={altCounts} />
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && !conversational && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>No results for &ldquo;{query}&rdquo;</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65, maxWidth: 400, margin: "0 auto" }}>
            Try a different spelling, the generic name, or a brand name. Or rephrase as a question to get an AI-powered answer.
          </div>
        </div>
      )}

      {!loading && !query.trim() && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>Search by drug name — or ask anything</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65, marginBottom: 18 }}>
            Type a generic, brand, or ATC code for instant lookup, or ask a full question to get an AI answer.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 540, margin: "0 auto" }}>
            {[
              { label: "find atorvastatin availability in Spain and Italy", conv: true },
              { label: "alternatives to amoxicillin during shortage", conv: true },
              { label: "compare metformin supply across AU, UK, US", conv: true },
              { label: "amoxicillin", conv: false },
              { label: "insulin", conv: false },
              { label: "salbutamol", conv: false },
            ].map(({ label, conv }) => (
              <button
                key={label}
                onClick={() => {
                  if (conv) askMederti(label);
                  else handleChange(label);
                }}
                style={{
                  padding: "6px 14px", borderRadius: 20,
                  background: conv ? "var(--teal-bg)" : "#fff",
                  border: `1px solid ${conv ? "var(--teal-b)" : "var(--app-border)"}`,
                  color: conv ? "var(--teal)" : "var(--app-text-3)",
                  fontSize: 13, cursor: "pointer",
                  fontFamily: "var(--font-inter), sans-serif",
                }}
              >
                {conv ? "✦ " : ""}{label}
              </button>
            ))}
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
          .search-hero { padding: 24px 16px 20px !important; }
          .search-main { padding: 24px 16px !important; }
        }
      `}</style>

      <SiteNav />

      {/* Hero */}
      <div style={{ background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div className="search-hero" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>⌕</span>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--app-text)", margin: 0 }}>
              Drug Shortage Search
            </h1>
          </div>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", margin: 0 }}>
            95,000+ registered drugs · 42 regulatory sources · 20+ countries
          </p>
        </div>
      </div>

      <main className="search-main" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px" }}>
        <Suspense fallback={<div style={{ height: 60 }} />}>
          <SearchResults />
        </Suspense>
      </main>

      <SiteFooter />
    </div>
  );
}
