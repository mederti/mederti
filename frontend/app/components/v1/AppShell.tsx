import type { ReactNode } from "react";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import { ContextChat, type ContextChatProps } from "@/app/chat/components/ContextChat";
import MobileTabBar from "@/app/components/v1/MobileTabBar";
import ChatColumn from "@/app/components/v1/ChatColumn";
import "@/app/chat/chat.css";
import "./app-shell.css";

/**
 * The single logged-in app template. Every signed-in product page (search,
 * drugs, chat, insights, shortages, recalls, intelligence, map, account,
 * supplier dashboard, onboarding, …) renders its content as
 * `<AppShell>…</AppShell>` so the whole app shares one shell:
 *
 *   - 2-column (default): left {@link V1Sidebar} + a scrollable main column.
 *   - 3-column (`chat` or `chatPanel`): V1Sidebar → grounded chat (narrow,
 *     middle) → full-width content (right). On desktop the columns are
 *     viewport-locked so the chat composer stays pinned while content scrolls;
 *     below 1024px the page scrolls normally and nav/chat become overlays
 *     driven by {@link MobileTabBar}.
 *   - `fill`: the content column is viewport-locked and the children manage
 *     their own scrolling (the /chat conversation surface, live dashboards).
 *
 * Server-component friendly (no hooks) — server pages can use it directly while
 * the client-only sidebar, chat and tab bar render as children.
 */
export default function AppShell({
  children,
  contentClassName = "",
  className = "",
  chat,
  chatPanel,
  chatScope = "page",
  fill = false,
  mobileTabs = true,
}: {
  children: ReactNode;
  /**
   * Extra classes on the `.dg-main` column. Use `narrow` for prose/settings
   * widths, `wide` to remove the max-width cap, `flush` for pages that bring
   * their own padding, or `base-type` for pages designed at the browser's 16px
   * base rather than the V1 14px tokens. Ignored with `fill`.
   */
  contentClassName?: string;
  className?: string;
  /**
   * Renders the 3-column template with a grounded {@link ContextChat} in the
   * middle column. Product names in chat answers click through to their drug
   * pages.
   */
  chat?: Omit<ContextChatProps, "placement">;
  /**
   * A custom node for the middle chat column, in place of `chat` — e.g. the
   * signed-out `ChatSignupGate`. Takes precedence over `chat`.
   */
  chatPanel?: ReactNode;
  /**
   * Where chat.css's `.mederti-chat-root` scope applies in the 3-column
   * template. "page" (default) scopes the whole shell, so content can use the
   * chat tokens (--teal, --indigo, …); "panel" confines it to the chat column,
   * for pages whose own class names would collide with chat.css (drug, search).
   */
  chatScope?: "page" | "panel";
  /**
   * Viewport-locked content column; children own their scrolling. The chat-first
   * surfaces (/chat, /insights) use this: chat.css's scope and tokens cover the
   * whole shell, set in Inter (see app-shell.css `.shell--fill`).
   */
  fill?: boolean;
  /** Show the mobile bottom tab bar (<1024px). Off only where a page renders its own. */
  mobileTabs?: boolean;
}) {
  const middle = chatPanel ?? (chat ? <ContextChat key={chat.contextKey} {...chat} placement="left" /> : null);
  const hasChat = middle != null;
  const locked = hasChat || fill;
  // chat.css scope: on the root for "page" (the V1 tokens on .v1app still win
  // there, as they always have); on .shell for `fill`, so chat.css's own tokens
  // override the inherited V1 ones across the chat surface; else on the column.
  const rootScope = !fill && hasChat && chatScope === "page";
  const shellScope = fill;
  const panelScope = !rootScope && !shellScope;

  const rootClass = ["v1app", rootScope ? "mederti-chat-root" : "", className].filter(Boolean).join(" ");
  const shellClass = fill
    ? "shell shell--chat shell--fill mederti-chat-root"
    : locked
      ? "shell shell--chat"
      : "shell";
  const mainClass = fill ? "shell-main shell-main--fill" : locked ? "shell-main shell-main--scroll" : "shell-main";

  return (
    <div className={rootClass}>
      <div className={shellClass}>
        <V1Sidebar />
        {hasChat ? (
          <ChatColumn className={`chat-col${panelScope ? " mederti-chat-root" : ""}`}>{middle}</ChatColumn>
        ) : null}
        <div className={mainClass}>
          {fill ? children : <div className={`dg-main ${contentClassName}`.trim()}>{children}</div>}
        </div>
      </div>
      {mobileTabs ? <MobileTabBar hasChat={hasChat} /> : null}
    </div>
  );
}
