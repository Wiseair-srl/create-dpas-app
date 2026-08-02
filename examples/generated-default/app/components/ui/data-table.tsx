import * as React from "react";

import { ColumnFilterButton } from "@/components/ColumnFilterButton";
import { TableCell, TableHead, type SortDirection } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { UseTableColumnsResult } from "@/lib/hooks/useTableColumns";
import { cn } from "@/lib/utils";

/**
 * The declarative column model that backs hide/show, reorder, per-column filters,
 * sorting, and CSV export from a single descriptor per column — replacing the four
 * hand-written places (TableHead / TableCell / sort accessor / ExportColumn) a page
 * used to keep in sync by hand. Pair with {@link useTableColumns}, {@link ColumnHeads},
 * and {@link ColumnCells}.
 */

export interface ColumnFilterOption {
  value: string;
  label: string;
}

/** Per-column filter spec. The control is chosen by `kind`; the page owns where the
 *  value lives (URL via `useFilterState`, or the hook's internal state). */
export type ColumnFilter<T> =
  | { kind: "text"; predicate: (row: T, query: string) => boolean }
  | {
      kind: "select";
      /** Options derived from the (unfiltered) rows, so the list reflects real data. */
      options: (rows: readonly T[]) => ColumnFilterOption[];
      predicate: (row: T, value: string) => boolean;
      /** Label for the "no filter" entry (e.g. "All payments"). */
      allLabel?: string;
    }
  | { kind: "number-range"; accessor: (row: T) => number | null | undefined }
  | { kind: "date-range"; accessor: (row: T) => string | null | undefined };

export interface TableColumn<T> {
  /** Stable id — the single key used for sort, hide, reorder, persistence and filtering. */
  id: string;
  /** Visible header. Provide `label` too when this isn't a plain string. */
  header: React.ReactNode;
  /** Plain-text label for the columns menu / CSV header when `header` isn't a string. */
  label?: string;
  /** Classes for the header cell (width + alignment travel with the column). */
  headClassName?: string;
  /** Render the body cell contents. Wrapped in a `<TableCell>` unless `rawCell`. */
  cell: (row: T) => React.ReactNode;
  /** Summary-row contents for this column, given the rows currently in view. Omit
   *  for a blank footer cell. Any column with a `footer` makes the table render a
   *  sticky footer (see {@link ColumnFooter} and `hasFooter`). */
  footer?: (rows: readonly T[]) => React.ReactNode;
  /** The cell renders its OWN `<td>` (e.g. `CurrencyCell`); don't wrap it. */
  rawCell?: boolean;
  /** Per-row class on the wrapping `<TableCell>` (e.g. an overdue highlight). */
  cellClassName?: string | ((row: T) => string);
  /** Hover text shown in a styled tooltip on the cell (useful with `truncate` to
   *  reveal clipped free text). Replaces the native `title` popup. */
  cellTitle?: (row: T) => string | undefined;
  /** Single-line clamp for long free text (forwards to `<TableCell truncate>`). */
  truncate?: boolean;
  /** Sort value accessor. Omit to make the column unsortable. */
  sortAccessor?: (row: T) => unknown;
  /** CSV header; defaults to `header` (when a string) or `id`. */
  exportHeader?: string;
  /** CSV value; defaults to `sortAccessor`. Omit both to exclude from export. */
  exportValue?: (row: T) => string | number | null | undefined;
  /** Emit the CSV value as a raw (unquoted) number. */
  exportNumeric?: boolean;
  /** Filter spec; omit for a non-filterable column. */
  filter?: ColumnFilter<T>;
  /** Default true. Set false for columns that must always show (e.g. row actions). */
  enableHiding?: boolean;
  /** Start hidden (still toggleable in the columns menu). */
  defaultHidden?: boolean;
  /** Pin to an edge: excluded from hide + reorder, kept at the left/right. */
  pin?: "left" | "right";
}

/** Identity helper purely for type inference at the call site. */
export function defineColumns<T>(columns: TableColumn<T>[]): TableColumn<T>[] {
  return columns;
}

/** Plain-text label for a column (menu / export fallbacks). */
export function columnLabel<T>(col: TableColumn<T>): string {
  return col.label ?? (typeof col.header === "string" ? col.header : col.id);
}

function resolveCellClassName<T>(col: TableColumn<T>, row: T): string | undefined {
  return typeof col.cellClassName === "function" ? col.cellClassName(row) : col.cellClassName;
}

/** Renders the `<TableHead>`s for the visible columns, wiring sort + filter funnels. */
export function ColumnHeads<T>({
  cols,
  getSortProps,
  filterRows,
}: {
  cols: UseTableColumnsResult<T>;
  getSortProps: (id: string) => { sortDirection: SortDirection | false; onSort: () => void };
  /** Unfiltered rows — feed the filter selects so their options reflect real data. */
  filterRows: readonly T[];
}) {
  return (
    <>
      {cols.visible.map((col) => (
        <TableHead
          key={col.id}
          colId={col.id}
          className={col.headClassName}
          {...(col.sortAccessor ? getSortProps(col.id) : {})}
          headerAction={
            col.filter ? (
              <ColumnFilterButton
                col={col}
                rows={filterRows}
                value={cols.filterValue(col.id)}
                onChange={(value) => cols.setFilter(col.id, value)}
              />
            ) : undefined
          }
        >
          {col.header}
        </TableHead>
      ))}
    </>
  );
}

/** Renders the body cells of one row for the visible columns. */
export function ColumnCells<T>({ cols, row }: { cols: UseTableColumnsResult<T>; row: T }) {
  return (
    <>
      {cols.visible.map((col) => {
        const content = col.cell(row);
        if (col.rawCell) {
          // The column owns its <td> (e.g. CurrencyCell) — render it as a direct
          // child of the row, no wrapping cell.
          return <React.Fragment key={col.id}>{content}</React.Fragment>;
        }
        if (import.meta.env.DEV && React.isValidElement(content) && content.type === "td") {
          console.warn(
            `[data-table] column "${col.id}" returns a <td> but isn't marked rawCell — this nests <td> inside <td>.`,
          );
        }
        const title = col.cellTitle?.(row);
        if (!title) {
          return (
            <TableCell key={col.id} truncate={col.truncate} className={resolveCellClassName(col, row)}>
              {content}
            </TableCell>
          );
        }
        return (
          <TooltipCell
            key={col.id}
            truncate={col.truncate}
            className={resolveCellClassName(col, row)}
            title={title}
          >
            {content}
          </TooltipCell>
        );
      })}
    </>
  );
}

/** Renders the summary (footer) cells for the visible columns. Each cell reuses the
 *  column's `headClassName` so width + alignment match the header; columns without a
 *  `footer` render an empty cell. Place inside a `<TableFooter>`. */
export function ColumnFooter<T>({
  cols,
  rows,
}: {
  cols: UseTableColumnsResult<T>;
  rows: readonly T[];
}) {
  return (
    <>
      {cols.visible.map((col) => (
        <TableCell key={col.id} className={cn(col.headClassName)}>
          {col.footer?.(rows)}
        </TableCell>
      ))}
    </>
  );
}

/** Does `root` (or any overflow-clipping descendant) actually clip its content?
 *  Walks the subtree because the clipping element varies by column: the `truncate`
 *  prop clamps a `line-clamp` div (vertical), while hand-rolled `truncate` spans
 *  clip horizontally — we only want a tooltip when text is genuinely cut off.
 *  Only ever called from open-time event handlers, so it never runs during SSR. */
function isClipped(root: HTMLElement): boolean {
  const TOL = 1; // sub-pixel rounding slack
  const stack: HTMLElement[] = [root];
  while (stack.length) {
    const el = stack.pop() as HTMLElement;
    const style = getComputedStyle(el);
    if (style.overflowX !== "visible" && el.scrollWidth - el.clientWidth > TOL) return true;
    if (style.overflowY !== "visible" && el.scrollHeight - el.clientHeight > TOL) return true;
    for (const child of el.children) if (child instanceof HTMLElement) stack.push(child);
  }
  return false;
}

/** A {@link TableCell} that shows a styled tooltip with `title` — but only when the
 *  cell's text is actually clipped (so fully-visible values get no redundant popup).
 *  The clip check runs at open time, so it stays correct across column resizes
 *  without any observers: Radix's hover/focus still drives it, we just veto opening
 *  when nothing is cut off. */
function TooltipCell({
  truncate,
  className,
  title,
  children,
}: {
  truncate?: boolean;
  className?: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLTableCellElement>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => setOpen(next && ref.current != null && isClipped(ref.current))}
    >
      <TooltipTrigger asChild>
        <TableCell ref={ref} truncate={truncate} className={className}>
          {children}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-md whitespace-pre-wrap break-words">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
