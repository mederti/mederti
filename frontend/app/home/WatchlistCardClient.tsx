"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { Bookmark, Bell, ExternalLink, LogIn } from "lucide-react";

interface WatchItem {
  id: string;
  drug_id: string;
  generic_name: string | null;
  brand_names: string[] | null;
}

export default function WatchlistCardClient() {
  const [items, setItems]   = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);

  const supabase = createBrowserClient();

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAuthed(false);
        setLoading(false);
        return;
      }
      setAuthed(true);

      // Fetch watchlist + join drug name
      const { data } = await supabase
        .from("user_watchlists")
        .select("id, drug_id, drugs(drug_id, generic_name, brand_names)")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(5);

      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setItems((data as any[]).map((row) => {
          // Supabase returns the FK join as an object (1:1) or null
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
    }
    load();
  }, []);

  const ICON = { width: 15, height: 15, strokeWidth: 1.5 } as const;

  // Not yet determined
  if (authed === null || loading) {
    return (
      <div style={{ padding: "32px 20px", textAlign: "center" }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--teal)", borderTopColor: "transparent", animation: "spin 0.7s linear infinite", margin: "0 auto" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Not signed in
  if (!authed) {
    return (
      <div style={{ padding: "28px 20px", textAlign: "center" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 14px",
        }}>
          <Bookmark {...ICON} color="var(--teal)" style={{ width: 20, height: 20 }} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)", marginBottom: 6 }}>
          Your watchlist
        </div>
        <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 18, lineHeight: 1.5 }}>
          Sign in to watch drugs and get shortage alerts the moment they change.
        </div>
        <Link href="/login?next=/home" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "9px 18px", borderRadius: 8,
          background: "var(--teal)", color: "#fff",
          fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          <LogIn {...ICON} />
          Sign in
        </Link>
      </div>
    );
  }

  // Signed in — empty
  if (items.length === 0) {
    return (
      <div style={{ padding: "28px 20px", textAlign: "center" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 12px",
        }}>
          <Bookmark {...ICON} color="var(--app-text-4)" style={{ width: 20, height: 20 }} />
        </div>
        <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.5 }}>
          No drugs on your watchlist yet.
        </div>
        <Link href="/search" style={{
          display: "inline-block", marginTop: 14,
          fontSize: 13, color: "var(--teal)", fontWeight: 500, textDecoration: "none",
        }}>
          Browse drugs to watch
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map(item => (
        <Link key={item.id} href={`/drugs/${item.drug_id}`} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "11px 20px",
          borderBottom: "1px solid var(--app-bg-2)",
          textDecoration: "none",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Bell {...ICON} color="var(--teal)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 500, color: "var(--app-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.generic_name ?? `Drug ${item.drug_id.slice(0, 8)}…`}
            </div>
            {item.brand_names?.[0] && (
              <div style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                {item.brand_names[0]}
              </div>
            )}
          </div>
          <ExternalLink {...ICON} color="var(--app-text-4)" />
        </Link>
      ))}
      <div style={{ padding: "12px 20px" }}>
        <Link href="/account" style={{
          fontSize: 13, color: "var(--teal)", fontWeight: 500,
          textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
        }}>
          Manage watchlist
        </Link>
      </div>
    </div>
  );
}
