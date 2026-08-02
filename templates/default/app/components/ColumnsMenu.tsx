import { ArrowDown, ArrowUp, Columns3, Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UseTableColumnsResult } from "@/lib/hooks/useTableColumns";
import { cn } from "@/lib/utils";

/**
 * Toolbar "Columns" menu: show/hide each movable column and reorder with ▲/▼
 * buttons (no drag-and-drop dependency; keyboard-accessible). Drop into a
 * `TableToolbar` actions slot alongside the export button. Pinned columns (row
 * actions, leading checkbox) are excluded — they can't be hidden or moved.
 */
export function ColumnsMenu<T>({ cols }: { cols: UseTableColumnsResult<T> }) {
  const { managed } = cols;
  if (managed.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="size-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div role="group" aria-label="Show, hide and reorder columns" className="space-y-0.5">
          {managed.map((m, i) => (
            <div key={m.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent">
              <GripVertical aria-hidden className="size-3.5 shrink-0 text-muted-foreground/40" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={!m.hidden}
                disabled={!m.hideable}
                onClick={() => cols.toggle(m.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
              >
                {m.hidden ? (
                  <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Eye className="size-3.5 shrink-0" />
                )}
                <span className={cn("truncate", m.hidden && "text-muted-foreground")}>{m.label}</span>
              </button>
              <button
                type="button"
                aria-label={`Move ${m.label} up`}
                disabled={i === 0}
                onClick={() => cols.move(m.id, -1)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30"
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${m.label} down`}
                disabled={i === managed.length - 1}
                onClick={() => cols.move(m.id, 1)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        {cols.canReset && (
          <>
            <div className="my-1 h-px bg-border" />
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={cols.reset}>
              <RotateCcw className="size-3.5" />
              Reset columns
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
