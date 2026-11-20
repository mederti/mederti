"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type DrugTab = {
  id: string;
  label: string;
  /** Short real count/status shown beside the label. Never a placeholder. */
  badge?: string;
  badgeTone?: "crit" | "med" | "ok" | "muted";
  content: ReactNode;
};

/*
 * Tabbed body of the drug page. The panels are server-rendered and all
 * present in the HTML (inactive ones carry `hidden`), so print, find-in-page
 * after switching, and in-page anchors keep working: a hash that names a tab
 * (#prices) or any element inside a panel (#trade-price, #alternatives)
 * selects that panel and scrolls to the element.
 */
export function DrugTabs({ tabs }: { tabs: DrugTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const rootRef = useRef<HTMLDivElement>(null);
  const ids = tabs.map((t) => t.id).join("|");

  const syncFromHash = useCallback((hash: string) => {
    const h = decodeURIComponent(hash.replace(/^#/, ""));
    if (!h) return;
    if (ids.split("|").includes(h)) {
      setActive(h);
      return;
    }
    const el = document.getElementById(h);
    const panel = el?.closest<HTMLElement>("[data-tab-panel]");
    if (el && panel?.dataset.tabPanel) {
      setActive(panel.dataset.tabPanel);
      // Wait for the panel to un-hide before scrolling to the target.
      requestAnimationFrame(() => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }, [ids]);

  useEffect(() => {
    // Initial deep link (#prices) — after paint, so SSR markup hydrates as-is.
    const raf = requestAnimationFrame(() => syncFromHash(window.location.hash));
    const onHash = () => syncFromHash(window.location.hash);
    // Clicking the same #anchor twice fires no hashchange — catch the click too.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href^='#']");
      if (a) syncFromHash(a.getAttribute("href") ?? "");
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, [syncFromHash]);

  const select = (id: string, focus = false) => {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) rootRef.current?.querySelector<HTMLButtonElement>(`#dtab-${id}`)?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
        : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home" ? 0
            : e.key === "End" ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].id, true);
  };

  return (
    <div className="dtabs" ref={rootRef}>
      <div className="dtabs-bar">
        <div className="dtabs-list" role="tablist" aria-label="Drug page sections" onKeyDown={onKey}>
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                id={`dtab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`dpanel-${t.id}`}
                tabIndex={on ? 0 : -1}
                className={`dtab${on ? " on" : ""}`}
                onClick={() => select(t.id)}
              >
                {t.label}
                {t.badge && <span className={`dtab-badge ${t.badgeTone ?? "muted"}`}>{t.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((t) => (
        <section
          key={t.id}
          id={`dpanel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`dtab-${t.id}`}
          data-tab-panel={t.id}
          hidden={t.id !== active}
          className="dtabs-panel"
        >
          <h2 className="dtabs-print-h">{t.label}</h2>
          {t.content}
        </section>
      ))}
    </div>
  );
}
