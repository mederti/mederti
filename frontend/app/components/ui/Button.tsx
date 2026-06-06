import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "neutral" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  // brand teal CTA with inner highlight + hover lift
  primary: "border-transparent bg-acc text-white shadow-hi hover:-translate-y-px hover:shadow-card",
  // bordered surface button
  neutral: "border-border bg-surf text-tx-2 shadow-hi hover:-translate-y-px hover:border-border-2 hover:shadow-card",
  // quiet button that materializes a surface on hover (reference `.back`)
  ghost: "border-transparent bg-transparent text-tx-3 hover:border-border hover:bg-surf hover:text-tx hover:shadow-card",
};

/**
 * Shared button primitive. Hover lift, active scale, and a focus-visible
 * ring (via `.ds-focus`) on every variant. Reduced-motion users get no
 * transform (handled globally in primitives.css).
 */
export function Button({
  variant = "primary",
  className,
  type = "button",
  children,
  ...props
}: {
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "ds-focus inline-flex items-center justify-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-medium transition active:scale-[0.98]",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
