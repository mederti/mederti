import type { ReactNode } from "react";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
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
}: {
  children: ReactNode;
  contentClassName?: string;
  className?: string;
}) {
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
