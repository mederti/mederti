import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

/**
 * The reference `.li` row — leading slot (IconTile or flag), a title/desc
 * column, an optional trailing slot (Pill/SeverityLabel), and the hover
 * signature (bg fill + accent bar + chevron) baked in via `.ds-row`.
 *
 * Pass `href` to render an anchor (shows the chevron + focus ring); omit it
 * for a static row. Use `leading` for whatever sits on the left.
 */
export function ListRow({
  leading,
  title,
  desc,
  trailing,
  href,
  className,
  ...props
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  desc?: React.ReactNode;
  trailing?: React.ReactNode;
  href?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const interactive = href != null;
  const Comp = (interactive ? "a" : "div") as React.ElementType;
  return (
    <Comp
      href={href}
      className={cn(
        "ds-row flex items-center gap-3 border-b border-hair px-4 py-3 last:border-b-0",
        interactive && "ds-focus",
        className,
      )}
      {...props}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium tracking-[-0.01em] text-tx">{title}</div>
        {desc != null && <div className="mt-px text-[11.5px] text-tx-4">{desc}</div>}
      </div>
      {trailing}
      {interactive && (
        <span className="ds-chev">
          <Icon name="ChevronRight" size={15} strokeWidth={2} />
        </span>
      )}
    </Comp>
  );
}
