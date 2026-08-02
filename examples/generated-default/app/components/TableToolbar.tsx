import { Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ClearFiltersButton } from "@/components/ClearFiltersButton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TableToolbarProps {
  /** Controlled search value (typically from `useFilterState`). Omit to hide the search box. */
  search?: string;
  /** Called (debounced) when the search text settles. Presence enables the search box. */
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Filter controls (each page drops in its own `SelectField`s, switches, date inputs…). */
  filters?: ReactNode;
  /** Resets the page's filters. Paired with `hasActiveFilters`, renders a "Clear filters" button after the filters. */
  onClearFilters?: () => void;
  /** Whether any filter is currently active — gates the "Clear filters" button's visibility. */
  hasActiveFilters?: boolean;
  /** Right-aligned actions (export, "new", bulk affordances…). */
  actions?: ReactNode;
  /** Rows currently shown. Paired with `total`, renders "N of M rows". */
  count?: number;
  total?: number;
  className?: string;
}

/**
 * Shared toolbar that sits above a `Table`. Standardises the search box, a
 * filter slot, a right-aligned actions slot, and a result count so every table
 * page gets the same affordances. Filtering predicates stay in each page (over
 * its react-query data) — the toolbar only owns the controls.
 *
 * The search box keeps a local value for instant typing and pushes the settled
 * value to `onSearchChange` after a short debounce, so URL/state writes don't
 * fire on every keystroke.
 */
export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  onClearFilters,
  hasActiveFilters,
  actions,
  count,
  total,
  className,
}: TableToolbarProps) {
  const showSearch = onSearchChange != null;
  const [local, setLocal] = useState(search ?? "");
  // Track the last value we received/emitted so external changes (back/forward,
  // reset) resync the input without clobbering in-flight typing.
  const lastSync = useRef(search ?? "");

  useEffect(() => {
    if (search !== undefined && search !== lastSync.current) {
      lastSync.current = search;
      setLocal(search);
    }
  }, [search]);

  useEffect(() => {
    if (!showSearch || local === lastSync.current) return;
    const id = setTimeout(() => {
      lastSync.current = local;
      onSearchChange(local);
    }, 250);
    return () => clearTimeout(id);
  }, [local, showSearch, onSearchChange]);

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3", className)}>
      {showSearch && (
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full pl-8"
          />
        </div>
      )}
      {filters}
      {onClearFilters && <ClearFiltersButton show={!!hasActiveFilters} onClick={onClearFilters} />}
      {(count != null || actions) && (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {count != null && (
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {total != null && total !== count ? `${count} of ${total}` : count}
              {` ${count === 1 ? "row" : "rows"}`}
            </span>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
