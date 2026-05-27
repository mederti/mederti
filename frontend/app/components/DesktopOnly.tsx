import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Tagline shown under the headline. Override for non-chat surfaces. */
  tagline?: string;
};

/**
 * Wraps a dense, desktop-first surface (chat shell, dashboards) with a
 * "best on desktop" splash that takes over below 1024px. The wrapped UI
 * still renders, but is hidden via CSS — no client-side viewport detection,
 * no hydration flash. Phone-optimized routes (/, /drugs/[id], /suppliers)
 * have their own UA-gated mobile components and don't need this.
 */
export function DesktopOnly({
  children,
  tagline = "Mederti is built for desk-side work — multi-pane chat, the preview pane, and the supplier dashboards need a wider screen than a phone can give.",
}: Props) {
  return (
    <>
      <div className="lg:hidden min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-full max-w-md flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.png"
            alt="Mederti"
            className="w-12 h-12 mb-6"
          />
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-3">
            Best on desktop
          </h1>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-8">
            {tagline}
          </p>
          <div className="w-full flex flex-col gap-3">
            <Link
              href="/search"
              className="w-full inline-flex items-center justify-center px-4 py-3 rounded-lg bg-slate-900 text-white text-[14px] font-medium hover:bg-slate-800 transition-colors"
            >
              Quick lookup
            </Link>
            <Link
              href="/"
              className="w-full inline-flex items-center justify-center px-4 py-3 rounded-lg border border-slate-300 text-slate-700 text-[14px] font-medium hover:bg-white transition-colors"
            >
              Back to home
            </Link>
          </div>
          <p className="mt-8 text-[12px] text-slate-400">
            Native iOS &amp; Android apps coming. Reopen Mederti on a laptop or
            desktop for the full experience.
          </p>
        </div>
      </div>
      <div className="hidden lg:contents">{children}</div>
    </>
  );
}
