"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";
import { truncateDrugName } from "@/lib/utils";
import {
  RECENT_EVENT,
  getRecentMedicines,
  getRecentSearches,
  type RecentMedicine,
} from "@/lib/recent-activity";

/**
 * Shared left app-shell sidebar used by the search results page and the drug
 * detail page so both columns stay identical: country picker, Browse links,
 * live Search history + My medicines (from localStorage), and the log-in row.
 *
 * Relies on the `.sb*` CSS that each host page already defines in its scoped
 * `.v1home` style block (including `.sb-sub` for the recent-item rows).
 */
export default function V1Sidebar() {
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentMedicines, setRecentMedicines] = useState<RecentMedicine[]>([]);

  useEffect(() => {
    const refresh = () => {
      setRecentSearches(getRecentSearches());
      setRecentMedicines(getRecentMedicines());
    };
    refresh();
    window.addEventListener(RECENT_EVENT, refresh);
    return () => window.removeEventListener(RECENT_EVENT, refresh);
  }, []);

  return (
    <aside className="sb">
      <div className="sb-top">
        <Link href="/" className="brand" aria-label="Mederti home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" className="logo-img" />
        </Link>
      </div>
      <div style={{ padding: "14px 14px 8px 16px" }}><V1CountryPicker /></div>
      <div className="sb-scroll">
        <div className="sb-group">
          <div className="sb-glabel">Browse</div>
          <Link href="/chat?view=early-warning" className="sb-item"><span className="sb-dot green" />Intelligence</Link>
          <Link href="/chat?view=dashboard" className="sb-item"><span className="sb-dot green" />Dashboard</Link>
        </div>
        <div className="sb-group">
          <div className="sb-glabel">Search history</div>
          {recentSearches.length > 0 ? (
            recentSearches.map((term) => (
              <Link
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                className="sb-item sb-sub"
              >
                {truncateDrugName(term, 28)}
              </Link>
            ))
          ) : (
            <div className="sb-item sb-empty">No recent searches</div>
          )}
        </div>
        <div className="sb-group">
          <div className="sb-glabel">My medicines</div>
          {recentMedicines.length > 0 ? (
            recentMedicines.map((m) => (
              <Link key={m.id} href={`/drugs/${m.id}`} className="sb-item sb-sub">
                {truncateDrugName(m.name, 28)}
              </Link>
            ))
          ) : (
            <Link href="/login" className="sb-item sb-empty">Sign in to save medicines</Link>
          )}
        </div>
      </div>
      <Link href="/login" className="sb-profile">Log in →</Link>
    </aside>
  );
}
