import type { ReactNode } from "react";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import { ContextChat, type ContextChatProps } from "@/app/chat/components/ContextChat";
import MobileTabBar from "@/app/components/v1/MobileTabBar";
import "@/app/chat/chat.css";
import "./app-shell.css";

/**
 * The single logged-in app template: left {@link V1Sidebar} + a scrollable main
 * column. Every signed-in product page (search, drugs, watchlist, shortages,
 * recalls, intelligence, home, dashboard, account, …) renders its content as
 * `<AppShell>…</AppShell>` so the whole app shares one shell.
 *
 * Server-component friendly (no hooks) — server pages can use it directly while
 * the client-only sidebar renders as a child.
 *
 * For the 3-column reading surfaces (/chat, /insights) the bespoke flex shell
 * stays; those already render `<V1Sidebar/>` as their left column.
 *
 * @param contentClassName extra classes on the `.dg-main` column. Use `narrow`
 *   for prose/settings widths or `wide` to remove the max-width cap.
 */
export default function AppShell({
  children,
  contentClassName = "",
  className = "",
  chat,
}: {
  children: ReactNode;
  contentClassName?: string;
  className?: string;
  /**
   * When provided, AppShell renders the 3-column template — left {@link V1Sidebar}
   * → grounded {@link ContextChat} (middle) → full-width content (right), in a
   * fixed-height layout so the chat composer stays pinned while content scrolls.
   * Omit it for the plain 2-column shell. Product names in chat answers click
   * through to their drug pages.
   */
  chat?: Omit<ContextChatProps, "placement">;
}) {
  if (chat) {
    return (
      <div className={`v1app mederti-chat-root ${className}`.trim()}>
        <div className="shell shell--chat">
          <V1Sidebar />
          <ContextChat {...chat} placement="left" />
          <div className="shell-main shell-main--scroll">
            <div className={`dg-main ${contentClassName}`.trim()}>{children}</div>
          </div>
        </div>
        <MobileTabBar />
      </div>
    );
  }
  return (
    <div className={`v1app ${className}`.trim()}>
      <div className="shell">
        <V1Sidebar />
        <div className="shell-main">
          <div className={`dg-main ${contentClassName}`.trim()}>{children}</div>
        </div>
      </div>
    </div>
  );
}
