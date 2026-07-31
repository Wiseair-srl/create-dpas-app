"use client";

import { useCatalogMode, type CatalogMode } from "@/agent/host/catalog-mode";
import { cn } from "@/lib/cn";

/**
 * Switches how the SAME capabilities are projected to the model.
 *
 * Both modes run against one registry — nothing about the application changes,
 * only what the model is handed:
 *
 *   - **direct** — one tool per capability. Precise, but the tool block grows
 *     with the surface and long flat lists degrade selection accuracy.
 *   - **meta** — three generic tools. Constant-size whatever the surface holds,
 *     at the cost of a discovery round-trip before the model can act.
 *
 * It affects live chat only: the guided demo names capabilities itself and is
 * pinned to direct. Switching mid-turn is prevented by the turn controller,
 * which captures the mode when a turn starts.
 */

const MODES: Array<{ value: CatalogMode; label: string; hint: string }> = [
  {
    value: "direct",
    label: "Direct",
    hint: "One tool per capability. The model sees the whole catalog.",
  },
  {
    value: "meta",
    label: "Meta",
    hint: "Three generic tools. The model discovers capabilities instead.",
  },
];

export function CatalogModeToggle() {
  const mode = useCatalogMode((s) => s.mode);
  const setMode = useCatalogMode((s) => s.setMode);

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
      role="radiogroup"
      aria-label="Catalog mode"
      data-testid="catalog-mode-toggle"
    >
      {MODES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          title={option.hint}
          data-testid={`catalog-mode-${option.value}`}
          onClick={() => setMode(option.value)}
          className={cn(
            "cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            mode === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
