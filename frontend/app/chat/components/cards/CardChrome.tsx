"use client";

import { useContext, useEffect, useRef, useState } from "react";
import type { DrugDetail, Persona, ShortageRow } from "@/lib/chat/types";
import { PersonaToggle } from "../PersonaToggle";
import { PaneContext } from "../PaneContext";
import { SEV_TAG_CLASS, isDrugAvailable, pickPrimary } from "../cardUtils";
import { Bookmark, Check, Plus } from "../icons";
import {
  addDrugToWatchlist,
  createWatchlist,
  removeDrugFromWatchlist,
  useWatchlists,
  type WatchlistStatus,
} from "../../watchlistStore";

// Match PreviewPane.worstAvailability so the saved status is consistent
// across the centre card and the right preview pane.
function deriveWatchlistStatus(shortages: ShortageRow[]): WatchlistStatus {
  let worst: WatchlistStatus = "green";
  for (const s of shortages) {
    const status = (s.status || "").toLowerCase();
    if (status === "resolved" || status === "closed") continue;
    const sev = (s.severity || "").toLowerCase();
    if (sev === "critical" || sev === "high") return "red";
    if (status === "active") worst = "amber";
  }
  return worst;
}

// Shared header: name + WHO badge + status tag + persona toggle (top-right).
export function CardHeader({
  drug,
  persona,
  onPersonaChange,
  showATCLine = true,
  showBrands = true,
}: {
  drug: DrugDetail;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
  showATCLine?: boolean;
  showBrands?: boolean;
}) {
  const pane = useContext(PaneContext);
  const primary = pickPrimary(drug.shortages);
  const available = isDrugAvailable(drug, "AU");
  const status = available ? "available" : primary?.severity || "medium";
  const statusClass = available ? "tag-status available" : (SEV_TAG_CLASS[primary?.severity || "medium"] || "tag-status medium");
  const statusLabel = available ? "AVAILABLE" : (primary?.severity || "active").toUpperCase();

  return (
    <div className="card-head">
      <div className="card-title-row">
        <div className="card-name">
          <button
            type="button"
            className="card-name-link"
            onClick={() => pane?.open(drug.drug_id)}
            aria-label={`Open ${drug.name} details`}
          >
            {drug.name}
          </button>
          {drug.who_essential_medicine ? <span className="tag-who">WHO ESSENTIAL</span> : null}
          {drug.critical_medicine_eu ? <span className="tag-who" style={{ background: "var(--crit-bg)", color: "var(--crit)", borderColor: "var(--crit-b)" }}>EU CRITICAL</span> : null}
        </div>
        <div className="card-head-right">
          <CardWatchlistIconButton
            drugId={drug.drug_id}
            drugName={drug.name}
            drugStatus={deriveWatchlistStatus(drug.shortages)}
          />
          <PersonaToggle value={persona} onChange={onPersonaChange} disabled={available ? ["supplier"] : []} />
          <span className={statusClass}>{statusLabel}</span>
        </div>
      </div>
      {showATCLine && drug.atc_code ? (
        <div className="card-meta">
          {drug.atc_code}{drug.atc_description ? ` · ${drug.atc_description}` : ""}
          {drug.drug_class && drug.drug_class !== drug.atc_description ? ` · ${drug.drug_class}` : ""}
        </div>
      ) : null}
      {showBrands && drug.brand_names.length > 0 ? (
        <div className="card-brands"><em>brands</em>{drug.brand_names.slice(0, 6).join(", ")}</div>
      ) : null}
    </div>
  );
}

// Status panel — amber when in shortage, green when available.
export function StatusPanel({
  drug,
  country = "AU",
  variant = "default",
}: {
  drug: DrugDetail;
  country?: string;
  variant?: "default" | "available";
}) {
  const available = variant === "available" || isDrugAvailable(drug, country);
  const primary = pickPrimary(drug.shortages);
  if (available) {
    const supplierCount = (drug as any).supplier_count ?? null;
    return (
      <div className="card-a-status available">
        <div className="card-a-status-headline">
          <span className="card-a-status-dot" />
          Available in {country}
        </div>
        <div className="card-a-status-dates">
          <span className="card-a-status-supply">
            {supplierCount != null ? `${supplierCount} supplier${supplierCount === 1 ? "" : "s"} active · ` : ""}stable supply
          </span>
        </div>
      </div>
    );
  }
  if (!primary) return null;
  return (
    <div className="card-a-status">
      <div className="card-a-status-headline">
        <span className="card-a-status-dot" />
        Not available in {country}
      </div>
      <div className="card-a-status-dates">
        {primary.start_date ? (
          <>
            <span className="card-a-status-pre">Since</span>
            <span className="card-a-status-val">{formatDateShort(primary.start_date)}</span>
          </>
        ) : null}
        {primary.estimated_resolution_date ? (
          <>
            <span className="card-a-status-sep">·</span>
            <span className="card-a-status-pre">Est. return</span>
            <span className="card-a-status-val">{formatDateShort(primary.estimated_resolution_date)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function formatDateShort(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

// Reuse pane button context.
export function useOpenPane() {
  const pane = useContext(PaneContext);
  return (id: string) => pane?.open(id);
}

// Icon-only "Add to watchlist" trigger that lives in the card header. Mirrors
// the dropdown behaviour of PreviewPane.AddToWatchlistButton but in a compact
// shape suited to the centre product card — so users can save the drug to a
// left-nav watchlist mid-chat without leaving the conversation.
function CardWatchlistIconButton({
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

  const isWatched = watchlists.some((wl) => wl.items.some((i) => i.drug_id === drugId));

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

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={isWatched ? `${drugName} is in a watchlist — manage` : `Add ${drugName} to watchlist`}
        title={isWatched ? "Watching — manage watchlists" : "Add to watchlist"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          border: `1px solid ${isWatched ? "var(--low-b, #bbf7d0)" : "var(--border, #e5e7eb)"}`,
          background: isWatched ? "var(--low-bg, #ecfdf5)" : "transparent",
          color: isWatched ? "var(--teal, #0d9488)" : "var(--text-3, #64748b)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <Bookmark size={13} />
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 220,
            background: "var(--bg-1, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 12,
            padding: 6,
            zIndex: 30,
            boxShadow: "0 10px 30px rgba(15,23,42,0.08), 0 3px 10px rgba(15,23,42,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-4, #94a3b8)",
              padding: "6px 10px 4px",
            }}
          >
            {watchlists.length === 0 ? "No watchlists yet" : `Add ${drugName} to`}
          </div>
          {watchlists.map((wl) => {
            const checked = wl.items.some((i) => i.drug_id === drugId);
            return (
              <button
                key={wl.id}
                type="button"
                onClick={() => toggle(wl.id, checked)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  color: "var(--text-2, #334155)",
                  background: "transparent",
                  border: 0,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: `1px solid ${checked ? "var(--teal, #0d9488)" : "var(--border, #cbd5e1)"}`,
                    background: checked ? "var(--teal, #0d9488)" : "var(--bg-1, #fff)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {checked ? <Check size={9} /> : null}
                </span>
                <span style={{ flex: 1 }}>{wl.name}</span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-4, #94a3b8)",
                    fontFamily: "var(--font-dm-mono), ui-monospace, monospace",
                  }}
                >
                  {wl.items.length}
                </span>
              </button>
            );
          })}
          <div style={{ height: 1, background: "var(--border, #e5e7eb)", margin: "4px 0" }} />
          <button
            type="button"
            onClick={handleCreateAndAdd}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--teal, #0d9488)",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Plus size={11} />
            {watchlists.length === 0 ? "Create a watchlist…" : "New watchlist…"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
