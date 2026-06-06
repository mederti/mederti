import * as React from "react";
import { icons, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export type IconName = keyof typeof icons;

/**
 * Single icon entry point for the tuned design system. Lucide-backed
 * (hybrid icon decision): one consistent line set, stroke 1.8, rounded
 * joins — wrapped so every surface renders icons the same way instead of
 * hand-rolling inline <svg>. `currentColor` flows from the parent.
 */
export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
  ...props
}: { name: IconName; size?: number } & LucideProps) {
  const L = icons[name];
  if (!L) return null;
  return <L size={size} strokeWidth={strokeWidth} className={cn("shrink-0", className)} {...props} />;
}

/**
 * The reference's `.tile` — a 34px rounded square holding an Icon, with a
 * hairline border and inner highlight. `accent` swaps to the soft teal
 * treatment. Scales its icon on parent `.ds-card-hover:hover`.
 */
export function IconTile({
  name,
  accent = false,
  size = 34,
  iconSize,
  className,
  ...props
}: {
  name: IconName;
  accent?: boolean;
  /** outer tile size in px */
  size?: number;
  /** glyph size in px; defaults to ~half the tile */
  iconSize?: number;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "color">) {
  return (
    <span
      className={cn(
        "ds-tile inline-flex shrink-0 items-center justify-center rounded-tile border shadow-hi",
        accent ? "border-tint-b bg-acc-soft text-acc" : "border-border bg-surf-2 text-tx-3",
        className,
      )}
      style={{ width: size, height: size }}
      {...props}
    >
      <Icon name={name} size={iconSize ?? Math.round(size * 0.5)} />
    </span>
  );
}
