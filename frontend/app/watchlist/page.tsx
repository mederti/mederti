"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bookmark, LogIn, Search, Trash2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import SiteNav from "@/app/components/landing-nav";

interface WatchItem {
  id: string;
  drug_id: string;
  generic_name: string | null;
  brand_names: string[] | null;
}

const ICON = { width: 15, height: 15, strokeWidth: 1.5 } as const;

export default function WatchlistPage() {
  const [authed, setAuthed]     = useState<boolean | null>(null);
  const [items, setItems]       = useState<WatchItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const supabase = createBrowserClient();

  const loadWatchlist = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    setAuthed(true);

    const { data } = await supabase
      .from("user_watchlists")
      .select("id, drug_id, drugs(drug_id, generic_name, brand_names)")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setItems((data as any[]).map((row) => {
        const drug = Array.isArray(row.drugs) ? row.drugs[0] ?? null : row.drugs ?? null;
        return {
          id: row.id as string,
          drug_id: (drug?.drug_id as string | undefined) ?? (row.drug_id as string),
          generic_name: (drug?.generic_name as string | undefined) ?? null,
          brand_names: (drug?.brand_names as string[] | undefined) ?? null,
        };
      }));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  async function handleRemove(id: string) {
    setRemoving(id);
    await supabase
      .from("user_watchlists")
      .update({ is_active: false })
      .eq("id", id);
    setItems(prev => prev.filter(item => item.id !== id));
    setRemoving(null);
  }

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>

      {/* Hero */}
      <div style={{ background: "var(--navy)" }}>
        <SiteNav />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Bookmark style={{ width: 20, height: 20, color: "var(--teal-l)" }} strokeWidth={1.8} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>Watchlist</h1>
          </div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: 0 }}>
            Drugs you are monitoring for shortage and recall updates.
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>

        {/* Loading */}
        {(authed === null || loading) && (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              border: "2px solid var(--teal)", borderTopColor: "transparent",
              animation: "spin 0.7s linear infinite",
              margin: "0 auto",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Not signed in */}
        {!loading && authed === false && (
          <div style={{
            background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12,
            padding: "64px 24px", textAlign: "center", maxWidth: 460, margin: "0 auto",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 18px",
            }}>
              <Bookmark style={{ width: 22, height: 22 }} color="var(--teal)" strokeWidth={1.6} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", margin: "0 0 8px" }}>
              Sign in to view your watchlist
            </h2>
            <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 24, lineHeight: 1.6 }}>
              Watch drugs to get shortage alerts and track availability across global regulators.
            </p>
            <Link href="/login?next=/watchlist" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 8,
              background: "var(--teal)", color: "#fff",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
            }}>
              <LogIn {...ICON} />
              Sign in
            </Link>
          </div>
        )}

        {/* Signed in, empty */}
        {!loading && authed === true && items.length === 0 && (
          <div style={{
            background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12,
            padding: "64px 24px", textAlign: "center", maxWidth: 460, margin: "0 auto",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 18px",
            }}>
              <Bookmark style={{ width: 22, height: 22 }} color="var(--app-text-4)" strokeWidth={1.6} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", margin: "0 0 8px" }}>
              Your watchlist is empty
            </h2>
            <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 24, lineHeight: 1.6 }}>
              Search for drugs and click Watch to add them here.
            </p>
            <Link href="/search" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 8,
              background: "var(--teal)", color: "#fff",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
            }}>
              <Search {...ICON} />
              Search drugs
            </Link>
          </div>
        )}

        {/* Signed in, has items */}
        {!loading && authed === true && items.length > 0 && (
          <div style={{
            background: "var(--panel)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "1px solid var(--app-border)", background: "var(--app-bg)",
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text-2)" }}>
                {items.length} drug{items.length !== 1 ? "s" : ""} on your watchlist
              </span>
              <Link href="/search" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 13, color: "var(--teal)", fontWeight: 500, textDecoration: "none",
              }}>
                <Search {...ICON} color="var(--teal)" />
                Add more
              </Link>
            </div>

            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 16,
              padding: "9px 20px",
              borderBottom: "1px solid var(--app-border)",
              background: "var(--app-bg)",
            }}>
              {["Drug", "Brand", ""].map((col, i) => (
                <span key={i} style={{
                  fontSize: 11, fontWeight: 600, color: "var(--app-text-4)",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {col}
                </span>
              ))}
            </div>

            {/* Rows */}
            {items.map((item, i) => (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 16,
                  padding: "13px 20px",
                  alignItems: "center",
                  borderBottom: i < items.length - 1 ? "1px solid var(--app-border)" : "none",
                  transition: "background 0.1s",
                }}
                className="watchlist-row"
              >
                {/* Drug name */}
                <Link href={`/drugs/${item.drug_id}`} style={{ textDecoration: "none" }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>
                    {item.generic_name ?? `Drug ${item.drug_id.slice(0, 8)}\u2026`}
                  </div>
                </Link>

                {/* Brand name */}
                <div style={{ fontSize: 12, color: "var(--app-text-4)", minWidth: 120, textAlign: "right" }}>
                  {item.brand_names?.[0] ?? "—"}
                </div>

                {/* Remove button */}
                <button
                  onClick={() => handleRemove(item.id)}
                  disabled={removing === item.id}
                  title="Remove from watchlist"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 7,
                    border: "1px solid var(--app-border)",
                    background: removing === item.id ? "var(--app-bg-2)" : "#fff",
                    cursor: removing === item.id ? "not-allowed" : "pointer",
                    color: "var(--app-text-4)",
                    transition: "background 0.1s, border-color 0.1s",
                    padding: 0,
                  }}
                  className="remove-btn"
                >
                  <Trash2 style={{ width: 13, height: 13 }} strokeWidth={1.6} color={removing === item.id ? "var(--app-text-4)" : "var(--crit)"} />
                </button>
              </div>
            ))}

            {/* Footer */}
            <div style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-bg)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Link href="/alerts" style={{ fontSize: 13, color: "var(--teal)", fontWeight: 500, textDecoration: "none" }}>
                Manage alert preferences
              </Link>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .watchlist-row:hover { background: var(--app-bg) !important; }
        .remove-btn:hover:not(:disabled) { background: var(--crit-bg) !important; border-color: var(--crit-b) !important; }
      `}</style>
    </div>
  );
}
