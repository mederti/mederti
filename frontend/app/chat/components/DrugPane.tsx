"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DrugDetailBundle,
  ManufacturerRow,
  ProductRow,
  RecallRow,
  ShortageHistoryStats,
  ShortageRow,
  SubstituteRow,
} from "@/lib/chat/types";

const SEV_CLASS: Record<string, string> = {
  critical: "sev sev-critical",
  high: "sev sev-high",
  medium: "sev sev-medium",
  low: "sev sev-low",
};
const SEV_N: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const CLASS_BADGE: Record<string, string> = {
  I: "recall-class recall-class-1",
  II: "recall-class recall-class-2",
  III: "recall-class recall-class-3",
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

// Per-id cache of last-loaded names so the back button can label itself even
// when the previous drug was never returned by the chat (i.e. opened from
// inside another pane's substitutes section).
const nameCache = new Map<string, string>();

export function DrugPane({
  drugId,
  previousDrugId,
  previousDrugName,
  onClose,
  onOpenDrug,
  onBack,
}: {
  drugId: string | null;
  previousDrugId?: string | null;
  previousDrugName?: string | null;
  onClose: () => void;
  onOpenDrug: (id: string) => void;
  onBack?: () => void;
}) {
  const [bundle, setBundle] = useState<DrugDetailBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!drugId) {
      setBundle(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/drug/${drugId}?country=AU`)
      .then((r) => r.json())
      .then((data: DrugDetailBundle) => {
        if (cancelled) return;
        if ((data as any).error) {
          setErr((data as any).error);
          setBundle(null);
        } else {
          if (data.drug?.name) nameCache.set(data.drug.drug_id, data.drug.name);
          setBundle(data);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drugId]);

  // Escape to close.
  useEffect(() => {
    if (!drugId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drugId, onClose]);

  const isOpen = !!drugId;
  const canGoBack = !!(previousDrugId && onBack);
  const backLabel = previousDrugName || (previousDrugId ? nameCache.get(previousDrugId) : null);

  return (
    <>
      <div className={`pane-backdrop ${isOpen ? "pane-backdrop-open" : ""}`} onClick={onClose} />
      <aside className={`pane ${isOpen ? "pane-open" : ""}`} aria-hidden={!isOpen}>
        <div className="pane-head">
          {canGoBack ? (
            <button type="button" className="pane-back" onClick={onBack} aria-label={`Back to ${backLabel ?? "previous drug"}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M7.5 2L3 6L7.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="pane-back-label">{backLabel ? backLabel : "Back"}</span>
            </button>
          ) : (
            <div className="pane-head-meta">Drug profile</div>
          )}
          <button type="button" className="pane-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="pane-body">
          {loading ? (
            <div className="pane-loading">
              <div className="typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          ) : err ? (
            <div className="err">{err}</div>
          ) : bundle ? (
            <PaneContent bundle={bundle} onOpenDrug={onOpenDrug} />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function PaneContent({
  bundle,
  onOpenDrug,
}: {
  bundle: DrugDetailBundle;
  onOpenDrug: (id: string) => void;
}) {
  const { drug, substitutes, recalls } = bundle;
  const activeShortages = drug.shortages
    .filter((s) => s.status === "active")
    .sort((a, b) => (SEV_N[b.severity || ""] || 0) - (SEV_N[a.severity || ""] || 0));
  const visibleShortages = activeShortages.slice(0, 6);
  const hiddenShortageCount = activeShortages.length - visibleShortages.length;
  const noActive = activeShortages.length === 0;

  return (
    <>
      {/* HERO — name, classification, one-line status. No badge wall. */}
      <header className="pane-hero">
        <div className="pane-hero-name">{drug.name}</div>
        <div className="pane-hero-sub">
          {drug.atc_code ? <span className="font-mono">{drug.atc_code}</span> : null}
          {drug.atc_description ? <> · {drug.atc_description}</> : null}
          {drug.drug_class && drug.drug_class !== drug.atc_description ? <> · {drug.drug_class}</> : null}
        </div>
        <div className="pane-hero-status">
          {noActive ? (
            <span className="pane-status-pill pane-status-ok">No active shortage</span>
          ) : (
            <>
              <span className={`pane-status-pill ${SEV_CLASS[drug.worst_severity || "medium"] || "sev sev-medium"}`}>
                {drug.worst_severity ? drug.worst_severity.toUpperCase() : "ACTIVE"} ·
                {" "}{activeShortages.length} signal{activeShortages.length === 1 ? "" : "s"} ·
                {" "}{drug.countries_affected.length} countr{drug.countries_affected.length === 1 ? "y" : "ies"}
              </span>
            </>
          )}
          {drug.who_essential_medicine ? <span className="badge badge-who">WHO Essential</span> : null}
          {drug.critical_medicine_eu ? <span className="badge badge-crit-eu">EU Critical</span> : null}
        </div>
        {drug.brand_names.length > 0 ? (
          <div className="pane-hero-brands">
            Brands: {drug.brand_names.slice(0, 6).join(", ")}
            {drug.brand_names.length > 6 ? ` +${drug.brand_names.length - 6}` : ""}
          </div>
        ) : null}
      </header>

      {/* PRODUCT SUMMARY — what is this drug, what does it come in */}
      <ProductSummary drug={drug} bundle={bundle} country="AU" />

      {/* ALTERNATIVES — only if any */}
      {substitutes.length > 0 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">Therapeutic alternatives</h3>
          <div className="pane-rows">
            {substitutes.slice(0, 5).map((s) => <SubRowItem key={s.drug_id} sub={s} onOpenDrug={onOpenDrug} />)}
            {substitutes.length > 5 ? (
              <div className="pane-row-more">+ {substitutes.length - 5} more alternatives</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* PRODUCTS ON REGISTRY — the SKU-finder. Keeps its filters. */}
      {bundle.products && bundle.products.length > 0 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">
            Products on registry · {bundle.products.length}
          </h3>
          <ProductsRegistry products={bundle.products} />
        </section>
      ) : null}

      {/* MANUFACTURERS — compact chip strip */}
      {bundle.manufacturers && bundle.manufacturers.length > 0 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">
            Manufacturers · {bundle.manufacturers.length}
          </h3>
          <ManufacturerChipsCompact manufacturers={bundle.manufacturers} />
        </section>
      ) : null}

      {/* ACTIVE SHORTAGES — condensed one-liner per country, click to expand */}
      {activeShortages.length > 0 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">
            Active shortages · {activeShortages.length} in {drug.countries_affected.length} countr{drug.countries_affected.length === 1 ? "y" : "ies"}
          </h3>
          <div className="pane-shortage-list">
            {visibleShortages.map((s, i) => <ShortageRowCompact key={i} row={s} />)}
            {hiddenShortageCount > 0 ? (
              <div className="pane-row-more">+ {hiddenShortageCount} more</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* HISTORY — single line of context, no charts */}
      {bundle.history && bundle.history.total_events > 1 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">History</h3>
          <HistoryCompact history={bundle.history} />
        </section>
      ) : null}

      {/* RECALLS — only when there are any */}
      {recalls.length > 0 ? (
        <section className="pane-section">
          <h3 className="pane-section-title">Recalls · {recalls.length}</h3>
          <div className="pane-rows">
            {recalls.slice(0, 4).map((r) => <RecallRowItem key={r.recall_id} recall={r} />)}
            {recalls.length > 4 ? (
              <div className="pane-row-more">+ {recalls.length - 4} older recalls</div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

// Compact chip strip — manufacturer name + product count, max 12 visible.
function ManufacturerChipsCompact({ manufacturers }: { manufacturers: ManufacturerRow[] }) {
  const cleaned = (name: string) =>
    name
      .replace(/\s+(PTY LTD|PTY LIMITED|LIMITED|LTD|LLC|INC\.?|GMBH|SRL|N\.?V\.?|S\.?A\.?)\s*$/i, "")
      .replace(/[,.]\s*$/, "")
      .trim();
  const top = manufacturers.slice(0, 12);
  const hidden = manufacturers.length - top.length;
  return (
    <div className="mfg-chips">
      {top.map((m) => (
        <span key={m.sponsor_id} className="mfg-chip" title={`${m.name} · ${m.product_count} products${m.country ? ` · ${m.country}` : ""}`}>
          <span className="mfg-chip-name">{cleaned(m.name)}</span>
          <span className="mfg-chip-count">{m.product_count}</span>
        </span>
      ))}
      {hidden > 0 ? <span className="mfg-chip" style={{ color: "var(--text-4)" }}>+{hidden} more</span> : null}
    </div>
  );
}

// One-line history summary + recurrence chips. No tiles, no sparkline.
function HistoryCompact({ history }: { history: ShortageHistoryStats }) {
  const parts: string[] = [];
  parts.push(`${history.total_events} signal${history.total_events === 1 ? "" : "s"} since ${formatYearOnly(history.first_seen)}`);
  if (history.resolved_events > 0 && history.avg_resolved_duration_days != null) {
    parts.push(`avg duration ${history.avg_resolved_duration_days} days`);
  }
  const topRec = Object.entries(history.recurrences_by_country || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return (
    <>
      <p className="pane-history-compact">{parts.join(" · ")}</p>
      {topRec.length > 0 ? (
        <div className="pane-history-recur">
          {topRec.map(([code, count]) => (
            <span key={code} className="pane-history-recur-chip">
              {code} <strong>×{count}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function formatYearOnly(d: string | null): string {
  if (!d) return "—";
  try { return String(new Date(d).getFullYear()); } catch { return d; }
}

// Compact one-liner per country shortage. Click chevron to expand reason text.
function ShortageRowCompact({ row }: { row: ShortageRow }) {
  const [open, setOpen] = useState(false);
  const sevClass = SEV_CLASS[row.severity || "medium"] || "sev sev-medium";
  return (
    <div className={`pane-shortage-row${open ? " open" : ""}`}>
      <button
        type="button"
        className="pane-shortage-row-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="pane-shortage-cc font-mono">{row.country_code || row.country}</span>
        <span className={`${sevClass} pane-shortage-sev`}>{row.severity || "—"}</span>
        <span className="pane-shortage-dates">
          {monthYear(row.start_date)}
          <span className="pane-shortage-arrow"> → </span>
          {row.estimated_resolution_date ? monthYear(row.estimated_resolution_date) : "—"}
        </span>
        {row.source_url ? (
          <a
            href={row.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="pane-shortage-source"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open regulator source"
          >
            ↗
          </a>
        ) : (
          <span className="pane-shortage-source-spacer" />
        )}
        <svg className="pane-shortage-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && row.reason ? (
        <div className="pane-shortage-reason">{row.reason}</div>
      ) : null}
    </div>
  );
}

function monthYear(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
  } catch {
    return d;
  }
}

// Top-of-pane summary: strengths, forms, routes + product/sponsor counts in the user's country.
function ProductSummary({
  drug,
  bundle,
  country = "AU",
}: {
  drug: import("@/lib/chat/types").DrugDetail;
  bundle: DrugDetailBundle;
  country?: string;
}) {
  const productCount = bundle.products?.length ?? 0;
  const mfgInCountry = (bundle.manufacturers ?? []).filter(
    (m) => m.country === country || (m.countries_supplied || []).includes(country)
  ).length;
  const mfgGlobal = bundle.manufacturers?.length ?? 0;

  const items: Array<{ label: string; value: string }> = [];
  if (drug.strengths.length > 0) items.push({ label: "Strengths", value: drug.strengths.join(" · ") });
  if (drug.dosage_forms.length > 0) items.push({ label: "Forms", value: drug.dosage_forms.join(", ") });
  if (drug.routes_of_administration && drug.routes_of_administration.length > 0) {
    items.push({ label: "Routes", value: drug.routes_of_administration.join(", ") });
  }
  if (drug.therapeutic_category) items.push({ label: "Class", value: drug.therapeutic_category });

  // If we have absolutely nothing to show, skip the section entirely.
  if (items.length === 0 && productCount === 0) return null;

  return (
    <section className="pane-section pane-product-summary">
      <h3 className="pane-section-title">Product</h3>
      {items.length > 0 ? (
        <dl className="pane-product-list">
          {items.map((it) => (
            <div key={it.label} className="pane-product-row">
              <dt>{it.label}</dt>
              <dd>{it.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {(productCount > 0 || mfgGlobal > 0) ? (
        <div className="pane-product-counts">
          {productCount > 0 ? (
            <span>
              <strong>{productCount}</strong> product{productCount === 1 ? "" : "s"} registered in {country}
            </span>
          ) : null}
          {mfgGlobal > 0 ? (
            <span>
              <strong>{mfgInCountry || mfgGlobal}</strong> {mfgInCountry ? `of ${mfgGlobal} ` : ""}sponsor{(mfgInCountry || mfgGlobal) === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SubRowItem({ sub, onOpenDrug }: { sub: SubstituteRow; onOpenDrug: (id: string) => void }) {
  const inShortage = sub.active_shortage_count > 0;
  return (
    <button type="button" className="pane-row pane-row-button" onClick={() => onOpenDrug(sub.drug_id)}>
      <div className="pane-row-head">
        <div className="pane-row-title">{sub.name}</div>
        <div className="pane-row-meta">
          {sub.similarity_score != null ? (
            <span className="sub-card-match">{Math.round(sub.similarity_score * 100)}% match</span>
          ) : null}
        </div>
      </div>
      <div className="sub-card-meta">
        {sub.atc_code ? <span className="font-mono">{sub.atc_code}</span> : null}
        {sub.drug_class ? <> · {sub.drug_class}</> : null}
        {sub.clinical_evidence_level ? <> · evidence {sub.clinical_evidence_level}</> : null}
        {sub.requires_monitoring ? <> · monitoring required</> : null}
        {inShortage ? <> · <span style={{ color: "var(--high)" }}>also in shortage ({sub.active_shortage_count})</span></> : null}
      </div>
      {sub.dose_conversion_notes ? <div className="pane-row-reason">{sub.dose_conversion_notes}</div> : null}
    </button>
  );
}

function ProductsRegistry({ products }: { products: ProductRow[] }) {
  const [strengthFilter, setStrengthFilter] = useState<string | null>(null);
  const [formFilter, setFormFilter] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  // Normalise strengths so "500 mg", "500mg", "500MG" collapse together.
  const normStrength = (s: string | null) => (s ?? "").replace(/\s+/g, "").toLowerCase();
  const normForm = (s: string | null) => (s ?? "").toLowerCase().trim();

  const strengths = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      const k = normStrength(p.strength);
      if (k && !seen.has(k)) seen.set(k, p.strength ?? "");
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [products]);

  const forms = useMemo(() => {
    const seen = new Set<string>();
    for (const p of products) {
      const k = normForm(p.dosage_form);
      if (k) seen.add(p.dosage_form ?? "");
    }
    return [...seen].sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return products.filter((p) => {
      if (strengthFilter && normStrength(p.strength) !== normStrength(strengthFilter)) return false;
      if (formFilter && normForm(p.dosage_form) !== normForm(formFilter)) return false;
      if (q) {
        const hay = `${p.product_name ?? ""} ${p.trade_name ?? ""} ${p.sponsor_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, strengthFilter, formFilter, searchQ]);

  // Group filtered by strength → list under each strength heading.
  const grouped = useMemo(() => {
    const buckets = new Map<string, ProductRow[]>();
    for (const p of filtered) {
      const key = p.strength?.trim() || "—";
      const arr = buckets.get(key) ?? [];
      arr.push(p);
      buckets.set(key, arr);
    }
    return [...buckets.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    );
  }, [filtered]);

  return (
    <>
      <div className="products-filters">
        <input
          className="products-search"
          placeholder="Filter by brand or sponsor…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <div className="products-chips">
          {strengths.length > 1 ? (
            <>
              <button
                type="button"
                className={`products-chip${strengthFilter === null ? " on" : ""}`}
                onClick={() => setStrengthFilter(null)}
              >
                All strengths
              </button>
              {strengths.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`products-chip${strengthFilter === s ? " on" : ""}`}
                  onClick={() => setStrengthFilter(s)}
                >
                  {s}
                </button>
              ))}
            </>
          ) : null}
        </div>
        {forms.length > 1 ? (
          <div className="products-chips">
            <button
              type="button"
              className={`products-chip${formFilter === null ? " on" : ""}`}
              onClick={() => setFormFilter(null)}
            >
              All forms
            </button>
            {forms.map((f) => (
              <button
                key={f}
                type="button"
                className={`products-chip${formFilter === f ? " on" : ""}`}
                onClick={() => setFormFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="products-count">
        {filtered.length === products.length
          ? `${products.length} product${products.length === 1 ? "" : "s"}`
          : `${filtered.length} of ${products.length} products`}
      </div>

      <div className="products-list">
        {grouped.map(([strength, rows]) => (
          <div key={strength} className="products-group">
            <div className="products-group-head">
              <span className="products-group-strength">{strength}</span>
              <span className="products-group-count">{rows.length} listing{rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="products-group-rows">
              {rows.slice(0, 24).map((p) => (
                <ProductLine key={p.product_id} p={p} />
              ))}
              {rows.length > 24 ? <div className="pane-row-more">+ {rows.length - 24} more in this strength</div> : null}
            </div>
          </div>
        ))}
        {grouped.length === 0 ? (
          <div className="pane-empty">No products match those filters.</div>
        ) : null}
      </div>
    </>
  );
}

function ProductLine({ p }: { p: ProductRow }) {
  // The product_name is a long registry blob — strip the leading SCREAMING active ingredient
  // when there's a trade_name to lead with instead.
  const lead = p.trade_name?.trim() || p.product_name?.split(/\s+/).slice(0, 4).join(" ") || "Unnamed product";
  const sub = [p.sponsor_name, p.country, p.dosage_form, p.route].filter(Boolean).join(" · ");
  return (
    <div className="products-line">
      <div className="products-line-head">
        <div className="products-line-name">{lead}</div>
        {p.pbs_listed ? <span className="products-line-pill">PBS</span> : null}
        {p.is_generic ? <span className="products-line-pill products-line-pill-neutral">generic</span> : null}
      </div>
      {sub ? <div className="products-line-sub">{sub}</div> : null}
    </div>
  );
}

function RecallRowItem({ recall }: { recall: RecallRow }) {
  return (
    <div className="pane-row">
      <div className="pane-row-head">
        <div className="pane-row-title">{recall.brand_name || recall.generic_name || "Unnamed product"}</div>
        <div className="pane-row-meta">
          {recall.recall_class ? <span className={CLASS_BADGE[recall.recall_class] || "recall-class"}>Class {recall.recall_class}</span> : null}
          {recall.country_code ? <span className="font-mono pane-row-cc">{recall.country_code}</span> : null}
        </div>
      </div>
      <div className="pane-row-dates">
        <span>announced {formatDate(recall.announced_date)}</span>
        {recall.status ? <span>· {recall.status}</span> : null}
        {recall.manufacturer ? <span>· {recall.manufacturer}</span> : null}
      </div>
      {recall.reason ? <div className="pane-row-reason">{recall.reason.length > 220 ? recall.reason.slice(0, 220) + "…" : recall.reason}</div> : null}
      {recall.press_release_url ? (
        <a className="pane-row-source" href={recall.press_release_url} target="_blank" rel="noreferrer noopener">
          press release ↗
        </a>
      ) : null}
    </div>
  );
}
