"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

interface WatchlistButtonProps {
  drugId: string;
  hasShortage?: boolean;
}

/**
 * WatchlistButton — client component for the drug detail page.
 * - If unauthenticated: redirects to /login?next=/drugs/{id}
 * - If authenticated: toggles a user_watchlists row for this drug via Supabase RLS
 */
export function WatchlistButton({ drugId, hasShortage = true }: WatchlistButtonProps) {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }
      const uid = session.user.id;
      setUserId(uid);

      // Check if already watching
      const { data } = await supabase
        .from("user_watchlists")
        .select("id")
        .eq("drug_id", drugId)
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();

      if (data) {
        setIsWatching(true);
        setWatchlistId(data.id);
      }
      setLoading(false);
    }
    init();
  }, [drugId]);

  async function toggle() {
    if (loading || toggling) return;

    if (!userId) {
      router.push(`/login?next=/drugs/${drugId}`);
      return;
    }

    setToggling(true);

    if (isWatching && watchlistId) {
      // Remove watch
      await supabase
        .from("user_watchlists")
        .update({ is_active: false })
        .eq("id", watchlistId);
      setIsWatching(false);
    } else {
      // Add watch (upsert handles re-activation after previous removal)
      const { data } = await supabase
        .from("user_watchlists")
        .upsert(
          {
            drug_id: drugId,
            user_id: userId,
            is_active: true,
            notification_channels: { email: true, sms: false, webhook: null },
          },
          { onConflict: "user_id,drug_id" }
        )
        .select("id")
        .single();
      if (data) setWatchlistId(data.id);
      setIsWatching(true);
    }

    setToggling(false);
  }

  const label = loading
    ? "Loading…"
    : isWatching
    ? "✓ Watching"
    : hasShortage ? "Alert me when available" : "Watch for changes";

  /* Inline SVG bell icon */
  const BellIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );

  const isActive = isWatching && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, width: "100%" }}>
      <button
        onClick={toggle}
        disabled={loading || toggling}
        style={{
          width: "100%", padding: "13px 18px",
          background: isActive ? "var(--low)" : "var(--teal)",
          border: "none", borderRadius: 10,
          color: "#fff", fontSize: 15, fontWeight: 600,
          fontFamily: "var(--font-inter), sans-serif",
          cursor: loading || toggling ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          opacity: loading || toggling ? 0.7 : 1,
          boxShadow: isActive
            ? "0 2px 10px rgba(34,197,94,0.2)"
            : "0 2px 10px rgba(13,148,136,0.2)",
          transition: "background 0.15s",
        }}
      >
        {!isWatching && !loading && <BellIcon />}
        {toggling ? "Updating…" : label}
      </button>
      {isWatching ? (
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--low)" }}>
          You'll be notified when this shortage changes status
        </div>
      ) : (
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--app-text-4)" }}>
          {userId ? "Email alert when stock returns in your country" : "Sign in to enable alerts"}
        </div>
      )}
    </div>
  );
}
