"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search, TrendingUp, LayoutDashboard, Bookmark, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
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
 * live Search history + Watchlist, and the log-in row.
 *
 * "Watchlist" shows the signed-in user's real saved watchlist
 * (`user_watchlists`); anonymous visitors fall back to the recently-viewed
 * list backed by localStorage.
 *
 * Relies on the `.sb*` CSS that each host page already defines in its scoped
 * `.v1home` style block (including `.sb-sub` for the recent-item rows).
 *
 * Collapsible: the toggle (or ⌘/Ctrl+B) shrinks it to an icon rail to give the
 * page more width. The choice is remembered per browser in localStorage.
 */
const COLLAPSE_KEY = "mederti-sidebar-collapsed";

export default function V1Sidebar() {
  // Starts expanded on the server + first paint; the stored preference is
  // applied in an effect (no transition on that first sync, so no slide-in).
  const [collapsed, setCollapsed] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentMedicines, setRecentMedicines] = useState<RecentMedicine[]>([]);
  // Signed-in users get the unified 3-column /search home from the logo;
  // everyone else lands on the public marketing page. Resolved client-side, so
  // the logo defaults to "/" until the session check returns.
  const [signedIn, setSignedIn] = useState(false);
  // Signed-in user's email, shown in the footer account row (null = anon).
  const [email, setEmail] = useState<string | null>(null);
  // Display name from auth metadata (set at signup / editable in /account) —
  // shown in place of the email, which stays as the fallback + hover title.
  const [displayName, setDisplayName] = useState<string | null>(null);
  // The signed-in user's real watchlist. `null` = not loaded yet (or anon);
  // an array (possibly empty) = loaded, so we can distinguish "loading" from
  // "watchlist is genuinely empty".
  const [watchedMedicines, setWatchedMedicines] = useState<RecentMedicine[] | null>(null);

  function toggleCollapsed() {
    setAnimate(true);
    setCollapsed((c) => !c);
  }

  // Persist only user toggles (animate flips true on the first toggle), not
  // the initial restore from storage.
  useEffect(() => {
    if (!animate) return;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed, animate]);

  useEffect(() => {
    const restore = () => {
      try {
        if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
      } catch {}
    };
    restore();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setRecentSearches(getRecentSearches());
      setRecentMedicines(getRecentMedicines());
    };
    refresh();
    window.addEventListener(RECENT_EVENT, refresh);
    return () => window.removeEventListener(RECENT_EVENT, refresh);
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function loadWatchlist(uid: string) {
      const { data } = await supabase
        .from("user_watchlists")
        .select("drug_id, drugs(generic_name)")
        .eq("user_id", uid)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(5);
      const meds = (data ?? [])
        .map((r: { drug_id: string; drugs: { generic_name?: string } | { generic_name?: string }[] | null }) => {
          const drug = Array.isArray(r.drugs) ? r.drugs[0] : r.drugs;
          return { id: r.drug_id, name: drug?.generic_name ?? "" };
        })
        .filter((m) => m.id && m.name);
      setWatchedMedicines(meds);
    }

    const sync = (
      user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null | undefined
    ) => {
      setSignedIn(!!user);
      setEmail(user?.email ?? null);
      const meta = user?.user_metadata ?? {};
      const name = (meta.full_name || meta.name || meta.display_name || "") as string;
      setDisplayName(name.trim() || null);
      if (user?.id) loadWatchlist(user.id);
      else setWatchedMedicines(null);
    };

    supabase.auth.getSession().then(({ data: { session } }) => sync(session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => sync(session?.user));

    // Re-fetch when a drug page toggles the watchlist, so this list stays in
    // sync without a page reload (WatchButton dispatches `watchlist:changed`).
    const onWatchlistChange = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) loadWatchlist(session.user.id);
      });
    };
    window.addEventListener("watchlist:changed", onWatchlistChange);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("watchlist:changed", onWatchlistChange);
    };
  }, []);

  // Signed-in + watchlist loaded → show the real saved watchlist (even if empty,
  // so we render the honest "nothing saved" state). Otherwise (anon, or still
  // loading) fall back to the recently-viewed localStorage list.
  const showWatchlist = signedIn && watchedMedicines !== null;
  const myMedicines = showWatchlist ? watchedMedicines : recentMedicines;

  async function handleLogout() {
    await createBrowserClient().auth.signOut();
    // Hard nav so server components + middleware re-evaluate as anonymous.
    window.location.href = "/";
  }

  const accountLabel = displayName ?? email ?? "My account";
  const toggleLabel = collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)";

  return (
    <aside className={`sb${collapsed ? " sb-collapsed" : ""}${animate ? " sb-anim" : ""}`}>
      {/* Self-contained styling so this shared sidebar renders identically on
          every logged-in surface — including /chat, whose Tailwind/chat.css
          shell does NOT define the page-level .v1home block the other hosts
          (/search, /ask, /drugs, /insights) rely on. Vars sit on .sb and every
          rule is scoped under .sb, so nothing leaks into the host page. */}
      <style>{SIDEBAR_CSS}</style>
      <div className="sb-top">
        <Link href={signedIn ? "/search" : "/"} className="brand" aria-label="Mederti home">
          <span className="logo-clip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-black.png" alt="mederti" className="logo-img" />
          </span>
        </Link>
        <button type="button" onClick={toggleCollapsed} className="sb-toggle" aria-label={toggleLabel} title={toggleLabel}>
          {collapsed ? <PanelLeftOpen size={17} strokeWidth={1.9} /> : <PanelLeftClose size={17} strokeWidth={1.9} />}
        </button>
      </div>
      <div className="sb-scroll">
        <div className="sb-group">
          <Link href="/search" className="sb-item" title={collapsed ? "Search" : undefined}><Search size={17} strokeWidth={1.9} className="sb-ico" /><span className="sb-label">Search</span></Link>
          <Link href="/insights/intelligence" className="sb-item" title={collapsed ? "Intelligence" : undefined}><TrendingUp size={17} strokeWidth={1.9} className="sb-ico" /><span className="sb-label">Intelligence</span></Link>
          <Link href="/insights/dashboard" className="sb-item" title={collapsed ? "Dashboard" : undefined}><LayoutDashboard size={17} strokeWidth={1.9} className="sb-ico" /><span className="sb-label">Dashboard</span></Link>
          {collapsed && (
            <Link href={signedIn ? "/account#watchlist" : "/login"} className="sb-item" title="Watchlist">
              <Bookmark size={17} strokeWidth={1.9} className="sb-ico" />
            </Link>
          )}
          {/* Map view temporarily hidden from nav (map render issue on prod) — the
              /map route + all code stay intact so it can be worked on via direct URL. */}
        </div>
        {!collapsed && (<>
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
          <div className="sb-glabel">Watchlist</div>
          {myMedicines.length > 0 ? (
            <>
              {myMedicines.map((m) => (
                <Link key={m.id} href={`/drugs/${m.id}`} className="sb-item sb-sub">
                  {truncateDrugName(m.name, 28)}
                </Link>
              ))}
              {showWatchlist && (
                <Link href="/account#watchlist" className="sb-item sb-viewall">View all →</Link>
              )}
            </>
          ) : showWatchlist ? (
            <Link href="/search" className="sb-item sb-empty">Nothing watched yet</Link>
          ) : signedIn ? (
            <div className="sb-item sb-empty">Loading…</div>
          ) : (
            <Link href="/login" className="sb-item sb-empty">Sign in to build a watchlist</Link>
          )}
        </div>
        </>)}
      </div>
      <div className="sb-country"><V1CountryPicker compact={collapsed} /></div>
      {signedIn ? (
        <div className="sb-account">
          <Link href="/account" className="sb-profile" title={email ?? "My account"}>
            {collapsed ? (
              <span className="sb-avatar">{accountLabel.charAt(0).toUpperCase()}</span>
            ) : accountLabel.length > 24 ? accountLabel.slice(0, 22) + "…" : accountLabel}
          </Link>
          <button type="button" onClick={handleLogout} className="sb-logout" title={collapsed ? "Log out" : undefined} aria-label="Log out">
            {collapsed ? <LogOut size={15} strokeWidth={1.9} /> : "Log out"}
          </button>
        </div>
      ) : (
        <Link href="/login" className="sb-profile">{collapsed ? "→" : "Log in →"}</Link>
      )}
    </aside>
  );
}

// Mirrors the sidebar rules that the V1 host pages define in their scoped
// `.v1home` blocks, but self-contained: the design-token vars live on `.sb`
// itself (so children — including the inline-styled V1CountryPicker — inherit
// them) and every selector is scoped under `.sb` so it can't affect the host.
const SIDEBAR_CSS = `
.sb{--ink:#0c1118;--green:#0fa676;--green-d:#0c8a62;--green-bg:#e8f6f0;
  --bg:#ffffff;--bg-2:#fafbfc;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;--ok:#0fa676;
  width:262px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column;
  font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;
  letter-spacing:-.011em;-webkit-font-smoothing:antialiased;color:var(--text)}
.sb *{box-sizing:border-box}
.sb .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;
  letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.sb .logo-img{height:31px;width:auto;display:block}
.sb-top{height:64px;padding:0 14px 0 28px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.sb .logo-clip{display:block;overflow:hidden;width:126px}
.sb-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
  border:none;border-radius:8px;background:none;color:var(--text-4);cursor:pointer}
.sb-toggle:hover{background:var(--bg-2);color:var(--green-d)}
.sb-country{padding:10px 16px;border-top:1px solid var(--border)}
.sb-avatar{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;
  background:var(--green-bg);color:var(--green-d);font-size:12px;font-weight:700}
/* Collapsed icon rail. aside.sb.sb-collapsed out-specifies the host pages'
   own .sb / .v1home .sb width rules. */
aside.sb.sb-anim{transition:width .18s ease}
aside.sb.sb-collapsed{width:68px}
.sb-collapsed .sb-top{flex-direction:column;justify-content:center;height:auto;padding:16px 0 4px;gap:10px}
.sb-collapsed .logo-clip{width:27px}
.sb-collapsed .logo-img{max-width:none}
.sb-collapsed .sb-scroll{padding:4px 12px;overflow-x:hidden}
.sb-collapsed .sb-group{margin-top:6px}
.sb-collapsed .sb-item{justify-content:center;padding:10px 0}
.sb-collapsed .sb-label{display:none}
.sb-collapsed .sb-country{padding:10px 0;display:flex;justify-content:center}
.sb-collapsed .sb-account{flex-direction:column}
.sb-collapsed .sb-profile{padding:12px 0 4px;display:flex;justify-content:center;text-align:center}
.sb-collapsed .sb-logout{padding:8px 0 14px;display:flex;justify-content:center}
.sb-scroll{flex:1;overflow-y:auto;padding:8px 14px 8px 19px}
.sb-group{margin-top:14px}
.sb-glabel{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text-4);padding:6px 9px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px;border-radius:10px;font-size:13px;
  font-weight:500;color:var(--text-2);text-decoration:none}
.sb-item:hover{background:var(--bg-2)}
.sb-item.sb-active{background:var(--green-bg);color:var(--green-d)}
.sb-empty{color:var(--text-4);font-style:italic}
.sb-viewall{padding-left:18px;color:var(--green-d);font-weight:600;font-size:12.5px}
.sb-viewall:hover{background:var(--bg-2)}
.sb-sub{padding-left:18px;color:var(--text-3);font-weight:500;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;display:block}
.sb-sub:hover{color:var(--text);background:var(--bg-2)}
.sb-ico{flex-shrink:0;color:var(--text-3)}
.sb-item:hover .sb-ico{color:var(--green-d)}
.sb-item.sb-active .sb-ico{color:var(--green-d)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;
  color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.sb-account{display:flex;align-items:center;border-top:1px solid var(--border)}
.sb-account .sb-profile{border-top:none;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sb-logout{flex:none;background:none;border:none;cursor:pointer;padding:16px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-4)}
.sb-logout:hover{color:var(--green-d)}
`;
