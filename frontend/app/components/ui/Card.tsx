import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The reference `.ans` / `.panel` / `.scard` surface — white card, hairline
 * border, card shadow + inner highlight, 16px radius. Set `hover` for the
 * lift-on-hover signature (translateY + shadow deepen + inner tile scale).
 */
export function Card({
  hover = false,
  className,
  children,
  ...props
}: {
  hover?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surf shadow-card",
        hover && "ds-card-hover",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * A `Card` variant with no padding, used as the container for `ListRow`s
 * (the reference `.panel`). Clips its rows' hover backgrounds to the radius.
 */
export function Panel({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-hidden rounded-card border border-border bg-surf shadow-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}
