import * as React from "react";

import type { ExportColumn } from "@/components/TableExportButton";
import type { ColumnFilter, ColumnFilterOption, TableColumn } from "@/components/ui/data-table";
import { withinRange } from "@/lib/date";

/**
 * Owns column visibility, order, and per-column filter values for a {@link TableColumn}
 * array, and derives everything the existing table primitives consume: the ordered
 * `visible` columns, a `colSpan`, the `useTableSort` accessor map, the `ExportColumn[]`
 * for `TableExportButton`, and `applyColumnFilters` to fold into the page's filter memo.
 *
 * Visibility + order persist to localStorage under `rt:colcfg:<storageKey>`. Filter
 * values route through an injected `filterState` (URL-synced via `useFilterState`) when
 * given, else through internal state. SSR-safe: the lazy state initializer only touches
 * localStorage in the browser, so the server renders the default column layout.
 */

const CFG_PREFIX = "rt:colcfg:";

interface ColCfg {
  hidden: string[];
  order: string[];
}

export interface ManagedColumn {
  id: string;
  label: string;
  hidden: boolean;
  hideable: boolean;
}

/**
 * A column that can narrow the table, described rather than rendered.
 *
 * The funnel UI reads the same three things off `TableColumn.filter` inline
 * ({@link ColumnFilterButton}); this hands them to a caller that has no JSX to
 * hang them on — today the agent view plane, which has to tell a model which
 * columns are filterable, in what value format, and (for a select) which values
 * actually occur.
 *
 * `options` stays a FUNCTION of rows, exactly as declared: the option list is
 * derived from the rows the caller considers unfiltered, and which set that is
 * is the caller's decision, not this hook's.
 */
export interface FilterableColumn<T> {
  id: string;
  label: string;
  kind: ColumnFilter<T>["kind"];
  /** Present only for `kind: "select"`. */
  options?: (rows: readonly T[]) => ColumnFilterOption[];
}

interface FilterStateLike {
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  setMany?: (patch: Record<string, string>) => void;
}

export interface UseTableColumnsResult<T> {
  /** Ordered, visible columns (left-pinned … movable … right-pinned). */
  visible: TableColumn<T>[];
  /** Movable columns in display order, for the columns menu. */
  managed: ManagedColumn[];
  /** Count of visible columns — use for every colSpan (skeleton/empty/spacer). */
  colSpan: number;
  /** True when any visible column defines a `footer` — gate the summary row on this. */
  hasFooter: boolean;
  /** Sort accessor map keyed by column id, for `useTableSort`. */
  sortAccessors: Record<string, (row: T) => unknown>;
  /** CSV columns in declared order (ignores hide/reorder), for `TableExportButton`. */
  exportColumns: ExportColumn<T>[];
  /** Apply all active per-column filters; call inside the page's filtered memo. */
  applyColumnFilters: (rows: readonly T[]) => T[];
  /** Columns that declare a filter, in declared order — see {@link FilterableColumn}. */
  filterable: FilterableColumn<T>[];
  /** True when any per-column filter is narrowing the rows. */
  hasActiveFilters: boolean;
  /** Reset every per-column filter (leaves the page's search/toolbar filters alone). */
  clearFilters: () => void;
  filterValue: (id: string) => string;
  setFilter: (id: string, value: string) => void;
  toggle: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  reset: () => void;
  canReset: boolean;
}

function parseNumberRange(value: string): [number | null, number | null] {
  const [a, b] = value.split(",");
  const min = a != null && a.trim() !== "" ? Number(a) : null;
  const max = b != null && b.trim() !== "" ? Number(b) : null;
  return [Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null];
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function useTableColumns<T>(
  columns: TableColumn<T>[],
  opts: { storageKey: string; filterState?: FilterStateLike },
): UseTableColumnsResult<T> {
  const { storageKey, filterState } = opts;

  const movable = React.useMemo(() => columns.filter((c) => !c.pin), [columns]);
  const defaultOrder = React.useMemo(() => movable.map((c) => c.id), [movable]);
  const defaultHidden = React.useMemo(
    () => movable.filter((c) => c.defaultHidden).map((c) => c.id),
    [movable],
  );

  const [cfg, setCfg] = React.useState<ColCfg>(() => {
    const fallback: ColCfg = { hidden: defaultHidden, order: defaultOrder };
    if (typeof window === "undefined") return fallback;
    try {
      const raw = localStorage.getItem(CFG_PREFIX + storageKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<ColCfg>;
      const strings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      return {
        hidden: Array.isArray(parsed.hidden) ? strings(parsed.hidden) : defaultHidden,
        order: Array.isArray(parsed.order) ? strings(parsed.order) : defaultOrder,
      };
    } catch {
      return fallback;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(CFG_PREFIX + storageKey, JSON.stringify(cfg));
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [cfg, storageKey]);

  const hideable = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of movable) if (c.enableHiding !== false) set.add(c.id);
    return set;
  }, [movable]);

  // A column is only effectively hidden if it's allowed to be.
  const hiddenSet = React.useMemo(
    () => new Set(cfg.hidden.filter((id) => hideable.has(id))),
    [cfg.hidden, hideable],
  );

  // Movable columns in saved order; unknown saved ids dropped, new ids appended.
  const orderedMovable = React.useMemo(() => {
    const byId = new Map(movable.map((c) => [c.id, c]));
    const out: TableColumn<T>[] = [];
    for (const id of cfg.order) {
      const c = byId.get(id);
      if (c) out.push(c);
    }
    for (const c of movable) if (!cfg.order.includes(c.id)) out.push(c);
    return out;
  }, [movable, cfg.order]);

  const visible = React.useMemo(() => {
    const left = columns.filter((c) => c.pin === "left");
    const right = columns.filter((c) => c.pin === "right");
    const mid = orderedMovable.filter((c) => !hiddenSet.has(c.id));
    return [...left, ...mid, ...right];
  }, [columns, orderedMovable, hiddenSet]);

  const managed = React.useMemo<ManagedColumn[]>(
    () =>
      orderedMovable.map((c) => ({
        id: c.id,
        label: c.label ?? (typeof c.header === "string" ? c.header : c.id),
        hidden: hiddenSet.has(c.id),
        hideable: hideable.has(c.id),
      })),
    [orderedMovable, hiddenSet, hideable],
  );

  const sortAccessors = React.useMemo(() => {
    const acc: Record<string, (row: T) => unknown> = {};
    for (const c of columns) if (c.sortAccessor) acc[c.id] = c.sortAccessor;
    return acc;
  }, [columns]);

  const exportColumns = React.useMemo<ExportColumn<T>[]>(() => {
    const out: ExportColumn<T>[] = [];
    for (const c of columns) {
      const value =
        c.exportValue ?? (c.sortAccessor as ((row: T) => string | number | null | undefined) | undefined);
      if (!value) continue;
      out.push({
        header: c.exportHeader ?? (typeof c.header === "string" ? c.header : c.id),
        value,
        numeric: c.exportNumeric,
      });
    }
    return out;
  }, [columns]);

  const [internalFilters, setInternalFilters] = React.useState<Record<string, string>>({});

  const filterValue = React.useCallback(
    (id: string) => (filterState ? filterState.values[id] ?? "" : internalFilters[id] ?? ""),
    [filterState, internalFilters],
  );

  const setFilter = React.useCallback(
    (id: string, value: string) => {
      if (filterState) filterState.set(id, value);
      else setInternalFilters((prev) => ({ ...prev, [id]: value }));
    },
    [filterState],
  );

  const applyColumnFilters = React.useCallback(
    (rows: readonly T[]): T[] => {
      let out = rows as readonly T[];
      for (const c of columns) {
        const f = c.filter;
        if (!f) continue;
        const v = (filterState ? filterState.values[c.id] : internalFilters[c.id]) ?? "";
        if (f.kind === "text") {
          const q = v.trim().toLowerCase();
          if (q) out = out.filter((r) => f.predicate(r, q));
        } else if (f.kind === "select") {
          if (v) out = out.filter((r) => f.predicate(r, v));
        } else if (f.kind === "number-range") {
          const [min, max] = parseNumberRange(v);
          if (min != null || max != null) {
            out = out.filter((r) => {
              const n = f.accessor(r);
              if (n == null) return false;
              if (min != null && n < min) return false;
              if (max != null && n > max) return false;
              return true;
            });
          }
        } else {
          const [from, to] = v.split(",");
          if (from || to) out = out.filter((r) => withinRange(f.accessor(r), from ?? "", to ?? ""));
        }
      }
      return out as T[];
    },
    [columns, filterState, internalFilters],
  );

  const filterable = React.useMemo<FilterableColumn<T>[]>(
    () =>
      columns
        .filter((c) => c.filter)
        .map((c) => {
          const f = c.filter!;
          return {
            id: c.id,
            label: c.label ?? (typeof c.header === "string" ? c.header : c.id),
            kind: f.kind,
            ...(f.kind === "select" ? { options: f.options } : {}),
          };
        }),
    [columns],
  );

  const filterableIds = React.useMemo(() => filterable.map((c) => c.id), [filterable]);

  const hasActiveFilters = React.useMemo(
    () =>
      filterableIds.some((id) => {
        const v = (filterState ? filterState.values[id] : internalFilters[id]) ?? "";
        // A non-empty bound on either side counts (range values encode as "min,max").
        return v.split(",").some((part) => part.trim() !== "");
      }),
    [filterableIds, filterState, internalFilters],
  );

  const clearFilters = React.useCallback(() => {
    if (filterState) {
      // Single URL write — looping `set` would drop all but the last key (stale ref).
      const patch: Record<string, string> = {};
      for (const id of filterableIds) patch[id] = "";
      if (filterState.setMany) filterState.setMany(patch);
      else for (const id of filterableIds) filterState.set(id, "");
    } else {
      setInternalFilters({});
    }
  }, [filterState, filterableIds]);

  const toggle = React.useCallback(
    (id: string) => {
      if (!hideable.has(id)) return;
      setCfg((c) => {
        const set = new Set(c.hidden);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return { ...c, hidden: [...set] };
      });
    },
    [hideable],
  );

  const orderedMovableIds = React.useMemo(() => orderedMovable.map((c) => c.id), [orderedMovable]);

  const move = React.useCallback(
    (id: string, dir: -1 | 1) => {
      setCfg((c) => {
        const order = [...orderedMovableIds];
        const i = order.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return c;
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
        return { ...c, order };
      });
    },
    [orderedMovableIds],
  );

  const reset = React.useCallback(
    () => setCfg({ hidden: defaultHidden, order: defaultOrder }),
    [defaultHidden, defaultOrder],
  );

  const canReset = React.useMemo(() => {
    const h = [...hiddenSet].sort();
    const dh = [...defaultHidden].sort();
    if (!arraysEqual(h, dh)) return true;
    return !arraysEqual(orderedMovableIds, defaultOrder);
  }, [hiddenSet, defaultHidden, orderedMovableIds, defaultOrder]);

  const hasFooter = React.useMemo(() => visible.some((c) => c.footer != null), [visible]);

  return {
    visible,
    managed,
    colSpan: visible.length,
    hasFooter,
    sortAccessors,
    exportColumns,
    applyColumnFilters,
    filterable,
    hasActiveFilters,
    clearFilters,
    filterValue,
    setFilter,
    toggle,
    move,
    reset,
    canReset,
  };
}
