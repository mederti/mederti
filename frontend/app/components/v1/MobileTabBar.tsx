"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, MessageCircle, Menu } from "lucide-react";
import "./mobile-tabs.css";

type Tab = "content" | "chat" | "nav";

/**
 * Bottom tab bar shown on mobile (<1024px) for the 3-column template surfaces.
 * Switches which pane is on screen — Page (content) / Ask (chat) / Menu (nav) —
 * by setting `data-mtab` on <html>; the CSS in mobile-tabs.css turns the nav
 * and chat columns into full-screen overlays. Hidden on desktop.
 *
 * Pass `hasChat={false}` on surfaces where the chat *is* the content (the /chat
 * main view) so the Ask tab is dropped.
 */
export default function MobileTabBar({ hasChat = true }: { hasChat?: boolean }) {
  const [tab, setTab] = useState<Tab>("content");

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-mtab", tab);
    return () => el.removeAttribute("data-mtab");
  }, [tab]);

  const tabs: { id: Tab; label: string; icon: typeof Menu }[] = [
    { id: "content", label: "Page", icon: LayoutGrid },
    ...(hasChat ? [{ id: "chat" as Tab, label: "Ask", icon: MessageCircle }] : []),
    { id: "nav", label: "Menu", icon: Menu },
  ];

  return (
    <nav className="mtabbar" aria-label="Mobile navigation" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={`mtab${tab === id ? " mtab-on" : ""}`}
          onClick={() => setTab(id)}
        >
          <Icon size={20} strokeWidth={tab === id ? 2.2 : 1.9} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
