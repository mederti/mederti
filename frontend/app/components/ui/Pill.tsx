import * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone = "crit" | "med" | "ok" | "neutral";

const PILL_TONES: Record<PillTone, string> = {
  crit: "text-crit bg-crit-bg border-crit-b",
  med: "text-med bg-med-bg border-med-b",
  ok: "text-ok bg-ok-bg border-ok-b",
  neutral: "text-tx-3 bg-surf-2 border-border",
};

/**
 * The reference `.pill` — a rounded status chip with an optional leading
 * dot (in `currentColor`) and the inner highlight.
 */
export function Pill({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: {
  tone?: PillTone;
  dot?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-[11.5px] font-medium shadow-hi",
        PILL_TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export type SeverityLevel = "high" | "med" | "low";

const SEV_TONES: Record<SeverityLevel, string> = {
  high: "text-crit",
  med: "text-med",
  low: "text-tx-4",
};

/**
 * The reference `.sev` — tracked, uppercase severity label (HIGH/MED/LOW).
 * Renders the level text by default; pass children to override.
 */
export function SeverityLabel({
  level,
  className,
  children,
  ...props
}: {
  level: SeverityLevel;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("text-[10.5px] font-semibold uppercase tracking-[0.04em]", SEV_TONES[level], className)}
      {...props}
    >
      {children ?? level}
    </span>
  );
}
