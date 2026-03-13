"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  Home, Search, Bookmark,
  ChevronDown, User, LogOut,
} from "lucide-react";

/* ── Nav link sets ── */
const APP_LINKS = [
  { href: "/search",    label: "Search",     icon: Search },
  { href: "/dashboard", label: "Dashboard",  icon: Home },
  { href: "/watchlist", label: "Watchlist",  icon: Bookmark },
];

const GUEST_LINKS: { label: string; href: string; style?: "bold" | "regular" | "teal" }[] = [
  { label: "Pharmacists",   href: "/pharmacists",  style: "bold" },
  { label: "Doctors",       href: "/doctors",      style: "bold" },
  { label: "Hospitals",     href: "/hospitals",     style: "bold" },
  { label: "Governments",   href: "/government",   style: "bold" },
  { label: "Suppliers",     href: "/suppliers",     style: "regular" },
  { label: "Intelligence",  href: "/intelligence",  style: "teal" },
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
  const [email, setEmail]             = useState<string | null>(null);
  const [initials, setInitials]       = useState("?");
  const [country, setCountry]         = useState(() => {
    if (typeof document !== "undefined") {
      const match = document.cookie.match(/(?:^|; )mederti-country=([A-Z]{2})/);
      if (match) {
        const found = COUNTRIES.find((c) => c.code === match[1]);
        if (found) return found;
      }
    }
    return COUNTRIES[0];
  });
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

  /* ── Header colors (light) ── */
  const bg       = "#fff";
  const border   = "1px solid var(--app-border)";
  const logo     = "/logo-black.png";
  const txt      = "var(--app-text-3)";
  const txtHi    = "var(--app-text)";
  const txtMid   = "var(--app-text-2)";
  const txtDim   = "var(--app-text-4)";
  const btnBg    = "var(--app-bg-2)";
  const btnBd    = "var(--app-border)";
  const activeBg = "var(--teal-bg)";
  const hoverBg  = "var(--app-bg-2)";
  const tealIcon = "var(--teal)";

  return (
    <nav className="site-nav" style={{
      position: "sticky", top: 0, zIndex: 100,
      height: 64, background: bg,
      borderBottom: border,
      transition: "background 0.2s, border-color 0.2s",
    }}>
      <div style={{
        maxWidth: 1200, margin: "0 auto", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px",
      }}>

        {/* ── Left: Logo ── */}
        <Link href={loggedIn ? "/dashboard" : "/"} style={{
          display: "flex", alignItems: "center",
          textDecoration: "none", flexShrink: 0,
        }}>
          <img src={logo} alt="Mederti" style={{ height: 28, transition: "opacity 0.2s" }} />
        </Link>

        {/* ── Center: Nav links ── */}
        <div className="site-nav-links" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {loggedIn ? (
            APP_LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/home" && pathname?.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 6,
                  fontSize: 13, fontWeight: active ? 500 : 400,
                  color: active ? txtHi : txt,
                  background: active ? activeBg : "transparent",
                  textDecoration: "none",
                  transition: "color 0.12s, background 0.12s",
                }}>
                  <Icon {...ICON} color={active ? tealIcon : txtDim} />
                  <span className="site-nav-label">{label}</span>
                </Link>
              );
            })
          ) : (
            GUEST_LINKS.map(({ label, href, style: linkStyle }) => {
              const isTeal = linkStyle === "teal";
              const isBold = linkStyle === "bold";
              const baseColor = isTeal ? "var(--teal)" : txt;
              const hoverColor = isTeal ? "var(--teal)" : txtHi;
              return (
                <Link key={label} href={href} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "7px 14px", borderRadius: 6,
                  fontSize: 14,
                  fontWeight: isBold || isTeal ? 600 : 400,
                  color: baseColor,
                  textDecoration: "none",
                  transition: "color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = hoverColor;
                  e.currentTarget.style.background = hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = baseColor;
                  e.currentTarget.style.background = "transparent";
                }}
                >
                  {label}
                </Link>
              );
            })
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
                background: btnBg,
                border: `1px solid ${btnBd}`,
                color: txtMid, cursor: "pointer",
                fontSize: 13, fontWeight: 500,
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{country.flag}</span>
              {country.code}
              <ChevronDown style={{ width: 12, height: 12, color: txtDim }} />
            </button>

            {showCountry && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0,
                background: "#fff", border: "1px solid #e2e8f0",
                borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                padding: 4, minWidth: 130, zIndex: 200,
              }}>
                {COUNTRIES.map(c => (
                  <button
                    key={c.code}
                    onClick={() => { setCountry(c); setShowCountry(false); document.cookie = `mederti-country=${c.code};path=/;max-age=${60*60*24*365}`; }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", textAlign: "left",
                      padding: "8px 12px", borderRadius: 6, border: "none",
                      background: c.code === country.code ? "var(--teal-bg)" : "transparent",
                      color: c.code === country.code ? "var(--teal)" : "#334155",
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

          {/* Auth area */}
          {loggedIn ? (
            <div ref={userRef} style={{ position: "relative" }}>
              <button
                onClick={() => { setShowUser(v => !v); setShowCountry(false); }}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--teal)", border: "2px solid var(--app-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer",
                }}
              >
                {initials}
              </button>
              {showUser && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  background: "#fff", border: "1px solid #e2e8f0",
                  borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  padding: 8, minWidth: 200, zIndex: 200,
                }}>
                  <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid #e2e8f0", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>Signed in as</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", wordBreak: "break-all" }}>{email}</div>
                  </div>
                  <Link href="/account" onClick={() => setShowUser(false)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 6,
                    fontSize: 13, color: "#334155", textDecoration: "none",
                  }}>
                    <User {...ICON} color="#64748b" />
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
            <>
              <Link href="/pricing" style={{
                fontSize: 13, fontWeight: 430, color: txt,
                textDecoration: "none", padding: "7px 10px",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = txtHi; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = txt; }}
              >
                Pricing
              </Link>
              <Link href="/login" style={{
                display: "flex", alignItems: "center",
                padding: "7px 18px", borderRadius: 7,
                fontSize: 13, fontWeight: 500,
                color: "var(--app-text-2)",
                textDecoration: "none",
                border: `1px solid ${btnBd}`,
                background: "transparent",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--app-border-2)";
                e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = btnBd;
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
