"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { getPartnerForCountry } from "@/lib/suppliers";
import { SupplierDrawer } from "../supplier-drawer";

interface HeaderActionsProps {
  drugId: string;
  drugName: string;
  userCountry: string;
  severity: string;
}

export function HeaderActions({ drugId, drugName, userCountry, severity }: HeaderActionsProps) {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [userOrganisation, setUserOrganisation] = useState<string>("");
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [isWatched, setIsWatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [supplierDrawerOpen, setSupplierDrawerOpen] = useState(false);

  const partner = getPartnerForCountry(userCountry);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }
      const uid = session.user.id;
      setUserId(uid);
      setUserEmail(session.user.email ?? undefined);

      const meta = session.user.user_metadata;
      console.log("user metadata:", meta);
      setUserOrganisation(
        meta?.organisation ?? meta?.company ?? meta?.business_name ?? ""
      );

      const { data } = await supabase
        .from("user_watchlists")
        .select("id")
        .eq("drug_id", drugId)
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();

      if (data) {
        setIsWatched(true);
        setWatchlistId(data.id);
      }
      setLoading(false);
    }
    init();
  }, [drugId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleWatchlist() {
    if (loading || toggling) return;

    if (!userId) {
      router.push(`/login?next=/drugs/${drugId}/v4`);
      return;
    }

    setToggling(true);

    if (isWatched && watchlistId) {
      await supabase
        .from("user_watchlists")
        .update({ is_active: false })
        .eq("id", watchlistId);
      setIsWatched(false);
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
      setIsWatched(true);
    }

    setToggling(false);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        {/* Find a supplier */}
        <button
          onClick={() => partner && setSupplierDrawerOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 12px", borderRadius: 8,
            fontSize: 12, fontWeight: 500,
            cursor: partner ? "pointer" : "default",
            border: "1px solid var(--teal)",
            background: "var(--teal)",
            color: "#fff",
            fontFamily: "Inter, sans-serif",
            opacity: partner ? 1 : 0.4,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h10l-1 6H3L2 3z"/>
            <circle cx="5" cy="11.5" r=".8" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="11.5" r=".8" fill="currentColor" stroke="none"/>
          </svg>
          Find a supplier
        </button>

        {!partner && (
          <span style={{ fontSize: 10, color: "var(--app-text-4)" }}>
            Not available in your region yet
          </span>
        )}

        {/* Add to watchlist — neutral secondary */}
        <button
          onClick={handleWatchlist}
          disabled={loading || toggling}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 12px", borderRadius: 8,
            fontSize: 12, fontWeight: 500,
            cursor: loading || toggling ? "not-allowed" : "pointer",
            border: `1px solid ${isWatched ? "var(--teal-b)" : "var(--app-border)"}`,
            background: isWatched ? "var(--teal-bg)" : "#fff",
            color: isWatched ? "var(--teal)" : "var(--app-text-3)",
            fontFamily: "Inter, sans-serif",
            transition: "all 0.15s",
            opacity: loading || toggling ? 0.5 : 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill={isWatched ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1l1.5 3 3.5.5-2.5 2.5.5 3.5L7 9l-3 1.5.5-3.5L2 4.5 5.5 4z"/>
          </svg>
          {isWatched ? "Watching" : "Add to watchlist"}
        </button>
      </div>

      {partner && (
        <SupplierDrawer
          isOpen={supplierDrawerOpen}
          onClose={() => setSupplierDrawerOpen(false)}
          drugName={drugName}
          drugId={drugId}
          severity={severity}
          partner={partner}
          userCountry={userCountry}
          userEmail={userEmail}
          userOrganisation={userOrganisation}
        />
      )}
    </>
  );
}
