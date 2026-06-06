import * as React from "react";
import { cn } from "@/lib/utils";
import { IconTile, type IconName } from "./Icon";

/**
 * The reference `.sec` + `.sec-hd` — a section header with an IconTile, a
 * title, and a right-aligned count, followed by the section body. Pass an
 * `icon` name to render the leading tile, or `leading` for a custom node
 * (e.g. a flag). `count` renders at the right of the header.
 */
export function Section({
  icon,
  leading,
  title,
  count,
  className,
  headerClassName,
  children,
  ...props
}: {
  icon?: IconName;
  leading?: React.ReactNode;
  title: React.ReactNode;
  count?: React.ReactNode;
  headerClassName?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("mt-8", className)} {...props}>
      <div className={cn("mb-3 flex items-center gap-3", headerClassName)}>
        {leading ?? (icon && <IconTile name={icon} />)}
        <h2 className="text-[14.5px] font-semibold tracking-[-0.02em] text-tx">{title}</h2>
        {count != null && <span className="ml-auto text-xs text-tx-4">{count}</span>}
      </div>
      {children}
    </section>
  );
}
