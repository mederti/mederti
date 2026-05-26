"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DrugDetailBundle, ShortageRow, SubstituteWithSuppliers } from "@/lib/chat/types";
import {
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Close,
  ExternalLink,
  MoreDots,
  Plus,
  ChatBubble,
} from "./icons";
import {
  addDrugToWatchlist,
  createWatchlist,
  removeDrugFromWatchlist,
  useWatchlists,
  type WatchlistStatus,
} from "../watchlistStore";

const FLAG_BY_CC: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", CA: "🇨🇦", NL: "🇳🇱", IE: "🇮🇪", NZ: "🇳🇿", SE: "🇸🇪",
  NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", CH: "🇨🇭", AT: "🇦🇹", BE: "🇧🇪",
  PT: "🇵🇹", PL: "🇵🇱", CZ: "🇨🇿", HU: "🇭🇺", JP: "🇯🇵", KR: "🇰🇷",
  SG: "🇸🇬", BR: "🇧🇷", MX: "🇲🇽", ZA: "🇿🇦", NG: "🇳🇬", SA: "🇸🇦",
  IL: "🇮🇱", IN: "🇮🇳", CN: "🇨🇳",
};

function flagFor(cc: string | null | undefined) {
  if (!cc) return "🌐";
  return FLAG_BY_CC[cc.toUpperCase()] || "🌐";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

type Availability = "red" | "amber" | "green";
function availabilityFromShortage(s: ShortageRow | undefined): Availability {
  if (!s) return "green";
  const status = (s.status || "").toLowerCase();
  const sev = (s.severity || "").toLowerCase();
  if (status === "resolved" || status === "closed") return "green";
  if (sev === "critical" || sev === "high") return "red";
  if (status === "active") return "amber";
  return "amber";
}

function availabilityLabel(a: Availability): string {
  return a === "red" ? "Not available" : a === "amber" ? "Limited" : "Available";
}

function availabilityColor(a: Availability) {
  return a === "red"
    ? { text: "text-red-600", bg: "bg-red-50", border: "border-red-200" }
    : a === "amber"
    ? { text: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200" }
    : { text: "text-green-600", bg: "bg-green-50", border: "border-green-200" };
}

function worstAvailability(shortages: ShortageRow[]): Availability {
  let worst: Availability = "green";
  for (const s of shortages) {
    const a = availabilityFromShortage(s);
    if (a === "red") return "red";
    if (a === "amber") worst = "amber";
  }
  return worst;
}

// Product label / package image. Fetches lazily from /api/drug-image
// (DailyMed/NIH source, cached 24h). Silently returns null on miss so we
// don't leave a broken card behind — many drugs simply don't have a US
// label image available.
function Chat2DrugImage({ name }: { name: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setImageUrl(null);
    setLoaded(false);
    fetch(`/api/drug-image?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.imageUrl) setImageUrl(data.imageUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox]);

  if (!imageUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setLightbox(true)}
        className="block w-full mb-3.5 rounded-xl overflow-hidden border border-slate-200 bg-white cursor-zoom-in hover:border-slate-300 transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`${name} product label`}
          onLoad={() => setLoaded(true)}
          style={{
            width: "100%",
            maxHeight: 180,
            objectFit: "contain",
            display: "block",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.25s",
            padding: 8,
            background: "#fff",
          }}
        />
        <div className="text-[9px] text-slate-400 text-center py-1.5 border-t border-slate-100 font-mono" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
          DAILYMED · NIH · CLICK TO ENLARGE
        </div>
      </button>
      {lightbox
        ? createPortal(
            <div
              onClick={() => setLightbox(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 99999,
                background: "rgba(0,0,0,0.85)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "zoom-out",
                padding: 24,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(false);
                }}
                style={{
                  position: "absolute",
                  top: 16,
                  right: 16,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  color: "#fff",
                  fontSize: 20,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`${name} product label`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  maxWidth: "90vw",
                  maxHeight: "90vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  cursor: "default",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                  background: "#fff",
                  padding: 12,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 20,
                  fontSize: 11,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                Source: DailyMed / NIH
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function StatusCard({ bundle }: { bundle: DrugDetailBundle }) {
  const a = worstAvailability(bundle.drug.shortages);
  const c = availabilityColor(a);
  const title =
    a === "red" ? "Critical shortage" : a === "amber" ? "Limited supply" : "Available";
  const sub =
    bundle.drug.shortages.find((s) => s.reason)?.reason ||
    `${bundle.drug.active_shortage_count} active shortage${bundle.drug.active_shortage_count === 1 ? "" : "s"} across ${bundle.drug.countries_affected.length} countries`;
  return (
    <div className={`${c.bg} ${c.border} border rounded-xl px-4 py-3.5 mb-3.5`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest mb-1 ${c.text}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {availabilityLabel(a)}
      </div>
      <div className="text-[18px] font-semibold text-slate-900 tracking-tight mb-px">{title}</div>
      <div className="text-[12px] text-slate-500">{sub}</div>
    </div>
  );
}

function AddToWatchlistButton({
  drugId,
  drugName,
  drugStatus,
}: {
  drugId: string;
  drugName: string;
  drugStatus: WatchlistStatus;
}) {
  const [open, setOpen] = useState(false);
  const watchlists = useWatchlists();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (watchlistId: string, currentlyIn: boolean) => {
    if (currentlyIn) {
      removeDrugFromWatchlist(watchlistId, drugId);
    } else {
      addDrugToWatchlist(watchlistId, { drug_id: drugId, drug_name: drugName, status: drugStatus });
    }
  };

  const handleCreateAndAdd = () => {
    const name = window.prompt("Watchlist name", "My Watchlist");
    if (name == null) return;
    const wl = createWatchlist(name);
    addDrugToWatchlist(wl.id, { drug_id: drugId, drug_name: drugName, status: drugStatus });
    setOpen(false);
  };

  // True if the drug is in at least one watchlist — used for button label
  const isWatched = watchlists.some((wl) => wl.items.some((i) => i.drug_id === drugId));

  return (
    <div ref={wrapRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-medium border transition-colors ${
          isWatched
            ? "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100"
            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
        }`}
      >
        <Bookmark size={13} />
        {isWatched ? "Watching" : "Add to watchlist"}
        <ChevronDown size={10} />
      </button>
      {open ? (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl p-1.5 z-30"
          style={{ boxShadow: "0 10px 30px rgba(15,23,42,0.08), 0 3px 10px rgba(15,23,42,0.04)" }}
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-400 px-2.5 pt-1.5 pb-1">
            {watchlists.length === 0 ? "No watchlists yet" : `Add ${drugName} to`}
          </div>
          {watchlists.map((wl) => {
            const checked = wl.items.some((i) => i.drug_id === drugId);
            return (
              <button
                key={wl.id}
                type="button"
                onClick={() => toggle(wl.id, checked)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12.5px] text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-left"
              >
                <span
                  className={`w-3.5 h-3.5 rounded inline-flex items-center justify-center shrink-0 border ${
                    checked
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {checked ? <Check size={9} /> : null}
                </span>
                <span className="flex-1">{wl.name}</span>
                <span
                  className="text-[10px] text-slate-400"
                  style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
                >
                  {wl.items.length}
                </span>
              </button>
            );
          })}
          <div className="h-px bg-slate-200 my-1" />
          <button
            type="button"
            onClick={handleCreateAndAdd}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-teal-600 font-medium hover:bg-teal-50"
          >
            <Plus size={11} />
            {watchlists.length === 0 ? "Create a watchlist…" : "New watchlist…"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
      {children}
    </span>
  );
}

function CountryRow({ s }: { s: ShortageRow }) {
  const a = availabilityFromShortage(s);
  const c = availabilityColor(a);
  return (
    <div className="flex items-center justify-between px-2.5 py-2 bg-white border border-slate-200 rounded-lg mb-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[15px]">{flagFor(s.country_code)}</span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-slate-900 truncate">{s.country}</div>
          <div
            className="text-[10px] text-slate-400"
            style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
          >
            {(s.country_code || "—").toUpperCase()} · {timeAgo(s.start_date)}
          </div>
        </div>
      </div>
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${c.text}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {availabilityLabel(a)}
      </div>
    </div>
  );
}

function AltCard({
  alt,
  onClick,
}: {
  alt: SubstituteWithSuppliers;
  onClick: (id: string) => void;
}) {
  const avail = alt.active_shortage_count > 0 ? "lim" : "yes";
  const match =
    alt.similarity_score != null ? `${Math.round(alt.similarity_score * 100)}% match` : "—";
  return (
    <button
      type="button"
      onClick={() => onClick(alt.drug_id)}
      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white border border-slate-200 hover:border-teal-400 mb-1.5 transition-colors text-left"
    >
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-slate-900 truncate">{alt.name}</div>
        <div
          className="text-[10px] text-slate-400"
          style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
        >
          {alt.drug_class || alt.atc_code || "alternative"}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 pl-2">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
            avail === "yes"
              ? "bg-green-50 text-green-600 border-green-200"
              : "bg-yellow-50 text-yellow-700 border-yellow-200"
          }`}
        >
          {avail === "yes" ? "Available" : "Limited"}
        </span>
        <span
          className="text-[9px] text-slate-400"
          style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
        >
          {match}
        </span>
      </div>
    </button>
  );
}

// External identifiers — universal cross-reference codes a pharmacist /
// procurement lead / supplier looks up in upstream systems (CAS in chemistry
// catalogues, UNII at the FDA GSRS, EMA product number in the EU EPAR,
// RxCUI in RxNav, SNOMED in clinical terminologies, ChEMBL in research).
// Click-to-copy because the destination is almost always another tool's
// search bar. Coverage is partial — only keys with non-null values surface.
const ID_LABELS: Record<string, string> = {
  atc_code: "ATC",
  atc_code_full: "ATC (full)",
  rxcui: "RxCUI",
  unii: "UNII",
  cas_number: "CAS",
  ema_product_number: "EMA",
  snomed_ct_code: "SNOMED CT",
  chembl_id: "ChEMBL",
};
function IdentifiersSection({
  drug,
  onToast,
}: {
  drug: import("@/lib/chat/types").DrugDetail;
  onToast: (msg: string) => void;
}) {
  const ids = drug.external_identifiers;
  if (!ids) return null;
  const items: Array<{ key: string; label: string; value: string }> = [];
  for (const [k, label] of Object.entries(ID_LABELS)) {
    const v = ids[k as keyof typeof ids];
    if (typeof v === "string" && v.trim()) {
      items.push({ key: k, label, value: v });
    }
  }
  if (items.length === 0) return null;
  const onCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast(`${label} copied`);
    } catch {
      onToast(`Couldn't copy ${label}`);
    }
  };
  return (
    <div className="mb-4.5" style={{ marginBottom: 18 }}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
        Identifiers
      </div>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onCopy(it.label, it.value)}
            className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-slate-50 text-left first:rounded-t-xl last:rounded-b-xl transition-colors group"
            title="Click to copy"
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {it.label}
            </span>
            <span
              className="text-[12px] text-slate-700 group-hover:text-slate-900 tabular-nums"
              style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
            >
              {it.value}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreviewPane({
  drugId,
  onClose,
  onOpenDrug,
  onAskAbout,
  onToast,
}: {
  drugId: string;
  onClose: () => void;
  onOpenDrug: (id: string) => void;
  onAskAbout: (drugName: string) => void;
  onToast: (msg: string) => void;
}) {
  const [bundle, setBundle] = useState<DrugDetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setBundle(null);
    fetch(`/api/drug/${drugId}?country=AU`)
      .then((r) => r.json())
      .then((data: DrugDetailBundle) => {
        if (cancelled) return;
        if ((data as any).error) setErr((data as any).error);
        else setBundle(data);
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

  return (
    <aside
      className="w-[420px] shrink-0 bg-slate-50/40 border-l border-slate-200 flex flex-col h-screen animate-in slide-in-from-right-4 fade-in duration-200"
      style={{ animationFillMode: "both" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Close preview"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Product preview
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={bundle?.drug ? `/drugs/${bundle.drug.drug_id}` : `/drugs/${drugId}`}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Open in full view"
          >
            <ExternalLink size={14} />
          </Link>
          <button
            type="button"
            onClick={() => onToast("More — coming soon")}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="More"
          >
            <MoreDots size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Close"
          >
            <Close size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4.5 pb-6" style={{ padding: "18px 20px 24px" }}>
        {loading ? (
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-6 bg-slate-200 rounded w-2/3" />
            <div className="h-3 bg-slate-200 rounded w-1/3" />
            <div className="h-20 bg-slate-200 rounded-xl mt-3" />
            <div className="h-10 bg-slate-200 rounded-lg mt-2" />
          </div>
        ) : err ? (
          <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            Couldn&apos;t load drug data: {err}
          </div>
        ) : !bundle ? (
          <div className="text-[13px] text-slate-500">No data.</div>
        ) : (
          <>
            {/* Identity */}
            <div className="text-[20px] font-semibold tracking-tight text-slate-900 leading-tight mb-1">
              {bundle.drug.name}
            </div>
            <div className="text-[12px] text-slate-500 mb-3">
              {[bundle.drug.generic_name, bundle.drug.dosage_forms?.[0], bundle.drug.strengths?.[0]]
                .filter(Boolean)
                .join(" · ") || bundle.drug.atc_code || "—"}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {bundle.drug.therapeutic_category ? <Tag>{bundle.drug.therapeutic_category}</Tag> : null}
              {bundle.drug.dosage_forms?.[0] ? <Tag>{bundle.drug.dosage_forms[0]}</Tag> : null}
              {bundle.drug.who_essential_medicine ? <Tag>WHO Essential</Tag> : null}
              {bundle.drug.critical_medicine_eu ? <Tag>EU Critical</Tag> : null}
              {!bundle.drug.therapeutic_category && bundle.drug.atc_code ? (
                <Tag>{bundle.drug.atc_code}</Tag>
              ) : null}
            </div>

            {/* Product label image — lazy-fetched, hidden if DailyMed has nothing */}
            <Chat2DrugImage name={bundle.drug.generic_name || bundle.drug.name} />

            {/* Status */}
            <StatusCard bundle={bundle} />

            {/* Actions */}
            <div className="flex gap-2 mb-4">
              <AddToWatchlistButton
                drugId={bundle.drug.drug_id}
                drugName={bundle.drug.name}
                drugStatus={worstAvailability(bundle.drug.shortages)}
              />
              <button
                type="button"
                onClick={() => onToast("Alerts — coming soon")}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-medium bg-teal-600 text-white hover:bg-teal-500 transition-colors"
              >
                <Bell size={13} />
                Set alert
              </button>
            </div>

            {/* AI insight */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3.5 py-3 mb-4.5" style={{ marginBottom: 18 }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600 mb-1.5 flex items-center gap-1.5">
                ✦ AI insight
              </div>
              <p className="text-[12px] text-slate-700 leading-relaxed">
                <strong className="font-medium text-slate-900">{bundle.drug.name}</strong>{" "}
                {bundle.drug.active_shortage_count > 0
                  ? `has ${bundle.drug.active_shortage_count} active shortage${bundle.drug.active_shortage_count === 1 ? "" : "s"} across ${bundle.drug.countries_affected.length} ${
                      bundle.drug.countries_affected.length === 1 ? "country" : "countries"
                    }.`
                  : "currently has no active shortages on file."}{" "}
                {bundle.substitutes[0] ? (
                  <>
                    Closest substitute:{" "}
                    <strong className="font-medium text-slate-900">{bundle.substitutes[0].name}</strong>
                    {bundle.substitutes[1] ? (
                      <>
                        {" "}or{" "}
                        <strong className="font-medium text-slate-900">{bundle.substitutes[1].name}</strong>
                      </>
                    ) : null}
                    .
                  </>
                ) : null}
              </p>
            </div>

            {/* ETA — placed directly under the AI insight so the headline
                ("when will it come back?") sits next to the explanation
                that introduces it. Country breakdown follows below. */}
            {(() => {
              const eta = bundle.drug.shortages.find((s) => s.estimated_resolution_date);
              if (!eta?.estimated_resolution_date) return null;
              const conf = Math.min(95, 50 + bundle.drug.shortages.length * 4);
              return (
                <div className="mb-4.5" style={{ marginBottom: 18 }}>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
                    Expected return
                  </div>
                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3.5">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                        Forecast
                      </div>
                      <div className="text-[17px] font-semibold text-slate-900 tracking-tight">
                        {new Date(eta.estimated_resolution_date).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div
                        className="text-[10px] text-slate-400 mt-0.5"
                        style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
                      >
                        {bundle.drug.shortages.length} report{bundle.drug.shortages.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                        Confidence
                      </div>
                      <div
                        className="text-[18px] font-medium text-teal-600"
                        style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}
                      >
                        {conf}
                        <span className="text-[9px] text-slate-400">/100</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Identifiers — every populated external_identifier (ATC, CAS,
                UNII, RxCUI, EMA product number, SNOMED, ChEMBL) with a click-
                to-copy affordance. Coverage is partial; the section silently
                hides when the drug has no identifiers on file. */}
            <IdentifiersSection drug={bundle.drug} onToast={onToast} />

            {/* Country availability */}
            {bundle.drug.shortages.length > 0 ? (
              <div className="mb-4.5" style={{ marginBottom: 18 }}>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
                  Availability by country
                </div>
                {bundle.drug.shortages.slice(0, 6).map((s, i) => (
                  <CountryRow key={`${s.country_code || "x"}-${i}`} s={s} />
                ))}
              </div>
            ) : null}

            {/* Alternatives */}
            {bundle.substitutes.length > 0 ? (
              <div className="mb-4.5" style={{ marginBottom: 18 }}>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
                  Alternatives
                </div>
                {bundle.substitutes.slice(0, 3).map((s) => (
                  <AltCard key={s.drug_id} alt={s} onClick={onOpenDrug} />
                ))}
              </div>
            ) : null}

            {/* Ask the chat about this drug */}
            <button
              type="button"
              onClick={() => onAskAbout(bundle.drug.name)}
              className="w-full mt-1.5 px-3 py-2.5 bg-white border border-dashed border-slate-300 rounded-lg flex items-center gap-2 text-[11.5px] text-slate-500 hover:border-teal-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
            >
              <ChatBubble size={13} />
              <span>Ask the chat about {bundle.drug.name} →</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
