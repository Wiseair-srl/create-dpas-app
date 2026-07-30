import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "neutral" | "success" | "warning" | "danger" | "view" | "domain" | "outline";

const variantClasses: Record<Variant, string> = {
  neutral: "bg-surface-muted text-muted-foreground border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  view: "bg-plane-view-soft text-plane-view border-transparent",
  domain: "bg-plane-domain-soft text-plane-domain border-transparent",
  outline: "bg-transparent text-muted-foreground border-border-strong",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
