"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

export function BottomNav() {
  const pathname = usePathname();

  const tabs = [
    {
      href: "/",
      label: "Search",
      icon: (active: boolean) => (
        <svg width="22" height="22" fill="none" stroke={active ? "#0d9488" : "var(--app-text-4)"} strokeWidth="1.5" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      href: "/alerts",
      label: "Alerts",
      icon: (active: boolean) => (
        <svg width="22" height="22" fill="none" stroke={active ? "#0d9488" : "var(--app-text-4)"} strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
    {
      href: "/account",
      label: "Account",
      icon: (active: boolean) => (
        <svg width="22" height="22" fill="none" stroke={active ? "#0d9488" : "var(--app-text-4)"} strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: 52, maxWidth: 480, margin: "0 auto",
      background: "var(--app-bg)",
      borderTop: "1px solid var(--app-border)",
      display: "flex", alignItems: "center", justifyContent: "space-around",
      zIndex: 50,
    }}>
      {tabs.map(tab => {
        const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
        return (
          <Link key={tab.href} href={tab.href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, textDecoration: "none" }}>
            {tab.icon(active)}
            <span style={{ fontSize: 10, color: active ? "#0d9488" : "var(--app-text-4)", fontWeight: active ? 500 : 400 }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
