"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  Home, Search, MessageSquare, Bell, Bookmark,
  ChevronDown, Sun, Moon, User, LogOut,
} from "lucide-react";
import { useTheme } from "@/app/components/theme-provider";

/* ── Nav link sets ── */
const APP_LINKS = [
  { href: "/home",      label: "Home",      icon: Home },
  { href: "/search",    label: "Search",    icon: Search },
  { href: "/chat",      label: "AI Chat",   icon: MessageSquare },
  { href: "/alerts",    label: "Alerts",    icon: Bell },
  { href: "/watchlist", label: "Watchlist",  icon: Bookmark },
];

const GUEST_LINKS = [
  { label: "Features",  href: "#features" },
  { label: "Pricing",   href: "/pricing" },
  { label: "About",     href: "/about" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Contact",   href: "/contact" },
];

const COUNTRIES = [
  { code: "AU", flag: "🇦🇺" },
  { code: "US", flag: "🇺🇸" },
  { code: "GB", flag: "🇬🇧" },
  { code: "CA", flag: "🇨🇦" },
  { code: "NZ", flag: "🇳🇿" },
  { code: "SG", flag: "🇸🇬" },
  { code: "DE", flag: "🇩🇪" },
  { code: "FR", flag: "🇫🇷" },
];

const ICON = { width: 15, height: 15, strokeWidth: 1.5 } as const;

export default function SiteNav() {
  const pathname = usePathname();
  const supabase = createBrowserClient();
  const { theme, setTheme } = useTheme();

  const [email, setEmail]             = useState<string | null>(null);
  const [initials, setInitials]       = useState("?");
  const [country, setCountry]         = useState(COUNTRIES[0]);
  const [showCountry, setShowCountry] = useState(false);
  const [showUser, setShowUser]       = useState(false);

  const countryRef = useRef<HTMLDivElement>(null);
  const userRef    = useRef<HTMLDivElement>(null);

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const e = session.user.email;
        setEmail(e);
        setInitials(e[0].toUpperCase());
      }
    });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (countryRef.current && !countryRef.current.contains(e.target as Node)) setShowCountry(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUser(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const loggedIn = email !== null;

  return (
    <nav className="site-nav" style={{
      position: "sticky", top: 0, zIndex: 100,
      height: 64, background: "var(--navy, #080f1e)",
    }}>
      <div style={{
        maxWidth: 1200, margin: "0 auto", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px",
      }}>

        {/* ── Left: Logo ── */}
        <Link href={loggedIn ? "/home" : "/"} style={{
          display: "flex", alignItems: "center",
          textDecoration: "none", flexShrink: 0,
        }}>
          <img src="/logo-white.png" alt="Mederti" style={{ height: 28 }} />
        </Link>

        {/* ── Center: Nav links ── */}
        <div className="site-nav-links" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {loggedIn ? (
            /* Authenticated links with icons */
            APP_LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/home" && pathname?.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 6,
                  fontSize: 13, fontWeight: active ? 500 : 400,
                  color: active ? "#fff" : "rgba(255,255,255,0.55)",
                  background: active ? "rgba(255,255,255,0.1)" : "transparent",
                  textDecoration: "none",
                  transition: "color 0.12s, background 0.12s",
                }}>
                  <Icon {...ICON} color={active ? "var(--teal-l)" : "rgba(255,255,255,0.4)"} />
                  <span className="site-nav-label">{label}</span>
                </Link>
              );
            })
          ) : (
            /* Guest links (no icons) */
            GUEST_LINKS.map(({ label, href }) => (
              <Link key={label} href={href} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "7px 14px", borderRadius: 6,
                fontSize: 14, fontWeight: 430,
                color: "rgba(255,255,255,0.6)",
                textDecoration: "none",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                e.currentTarget.style.background = "transparent";
              }}
              >
                {label}
              </Link>
            ))
          )}
        </div>

        {/* ── Right: controls ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>

          {/* Country selector */}
          <div ref={countryRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setShowCountry(v => !v); setShowUser(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 11px", borderRadius: 20,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.8)", cursor: "pointer",
                fontSize: 13, fontWeight: 500,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                transition: "border-color 0.15s",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{country.flag}</span>
              {country.code}
              <ChevronDown style={{ width: 12, height: 12, color: "rgba(255,255,255,0.4)" }} />
            </button>

            {showCountry && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0,
                background: "var(--panel)", border: "1px solid var(--app-border)",
                borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                padding: 4, minWidth: 130, zIndex: 200,
              }}>
                {COUNTRIES.map(c => (
                  <button
                    key={c.code}
                    onClick={() => { setCountry(c); setShowCountry(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", textAlign: "left",
                      padding: "8px 12px", borderRadius: 6, border: "none",
                      background: c.code === country.code ? "var(--teal-bg)" : "transparent",
                      color: c.code === country.code ? "var(--teal)" : "var(--app-text-2)",
                      fontSize: 13, fontWeight: c.code === country.code ? 500 : 400,
                      cursor: "pointer", fontFamily: "var(--font-inter), system-ui, sans-serif",
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{c.flag}</span>
                    {c.code}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle dark mode"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 7,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.12)",
              cursor: "pointer", color: "rgba(255,255,255,0.7)",
              transition: "background 0.15s",
            }}
          >
            {theme === "dark"
              ? <Sun style={{ width: 15, height: 15 }} />
              : <Moon style={{ width: 15, height: 15 }} />}
          </button>

          {/* Auth area */}
          {loggedIn ? (
            /* User avatar + dropdown */
            <div ref={userRef} style={{ position: "relative" }}>
              <button
                onClick={() => { setShowUser(v => !v); setShowCountry(false); }}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--teal)", border: "2px solid rgba(255,255,255,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer",
                }}
              >
                {initials}
              </button>
              {showUser && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  background: "var(--panel)", border: "1px solid var(--app-border)",
                  borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  padding: 8, minWidth: 200, zIndex: 200,
                }}>
                  <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid var(--app-border)", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", marginBottom: 2 }}>Signed in as</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", wordBreak: "break-all" }}>{email}</div>
                  </div>
                  <Link href="/account" onClick={() => setShowUser(false)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 6,
                    fontSize: 13, color: "var(--app-text-2)", textDecoration: "none",
                  }}>
                    <User {...ICON} color="var(--app-text-3)" />
                    Account
                  </Link>
                  <button
                    onClick={signOut}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "8px 12px", borderRadius: 6, border: "none", background: "none",
                      fontSize: 13, color: "var(--crit)", cursor: "pointer",
                      fontFamily: "var(--font-inter), sans-serif", textAlign: "left",
                    }}
                  >
                    <LogOut {...ICON} color="var(--crit)" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Guest: Log in + CTA */
            <>
              <Link href="/login" style={{
                display: "flex", alignItems: "center",
                padding: "7px 18px", borderRadius: 7,
                fontSize: 13, fontWeight: 500,
                color: "rgba(255,255,255,0.85)", textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)";
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                e.currentTarget.style.background = "transparent";
              }}
              >
                Log in
              </Link>
              <Link href="/signup" style={{
                display: "flex", alignItems: "center",
                padding: "7px 20px", borderRadius: 7,
                fontSize: 13, fontWeight: 600,
                color: "#fff", textDecoration: "none",
                background: "var(--teal, #0d9488)", border: "none",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                Get started free
              </Link>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .site-nav > div { padding: 0 16px !important; }
          .site-nav-links { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
