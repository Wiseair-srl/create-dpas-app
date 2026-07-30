"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Accessible modal dialog built on Radix: focus trap, escape, labelled title. */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
          "rounded-lg border border-border bg-surface p-5 shadow-xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-sm font-semibold leading-6">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      <DialogPrimitive.Close
        aria-label="Close dialog"
        className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <X aria-hidden className="h-4 w-4" />
      </DialogPrimitive.Close>
    </div>
  );
}
