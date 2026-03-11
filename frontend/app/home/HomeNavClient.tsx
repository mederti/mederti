"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  Home, Search, MessageSquare, Bell, Bookmark,
  Globe, ChevronDown, User, LogOut, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/app/components/theme-provider";

const NAV_LINKS = [
  { href: "/home",      label: "Home",      icon: Home },
  { href: "/search",    label: "Search",    icon: Search },
  { href: "/chat",      label: "AI Chat",   icon: MessageSquare },
  { href: "/alerts",    label: "Alerts",    icon: Bell },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
];

const COUNTRIES = ["AU", "US", "GB", "CA", "NZ", "SG", "DE", "FR"];

export default function HomeNavClient({ defaultCountry = "AU" }: { defaultCountry?: string }) {
  const pathname = usePathname();
  const supabase = createBrowserClient();

  const [email, setEmail]         = useState<string | null>(null);
  const [initials, setInitials]   = useState("?");
  const [country, setCountry]     = useState(defaultCountry);
  const [showCountry, setShowCountry] = useState(false);
  const [showUser, setShowUser]   = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const e = session.user.email;
        setEmail(e);
        setInitials(e[0].toUpperCase());
      }
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const ICON_STYLE = { width: 15, height: 15, strokeWidth: 1.5 } as const;

  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      height: 56, background: "var(--navy)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px", gap: 8,
    }}>
      {/* Left: logo + nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
        <Link href="/home" style={{
          display: "flex", alignItems: "center",
          textDecoration: "none", marginRight: 12, flexShrink: 0,
        }}>
          <img src="/logo-white.png" alt="Mederti" style={{ height: 22 }} />
        </Link>

        <div className="home-nav-links" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/home" && pathname?.startsWith(href));
            return (
              <Link key={href} href={href} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 10px", borderRadius: 6,
                fontSize: 13, fontWeight: active ? 500 : 400,
                color: active ? "#fff" : "rgba(255,255,255,0.5)",
                background: active ? "rgba(255,255,255,0.1)" : "none",
                textDecoration: "none",
                transition: "color 0.12s, background 0.12s",
              }}>
                <Icon {...ICON_STYLE} color={active ? "var(--teal-l)" : "rgba(255,255,255,0.4)"} />
                <span className="home-nav-label">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right: theme toggle + country selector + user */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle dark mode"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 6,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
            cursor: "pointer", color: "rgba(255,255,255,0.7)",
            transition: "background 0.15s",
          }}
        >
          {theme === "dark" ? <Sun {...ICON_STYLE} /> : <Moon {...ICON_STYLE} />}
        </button>

        {/* Country selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { setShowCountry(v => !v); setShowUser(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 10px", borderRadius: 6,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.8)", cursor: "pointer",
              fontSize: 12, fontWeight: 500,
              fontFamily: "var(--font-inter), sans-serif",
            }}
          >
            <Globe {...ICON_STYLE} color="rgba(255,255,255,0.5)" />
            {country}
            <ChevronDown {...ICON_STYLE} color="rgba(255,255,255,0.4)" />
          </button>
          {showCountry && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "#fff", border: "1px solid var(--app-border)",
              borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              padding: "4px", minWidth: 100, zIndex: 200,
            }}>
              {COUNTRIES.map(c => (
                <button
                  key={c}
                  onClick={() => { setCountry(c); setShowCountry(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", borderRadius: 6, border: "none",
                    background: c === country ? "var(--teal-bg)" : "none",
                    color: c === country ? "var(--teal)" : "var(--app-text-2)",
                    fontSize: 13, fontWeight: c === country ? 500 : 400,
                    cursor: "pointer", fontFamily: "var(--font-inter), sans-serif",
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User avatar */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { setShowUser(v => !v); setShowCountry(false); }}
            style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "var(--teal)", border: "2px solid rgba(255,255,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: "#fff",
              cursor: "pointer",
            }}
          >
            {email ? initials : <User {...ICON_STYLE} />}
          </button>
          {showUser && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "#fff", border: "1px solid var(--app-border)",
              borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              padding: 8, minWidth: 200, zIndex: 200,
            }}>
              {email && (
                <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid var(--app-border)", marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginBottom: 2 }}>Signed in as</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", wordBreak: "break-all" }}>{email}</div>
                </div>
              )}
              <Link href="/account" onClick={() => setShowUser(false)} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 6,
                fontSize: 13, color: "var(--app-text-2)", textDecoration: "none",
              }}>
                <User {...ICON_STYLE} color="var(--app-text-3)" />
                Account
              </Link>
              {email ? (
                <button
                  onClick={signOut}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 12px", borderRadius: 6, border: "none", background: "none",
                    fontSize: 13, color: "var(--crit)", cursor: "pointer",
                    fontFamily: "var(--font-inter), sans-serif", textAlign: "left",
                  }}
                >
                  <LogOut {...ICON_STYLE} color="var(--crit)" />
                  Sign out
                </button>
              ) : (
                <Link href="/login" onClick={() => setShowUser(false)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 6,
                  fontSize: 13, color: "var(--teal)", textDecoration: "none", fontWeight: 500,
                }}>
                  Sign in
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .home-nav-links { display: none !important; }
          .home-nav-label { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
