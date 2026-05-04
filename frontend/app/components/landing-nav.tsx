"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  Home, Search, Bookmark, TrendingUp, BarChart3,
  ChevronDown, User, LogOut, Menu, X,
} from "lucide-react";
import { useUserProfile } from "@/lib/hooks/use-user-profile";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

/* ── Soft-launch feature flag ── */
const SOFT_LAUNCH =
  (process.env.NEXT_PUBLIC_SOFT_LAUNCH ?? "").toLowerCase() === "true";

/* ── Nav link sets ── */
const FULL_BASE_APP_LINKS = [
  { href: "/search",       label: "Search",       icon: Search },
  { href: "/dashboard",    label: "Dashboard",    icon: Home },
  { href: "/intelligence", label: "Intelligence", icon: BarChart3 },
  { href: "/watchlist",    label: "Watchlist",     icon: Bookmark },
];

const SOFT_BASE_APP_LINKS = [
  { href: "/search",       label: "Search",       icon: Search },
  { href: "/intelligence", label: "Intelligence", icon: BarChart3 },
];

const BASE_APP_LINKS = SOFT_LAUNCH ? SOFT_BASE_APP_LINKS : FULL_BASE_APP_LINKS;

const FULL_GUEST_LINKS: { label: string; href: string; style?: "bold" | "regular" | "teal" }[] = [
  { label: "Pharmacists",   href: "/pharmacists",  style: "bold" },
  { label: "Doctors",       href: "/doctors",      style: "bold" },
  { label: "Hospitals",     href: "/hospitals",     style: "bold" },
  { label: "Governments",   href: "/government",   style: "bold" },
  { label: "Suppliers",     href: "/suppliers",     style: "regular" },
  { label: "Intelligence",  href: "/intelligence",  style: "teal" },
];

const SOFT_GUEST_LINKS: typeof FULL_GUEST_LINKS = [
  { label: "Search",        href: "/search",        style: "bold" },
  { label: "Intelligence",  href: "/intelligence",  style: "teal" },
];

const GUEST_LINKS = SOFT_LAUNCH ? SOFT_GUEST_LINKS : FULL_GUEST_LINKS;

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
  const router = useRouter();
  const supabase = createBrowserClient();
  const { isSupplier } = useUserProfile();
  const [email, setEmail]             = useState<string | null>(null);
  const [initials, setInitials]       = useState("?");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
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
  const [searchOpen, setSearchOpen]   = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const countryRef = useRef<HTMLDivElement>(null);
  const userRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /* ── Global search autocomplete ── */
  const ac = useAutocomplete({
    minChars: 2,
    debounceMs: 200,
    limit: 8,
    enabled: searchOpen,
    onSelect: (item) => {
      ac.clear();
      setSearchOpen(false);
      router.push(item.href);
    },
    onSubmit: (q) => {
      ac.setIsOpen(false);
      setSearchOpen(false);
      router.push(`/search?q=${encodeURIComponent(q)}`);
    },
  });

  // Hide nav search on pages that already have a search bar
  const hideNavSearch = pathname === "/" || pathname === "/home" || pathname === "/search";

  /* ── Auto-focus search input when expanded ── */
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      ac.clear();
    }
  }, [searchOpen]);

  /* ── Close search when navigating to a page with its own search ── */
  useEffect(() => {
    if (hideNavSearch && searchOpen) setSearchOpen(false);
  }, [hideNavSearch]);

  /* ── Close mobile menu on route change ── */
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const e = session.user.email;
        setEmail(e);
        setInitials(e[0].toUpperCase());
        // Pull display name and avatar from user metadata
        const meta = session.user.user_metadata ?? {};
        const name = meta.full_name || meta.name || meta.display_name || "Rob @ Mederti";
        setDisplayName(name);
        setAvatarUrl(meta.avatar_url || null);
        if (name) {
          // Use first letter of first name
          setInitials(name.charAt(0).toUpperCase());
        }
      }
    });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (countryRef.current && !countryRef.current.contains(e.target as Node)) setShowCountry(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUser(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const loggedIn = email !== null;

  const appLinks = [
    ...BASE_APP_LINKS,
    ...(isSupplier ? [{ href: "/supplier-dashboard", label: "Opportunities", icon: TrendingUp }] : []),
  ];

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
        position: "relative",
        maxWidth: 1200, margin: "0 auto", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px",
      }}>

        {/* ── Left: Logo ── */}
        <Link href={loggedIn ? (SOFT_LAUNCH ? "/search" : "/home") : "/"} style={{
          display: "flex", alignItems: "center",
          textDecoration: "none", flexShrink: 0,
        }}>
          <img src={logo} alt="Mederti" style={{ height: 28, transition: "opacity 0.2s" }} />
        </Link>

        {/* ── Center: Nav links (hidden when search overlay is open) ── */}
        <div className="site-nav-links" style={{ display: searchOpen ? "none" : "flex", alignItems: "center", gap: 2 }}>
          {loggedIn ? (
            appLinks.map(({ href, label, icon: Icon }) => {
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

        {/* ── Expanded search overlay (positioned over nav links area) ── */}
        {searchOpen && (
          <div
            ref={searchRef}
            className="nav-search-overlay"
            style={{
              position: "absolute", left: 80, right: 120,
              top: "50%", transform: "translateY(-50%)",
              display: "flex", alignItems: "center",
              zIndex: 150,
              animation: "navSearchFadeIn 0.15s ease-out",
            }}
          >
            <div ref={ac.containerRef} style={{ position: "relative", flex: 1 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--app-bg)", border: "1px solid var(--app-border)",
                borderRadius: 10, padding: "8px 14px",
                transition: "border-color 0.15s",
              }}>
                <Search width={15} height={15} strokeWidth={1.5} color={txtDim} style={{ flexShrink: 0 }} />
                <input
                  ref={searchInputRef}
                  {...ac.inputProps}
                  suppressHydrationWarning
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && !ac.isOpen) {
                      setSearchOpen(false);
                      return;
                    }
                    ac.inputProps.onKeyDown(e);
                  }}
                  placeholder="Search drugs..."
                  style={{
                    flex: 1, border: "none", outline: "none", background: "transparent",
                    fontSize: 14, color: "var(--app-text)",
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                  }}
                />
                {ac.query && (
                  <button
                    onClick={() => ac.clear()}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 20, height: 20, borderRadius: "50%",
                      background: "var(--app-bg-2)", border: "none",
                      cursor: "pointer", fontSize: 11, color: txtDim, flexShrink: 0,
                      lineHeight: 1,
                    }}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              {ac.isOpen && (
                <AutocompleteDropdown
                  items={ac.items}
                  cursor={ac.cursor}
                  loading={ac.loading}
                  query={ac.query}
                  listId={ac.inputProps["aria-controls"]}
                  onSelect={(item) => {
                    ac.clear();
                    setSearchOpen(false);
                    router.push(item.href);
                  }}
                  onHover={() => {}}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Mobile hamburger button (visible below 768px) ── */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(v => !v)}
          style={{
            display: "none", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, borderRadius: 8,
            background: mobileMenuOpen ? "var(--app-bg-2)" : "transparent",
            border: "none", cursor: "pointer", color: txtMid,
            transition: "background 0.15s",
          }}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen
            ? <X width={20} height={20} strokeWidth={1.8} />
            : <Menu width={20} height={20} strokeWidth={1.8} />
          }
        </button>

        {/* ── Right: controls ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>

          {/* Search icon (hidden on pages with their own search bar) */}
          {!hideNavSearch && (
            <button
              onClick={() => {
                setSearchOpen(v => !v);
                setShowCountry(false);
                setShowUser(false);
              }}
              style={{
                display: searchOpen ? "none" : "flex",
                alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: "50%",
                background: "transparent", border: "none",
                cursor: "pointer", color: txtDim,
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = txtHi;
                e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = txtDim;
                e.currentTarget.style.background = "transparent";
              }}
              aria-label="Search drugs"
            >
              <Search width={17} height={17} strokeWidth={1.8} />
            </button>
          )}

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
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 12px 4px 4px",
                  borderRadius: 99,
                  background: "var(--app-bg-2)",
                  border: "1px solid var(--app-border)",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#e2e8f0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, overflow: "hidden",
                  }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="10" r="5" fill="#94a3b8"/>
                      <ellipse cx="14" cy="26" rx="10" ry="8" fill="#94a3b8"/>
                    </svg>
                  </div>
                )}
                <span style={{
                  fontSize: 12, fontWeight: 500, color: "var(--app-text-2)",
                  maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {displayName || email?.split("@")[0] || "Account"}
                </span>
              </button>
              {showUser && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  background: "#fff", border: "1px solid #e2e8f0",
                  borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  padding: 8, minWidth: 200, zIndex: 200,
                }}>
                  <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid #e2e8f0", marginBottom: 6 }}>
                    {displayName && (
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 2 }}>{displayName}</div>
                    )}
                    <div style={{ fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}>{email}</div>
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
                background: "var(--teal, #0F172A)", border: "none",
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

      {/* ── Mobile slide-down menu ── */}
      {mobileMenuOpen && (
        <div className="mobile-menu-drawer" style={{
          position: "absolute", top: 64, left: 0, right: 0,
          background: "#fff", borderBottom: "1px solid var(--app-border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
          zIndex: 99, padding: "8px 0",
          animation: "mobileMenuSlide 0.18s ease-out",
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px" }}>
            {loggedIn ? (
              <>
                {appLinks.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || (href !== "/home" && pathname?.startsWith(href));
                  return (
                    <Link key={href} href={href} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 12px", borderRadius: 8,
                      fontSize: 15, fontWeight: active ? 600 : 400,
                      color: active ? "var(--teal)" : "var(--app-text)",
                      background: active ? "var(--teal-bg)" : "transparent",
                      textDecoration: "none",
                    }}>
                      <Icon width={18} height={18} strokeWidth={1.5} color={active ? "var(--teal)" : txtDim} />
                      {label}
                    </Link>
                  );
                })}
                {!SOFT_LAUNCH && (
                  <>
                    <div style={{ height: 1, background: "var(--app-border)", margin: "8px 12px" }} />
                    <Link href="/shortages" style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 12px", borderRadius: 8, fontSize: 15,
                      color: "var(--app-text)", textDecoration: "none",
                    }}>
                      Shortages
                    </Link>
                    <Link href="/recalls" style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 12px", borderRadius: 8, fontSize: 15,
                      color: "var(--app-text)", textDecoration: "none",
                    }}>
                      Recalls
                    </Link>
                  </>
                )}
                <Link href="/intelligence" style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 12px", borderRadius: 8, fontSize: 15,
                  color: "var(--teal)", fontWeight: 500, textDecoration: "none",
                }}>
                  Intelligence
                </Link>
              </>
            ) : (
              <>
                {GUEST_LINKS.map(({ label, href }) => (
                  <Link key={label} href={href} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "12px 12px", borderRadius: 8,
                    fontSize: 15, fontWeight: 500,
                    color: "var(--app-text)",
                    textDecoration: "none",
                  }}>
                    {label}
                  </Link>
                ))}
                {!SOFT_LAUNCH && (
                  <>
                    <div style={{ height: 1, background: "var(--app-border)", margin: "8px 12px" }} />
                    <Link href="/shortages" style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 12px", borderRadius: 8, fontSize: 15,
                      color: "var(--app-text-3)", textDecoration: "none",
                    }}>
                      Browse Shortages
                    </Link>
                    <Link href="/recalls" style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 12px", borderRadius: 8, fontSize: 15,
                      color: "var(--app-text-3)", textDecoration: "none",
                    }}>
                      Browse Recalls
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes navSearchFadeIn {
          from { opacity: 0; transform: translateY(-50%) scale(0.97); }
          to   { opacity: 1; transform: translateY(-50%) scale(1); }
        }
        @keyframes mobileMenuSlide {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .site-nav > div { padding: 0 16px !important; }
          .site-nav-links { display: none !important; }
          .nav-search-overlay { left: 52px !important; right: 0 !important; }
          .mobile-menu-btn { display: flex !important; }
        }
      `}</style>
    </nav>
  );
}
