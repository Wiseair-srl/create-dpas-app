import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// ---- Column resizing ---------------------------------------------------------

const MIN_COL_WIDTH = 56;
// v2: widths are keyed by a stable column id (see TableHead `colId`) rather than
// by position, so a resized width survives hide/show and reorder. The old
// positional `rt:colw:` arrays are intentionally ignored (a one-time reset).
const STORAGE_PREFIX = "rt:colw2:";

type WidthMap = Record<string, number>;

/** Persist widths per table — keyed by an explicit key or the header labels. */
function resizeStorageKey(storageKey: string | undefined, ths: ArrayLike<Element>): string {
  if (storageKey) return STORAGE_PREFIX + storageKey;
  const labels = Array.from(ths, (t) => (t.textContent ?? "").trim()).join("|");
  return STORAGE_PREFIX + labels;
}

/** Column ids in DOM order; falls back to the positional index when a head has
 *  no `colId` (un-migrated tables), so resizing keeps working there too. */
function colIdsOf(ths: ArrayLike<Element>): string[] {
  return Array.from(ths, (t, i) => (t as HTMLElement).dataset.colId ?? String(i));
}

function loadWidths(key: string): WidthMap | null {
  if (typeof window === "undefined") return null; // SSR — no persisted layout
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: WidthMap = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function saveWidths(key: string, widths: WidthMap): void {
  if (typeof window === "undefined") return;
  try {
    const rounded: WidthMap = {};
    for (const [k, v] of Object.entries(widths)) rounded[k] = Math.round(v);
    localStorage.setItem(key, JSON.stringify(rounded));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

const TableResizeContext = React.createContext<{
  startResize: (colId: string, clientX: number) => void;
  reset: () => void;
} | null>(null);

// ---- Components --------------------------------------------------------------

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Override the scroll container (e.g. its max-height). */
  containerClassName?: string;
  /** Allow dragging header edges to resize columns; widths persist. Default: true. */
  resizable?: boolean;
  /** Stable key for persisted widths; defaults to the column header labels. */
  storageKey?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, resizable = true, storageKey, children, ...props }, ref) => {
    const tableRef = React.useRef<HTMLTableElement | null>(null);
    const setTableRef = React.useCallback(
      (node: HTMLTableElement | null) => {
        tableRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTableElement | null>).current = node;
      },
      [ref],
    );

    // null = natural auto-layout (the default); a map (colId -> px) switches the
    // sized columns to fixed widths. Read synchronously from storage when a
    // storageKey is given so a customised layout doesn't flash on first paint.
    // (loadWidths is SSR-guarded, so the server always renders the auto layout.)
    const [widths, setWidths] = React.useState<WidthMap | null>(() =>
      resizable && storageKey ? loadWidths(STORAGE_PREFIX + storageKey) : null,
    );
    const widthsRef = React.useRef<WidthMap | null>(null);
    widthsRef.current = widths;
    // Visible column ids in DOM order — drives the <colgroup>. Refreshed whenever
    // the header set/order changes (hide/show/reorder) so widths follow columns.
    const [orderedIds, setOrderedIds] = React.useState<string[]>([]);
    const loadedRef = React.useRef(false);

    React.useLayoutEffect(() => {
      if (!resizable) return;
      const ths = tableRef.current?.querySelectorAll("thead th");
      if (!ths || ths.length === 0) return;
      const ids = colIdsOf(ths);
      setOrderedIds((prev) =>
        prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
      );
      // Restore persisted widths once (when not already loaded synchronously).
      if (!loadedRef.current) {
        loadedRef.current = true;
        if (!widthsRef.current) {
          const saved = loadWidths(resizeStorageKey(storageKey, ths));
          if (saved) setWidths(saved);
        }
      }
    });

    const startResize = React.useCallback(
      (colId: string, clientX: number) => {
        const ths = tableRef.current?.querySelectorAll("thead th");
        if (!ths) return;
        const ids = colIdsOf(ths);
        // Snapshot the current (auto) layout by id; then only the dragged column
        // moves and the rest stay put.
        const base: WidthMap = {};
        ths.forEach((t, i) => {
          const id = ids[i];
          if (id === undefined) return;
          base[id] = (t as HTMLElement).getBoundingClientRect().width;
        });
        const startWidth = base[colId];
        if (startWidth == null) return;
        // A plain click (no drag past the threshold) stays a no-op, so it can't
        // lock the layout — that keeps the double-click-to-reset gesture clean.
        let started = false;
        document.body.style.userSelect = "none";
        const onMove = (e: PointerEvent) => {
          if (!started) {
            if (Math.abs(e.clientX - clientX) < 3) return;
            started = true;
            document.body.style.cursor = "col-resize";
            setWidths(base);
          }
          const next = Math.max(MIN_COL_WIDTH, startWidth + (e.clientX - clientX));
          setWidths((prev) => ({ ...(prev ?? base), [colId]: next }));
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          const ths2 = tableRef.current?.querySelectorAll("thead th");
          if (started && ths2 && widthsRef.current) {
            saveWidths(resizeStorageKey(storageKey, ths2), widthsRef.current);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
      [storageKey],
    );

    // Restore the default (auto) layout and forget any persisted widths.
    const reset = React.useCallback(() => {
      const ths = tableRef.current?.querySelectorAll("thead th");
      if (ths) {
        try {
          localStorage.removeItem(resizeStorageKey(storageKey, ths));
        } catch {
          /* localStorage unavailable — non-fatal */
        }
      }
      setWidths(null);
    }, [storageKey]);

    // Once the user resizes, startResize snapshots every visible column, so all
    // are known and we can fix the table width (enabling horizontal scroll). A
    // freshly-shown column has no stored width yet — fall back to fluid layout so
    // it gets the leftover space instead of being mis-sized.
    const allKnown =
      widths != null && orderedIds.length > 0 && orderedIds.every((id) => widths[id] != null);
    const totalWidth = allKnown ? orderedIds.reduce((sum, id) => sum + (widths![id] ?? 0), 0) : undefined;

    const content = (
      // Bounded, scrollable region so a tall table scrolls within itself —
      // distinct from the page scroll — with its header pinned (see TableHead).
      <div
        className={cn(
          "relative w-full overflow-auto rounded-[inherit] max-h-[calc(100vh-16rem)]",
          containerClassName,
        )}
      >
        <table
          ref={setTableRef}
          className={cn(
            "caption-bottom text-sm",
            widths ? "table-fixed" : "w-full",
            widths && !allKnown && "w-full",
            className,
          )}
          style={allKnown ? { width: totalWidth } : undefined}
          {...props}
        >
          {widths && orderedIds.length > 0 && (
            <colgroup>
              {orderedIds.map((id) => (
                <col key={id} style={widths[id] != null ? { width: widths[id] } : undefined} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </div>
    );

    if (!resizable) return content;
    return <TableResizeContext.Provider value={{ startResize, reset }}>{content}</TableResizeContext.Provider>;
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

/** Summary row pinned to the bottom of the scroll container — the footer mirror of
 *  the sticky header. Styled to stand apart from data rows: a tinted, opaque band, a
 *  heavier top divider, taller cells, and no hover highlight so it reads as a total. */
const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        "[&_tr]:border-0 [&_tr:hover]:bg-transparent",
        "[&_td]:sticky [&_td]:bottom-0 [&_td]:z-10 [&_td]:bg-surface-alt [&_td]:py-1.5 [&_td]:align-middle",
        "[&_td]:border-t-2 [&_td]:border-border [&_td]:font-semibold",
        className,
      )}
      {...props}
    />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-hover data-[state=selected]:bg-selected",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /**
   * Active sort direction for this column, or `false` when it isn't the sorted
   * column. Pair with `onSort` (see {@link useTableSort}/`getSortProps`) to make
   * the header clickable; an arrow shows the direction, a faint hint on hover
   * marks other sortable columns.
   */
  sortDirection?: SortDirection | false;
  /** Click handler that advances this column's sort. Presence makes it sortable. */
  onSort?: () => void;
  /** Stable column id — keys persisted resize widths so they survive hide/reorder. */
  colId?: string;
  /** Control rendered after the label, OUTSIDE the sort button (e.g. a filter funnel). */
  headerAction?: React.ReactNode;
}

function SortIcon({ direction }: { direction: SortDirection | false }) {
  if (direction === "asc") return <ArrowUp className="size-3 shrink-0" />;
  if (direction === "desc") return <ArrowDown className="size-3 shrink-0" />;
  return <ChevronsUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-50" />;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, sortDirection = false, onSort, colId, headerAction, ...props }, ref) => {
    const resize = React.useContext(TableResizeContext);
    return (
      <th
        ref={ref}
        data-col-id={colId}
        aria-sort={
          onSort
            ? sortDirection === "asc"
              ? "ascending"
              : sortDirection === "desc"
                ? "descending"
                : "none"
            : undefined
        }
        className={cn(
          "sticky top-0 z-10 h-8 whitespace-nowrap border-b bg-surface-alt px-2 text-left align-middle text-xs font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      >
        {onSort ? (
          // inline-flex so it inherits the cell's text alignment (e.g. text-right);
          // the negative margin keeps the label visually flush with the padding.
          <button
            type="button"
            onClick={onSort}
            className={cn(
              "group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 align-middle hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              sortDirection && "text-foreground",
            )}
          >
            {children}
            <SortIcon direction={sortDirection} />
          </button>
        ) : (
          children
        )}
        {/* Sibling of the sort button (never nested) so it stays its own a11y target. */}
        {headerAction}
        {resize && (
          // Drag handle on the column's right edge. The faint divider darkens on
          // hover to signal it's grabbable; pointer math lives in startResize.
          <span
            aria-hidden
            title="Drag to resize · double-click to reset"
            onPointerDown={(e) => {
              const th = e.currentTarget.parentElement as HTMLTableCellElement | null;
              if (!th) return;
              e.stopPropagation();
              resize.startResize(th.dataset.colId ?? String(th.cellIndex), e.clientX);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              resize.reset();
            }}
            className="group absolute right-0 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none select-none"
          >
            <span className="ml-auto h-full w-px bg-border/60 group-hover:w-0.5 group-hover:bg-ring" />
          </span>
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /**
   * Marks a long free-text column (names, descriptions). The cell breaks
   * over-long tokens and clamps to a single line with an ellipsis at a smaller
   * font — keeping rows to one line without forcing a horizontal scroll. Pair
   * with `title` for a hover tooltip.
   */
  truncate?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, truncate, children, ...props }, ref) =>
    truncate ? (
      <td ref={ref} className={cn("px-2 py-0.5 align-middle", className)} {...props}>
        <div className="line-clamp-1 text-xs [overflow-wrap:anywhere]">{children}</div>
      </td>
    ) : (
      <td
        ref={ref}
        className={cn("whitespace-nowrap px-2 py-0.5 align-middle [&:has([role=checkbox])]:pr-0", className)}
        {...props}
      >
        {children}
      </td>
    ),
);
TableCell.displayName = "TableCell";

// ---- Sorting -----------------------------------------------------------------

type SortDirection = "asc" | "desc";

interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

/** nulls/undefined always sort last; numbers and dates numerically; everything
 *  else as a numeric-aware, case-insensitive string compare. */
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Client-side sort state for a {@link Table}. Give it the rows and a map of
 * column key → value accessor; spread `getSortProps(key)` onto each sortable
 * {@link TableHead} and render `sorted` instead of the raw rows.
 *
 * Clicking a column cycles asc → desc → unsorted (restoring the original order).
 *
 * ```tsx
 * const { sorted, getSortProps } = useTableSort(data, {
 *   date: (r) => r.date,
 *   amount: (r) => r.amount,
 * }, { key: "date", direction: "desc" });
 * // <TableHead {...getSortProps("date")}>Date</TableHead>
 * ```
 */
function useTableSort<T, A extends Record<string, (row: T) => unknown>>(
  data: readonly T[] | undefined,
  accessors: A,
  initial?: SortState<Extract<keyof A, string>> | null,
  /**
   * Optional controlled mode: pass the current `sort` and an `onSortChange`
   * callback to keep sort state outside the hook (e.g. synced to the URL via
   * {@link useUrlSort}). When omitted, sort is managed internally as before.
   */
  controlled?: {
    sort: SortState | null;
    onSortChange: (sort: SortState | null) => void;
  },
) {
  type K = Extract<keyof A, string>;
  const [internal, setInternal] = React.useState<SortState<K> | null>(initial ?? null);
  const sort = (controlled ? controlled.sort : internal) as SortState<K> | null;
  const setSort: (next: SortState<K> | null) => void = controlled ? controlled.onSortChange : setInternal;

  const sorted = React.useMemo(() => {
    if (!data || !sort) return data;
    const accessor = accessors[sort.key];
    if (!accessor) return data;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...data].sort((a, b) => dir * compareValues(accessor(a), accessor(b)));
  }, [data, sort, accessors]);

  const toggle = React.useCallback(
    (key: K) => {
      const next: SortState<K> | null =
        sort?.key !== key
          ? { key, direction: "asc" }
          : sort.direction === "asc"
            ? { key, direction: "desc" }
            : null;
      setSort(next);
    },
    [sort, setSort],
  );

  const getSortProps = React.useCallback(
    (key: K): { sortDirection: SortDirection | false; onSort: () => void } => ({
      sortDirection: sort?.key === key ? sort.direction : false,
      onSort: () => toggle(key),
    }),
    [sort, toggle],
  );

  return { sorted, sort, setSort, toggle, getSortProps };
}

// ---- Virtualization ----------------------------------------------------------

/**
 * Row virtualization for a {@link Table}: only the rows near the viewport are
 * mounted, so the DOM stays small (~30 rows) regardless of dataset size. The
 * remaining scroll height is held by two {@link VirtualSpacer} rows.
 *
 * Pass `tableRef` to the `<Table ref>` (the scroll container is its overflow
 * wrapper), map over `items` instead of the raw rows, and tag each rendered
 * row with `data-index={item.index}` and `ref={measureElement}` so heights are
 * measured precisely.
 *
 * ```tsx
 * const v = useVirtualRows(view);
 * <Table ref={v.tableRef}>
 *   <TableBody>
 *     <VirtualSpacer height={v.paddingTop} colSpan={N} />
 *     {v.items.map((it) => {
 *       const row = view[it.index];
 *       if (!row) return null;
 *       return <TableRow key={row.id} data-index={it.index} ref={v.measureElement}>…</TableRow>;
 *     })}
 *     <VirtualSpacer height={v.paddingBottom} colSpan={N} />
 *   </TableBody>
 * </Table>
 * ```
 */
function useVirtualRows(
  count: number,
  opts?: { estimateSize?: number; overscan?: number },
) {
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);
  // The Table forwards its ref to the <table>; its parent is the overflow wrapper.
  const tableRef = React.useCallback((node: HTMLTableElement | null) => {
    setScrollEl((node?.parentElement as HTMLDivElement | null) ?? null);
  }, []);
  const estimateSize = opts?.estimateSize ?? 29;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateSize,
    overscan: opts?.overscan ?? 12,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  const paddingTop = first ? first.start : 0;
  const paddingBottom = last ? virtualizer.getTotalSize() - last.end : 0;
  return { tableRef, items, paddingTop, paddingBottom, measureElement: virtualizer.measureElement };
}

/** Zero-content row that reserves the off-screen scroll height for a virtual list. */
function VirtualSpacer({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden>
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  useTableSort,
  useVirtualRows,
  VirtualSpacer,
  compareValues,
};
export type { SortDirection, SortState };
