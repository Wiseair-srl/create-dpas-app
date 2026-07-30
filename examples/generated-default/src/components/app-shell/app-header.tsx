"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResetDevicesMutation } from "@/features/devices/queries/use-devices";
import { RoleSwitcher } from "./role-switcher";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const reset = useResetDevicesMutation();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold leading-5">{title}</h1>
        {subtitle ? (
          <p className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          title="Restore the seeded demo devices"
          className="text-muted-foreground max-sm:hidden"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Reset data
        </Button>
        <RoleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
