"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

interface Props {
  drugId: string;
}

/**
 * "Watch" toggle for the live (V1) drug page.
 *
 * Adds the drug to the signed-in user's watchlist (`user_watchlists`) — the
 * same list the sidebar's "Watchlist" section and /account read. This is the
 * ONLY save affordance on the live page: the legacy HeaderActions/V4BellButton
 * buttons live on the old persona page (page.tsx), which soft-launch doesn't
 * render, so without this button the watchlist could never populate.
 *
 * - Anonymous: bounces to /login?next=/drugs/{id}.
 * - Authenticated: toggles the row via Supabase RLS (no server round-trip),
 *   fires the fire-and-forget `watchlist_add` demand signal, and broadcasts a
 *   `watchlist:changed` window event so V1Sidebar re-fetches immediately.
 */
export function WatchButton({ drugId }: Props) {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setLoading(false);
        return;
      }
      const uid = session.user.id;
      setUserId(uid);

      const { data } = await supabase
        .from("user_watchlists")
        .select("id")
        .eq("drug_id", drugId)
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();

      if (cancelled) return;
      if (data) {
        setIsWatching(true);
        setWatchlistId(data.id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [drugId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle() {
    if (loading || toggling) return;

    if (!userId) {
      router.push(`/login?next=/drugs/${drugId}`);
      return;
    }

    setToggling(true);

    if (isWatching && watchlistId) {
      await supabase
        .from("user_watchlists")
        .update({ is_active: false })
        .eq("id", watchlistId);
      setIsWatching(false);
    } else {
      const { data } = await supabase
        .from("user_watchlists")
        .upsert(
          {
            drug_id: drugId,
            user_id: userId,
            is_active: true,
            notification_channels: { email: true, sms: false, webhook: null },
          },
          { onConflict: "user_id,drug_id" },
        )
        .select("id")
        .single();
      if (data) setWatchlistId(data.id);
      setIsWatching(true);
      // Fire-and-forget demand signal (watchlist_add) — recorded server-side.
      fetch("/api/demand/watchlist-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drug_id: drugId }),
      }).catch(() => {});
    }

    // Let the sidebar's Watchlist section refresh without a page reload.
    window.dispatchEvent(new Event("watchlist:changed"));
    setToggling(false);
  }

  return (
    <button
      type="button"
      className={`watch-btn${isWatching ? " on" : ""}`}
      onClick={toggle}
      disabled={loading || toggling}
      title={
        loading
          ? "Loading…"
          : isWatching
            ? "Stop watching — remove from your watchlist"
            : "Watch — add to your watchlist and get alerts"
      }
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={isWatching ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {isWatching ? "Watching" : "Watch"}
    </button>
  );
}
