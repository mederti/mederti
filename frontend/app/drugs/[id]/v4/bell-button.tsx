"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

interface V4BellButtonProps {
  drugId: string;
  hasShortage?: boolean;
}

/**
 * Compact bell icon for the v4 My Country card header.
 * - Unauthenticated: redirects to /login?next=/drugs/{id}/v4
 * - Authenticated: toggles user_watchlists row via Supabase RLS
 */
export function V4BellButton({ drugId, hasShortage = true }: V4BellButtonProps) {
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
  }, [drugId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle() {
    if (loading || toggling) return;

    if (!userId) {
      router.push(`/login?next=/drugs/${drugId}/v4`);
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
    }

    setToggling(false);
  }

  const title = loading
    ? "Loading\u2026"
    : isWatching
      ? "Stop watching"
      : hasShortage
        ? "Alert me when available"
        : "Watch for changes";

  return (
    <button
      onClick={toggle}
      disabled={loading || toggling}
      title={title}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 28,
        height: 28,
        borderRadius: 6,
        background: isWatching ? "var(--teal)" : "var(--teal-bg, #f0fdfa)",
        border: "1px solid var(--teal-b, #99f6e4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: loading || toggling ? "not-allowed" : "pointer",
        opacity: loading || toggling ? 0.5 : 1,
        transition: "background 0.15s, opacity 0.15s",
        padding: 0,
      }}
    >
      {/* Bell SVG */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill={isWatching ? "#fff" : "none"}
        stroke={isWatching ? "#fff" : "var(--teal)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {/* Active dot indicator */}
      {isWatching && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--med, #ca8a04)",
            border: "2px solid white",
          }}
        />
      )}
    </button>
  );
}
