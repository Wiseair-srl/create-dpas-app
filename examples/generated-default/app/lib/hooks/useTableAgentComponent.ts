import type { JsonValue } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";

import {
  MAX_VISIBLE_ROWS,
  type ColumnFilterReport,
  type ColumnVisibilityInput,
  type FilterMap,
  type MoveColumnInput,
  type SelectRowsInput,
  type TableReadState,
  type TableSortInput,
  type allInvoicesTableContract,
  type clientsTableContract,
  type pendingInvoicesTableContract,
} from "@/agent/surface/contracts";
import type { SortState } from "@/components/ui/table";

import type { UseTableColumnsResult } from "./useTableColumns";

/**
 * The presentation plane for a table screen: the BEHAVIOUR half of a table
 * contract. One call gives the agent the semantic verbs a person has looking at
 * the same screen — read what is on it, narrow it, sort it, change which
 * columns are shown.
 *
 * What each table exposes, in what words, with what schema, is declared in
 * app/agent/surface/contracts.ts and compiled into `.agent-surface/contract.json`.
 * This hook supplies only `read`, `execute` and `precondition`. It cannot widen
 * the surface: a binding the contract does not declare is refused by the
 * registry, and a declared capability left unbound throws at mount.
 *
 * Narrowing has TWO layers on this app's tables and both are exposed, because
 * a screen may have either: the toolbar filters of `useFilterState`
 * (`setFilters`) and the per-column funnels of `useTableColumns`
 * (`setColumnFilters`).
 *
 * There is deliberately no `click`, no cell coordinate and no element
 * selector. Every action routes through the SAME setter the toolbar and the
 * column menu call, so the agent path and the human path are one
 * implementation — and the URL stays the source of truth for filters and
 * sort, which is what makes an agent-narrowed view bookmarkable.
 *
 * The capability ids come out as `view:<type>.<key>`, e.g.
 * `view:invoices.pending.setFilters`.
 */

/**
 * The three table contracts this hook can bind.
 *
 * They declare different capability SETS — only `invoices.pending` has a row
 * selection — so the bindings are assembled conditionally below from the same
 * options that decide which contract a screen passes. The two must agree; the
 * runtime says so loudly if they do not.
 */
export type TableAgentContract =
  | typeof clientsTableContract
  | typeof allInvoicesTableContract
  | typeof pendingInvoicesTableContract;

/**
 * Structurally what `useFilterState` returns. Generic over the defaults object
 * so a screen's literal key union (`"q" | "due" | …`) still matches — the
 * setters are keyed to it, and a plain `string` signature would be
 * contravariantly incompatible.
 */
interface FilterStateLike<T extends Record<string, string> = Record<string, string>> {
  values: T;
  set: (key: keyof T, value: string) => void;
  setMany?: (patch: Partial<T>) => void;
  reset: () => void;
}

interface SortLike {
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
}

/**
 * Row selection, when the screen has it. This is what makes a contextual
 * domain action possible: the agent narrows and selects through the view
 * plane, and the bound `domain:` procedure takes its ids from HERE rather than
 * from anything the model typed.
 */
interface SelectionLike {
  /** Currently selected row ids. */
  ids: readonly number[];
  /** Replace the selection wholesale. */
  select: (ids: number[]) => void;
}

export interface TableAgentComponentOptions<
  T,
  F extends Record<string, string> = Record<string, string>,
> {
  /** The compiled contract for THIS table (app/agent/surface/contracts.ts). */
  contract: TableAgentContract;
  /** Rows as currently rendered: filtered AND sorted, in view order. */
  rows: readonly T[];
  /** Rows before this screen's filters, so the model can see what it narrowed away. */
  total?: number;
  /**
   * The rows a per-column `select` filter derives its options from — the same
   * array the screen passes to `<ColumnHeads filterRows>`, i.e. before the
   * column filters but after any upstream narrowing the screen considers
   * structural.
   *
   * Defaults to `rows`, which is the NARROWED set: the option list then shrinks
   * as the model filters, and it can no longer see the value it would need to
   * widen back to. Pass this on any screen with a select column.
   */
  filterRows?: readonly T[];
  /**
   * What the model sees per row. Keep it to the fields it needs to plan with —
   * an id plus the few columns a person would read — never the whole record.
   */
  rowSummary: (row: T) => Record<string, JsonValue>;
  /** URL-synced filter state (`useFilterState`). */
  filters?: FilterStateLike<F>;
  /** Column visibility/order (`useTableColumns`). */
  columns?: UseTableColumnsResult<T>;
  /** URL-synced sort (`useUrlSort`), when the screen has one. */
  sort?: SortLike;
  /** Column ids that can be sorted on. Defaults to the sort accessor map's keys. */
  sortableIds?: readonly string[];
  /** Row selection, when the screen has it. Requires `rowId`. */
  selection?: SelectionLike;
  /** The id of a row. Required when `selection` is given. */
  rowId?: (row: T) => number;
}

/**
 * The bindings a contract's `bind()` consumes. Assembled as a plain record
 * because the set varies per table, then handed to `useAgentComponent` through
 * one cast — the only place types are loosened, and the place both the contract
 * and the registry check the result:
 *
 *   - a key the contract does not declare is refused at registration;
 *   - a declared capability with no binding throws at mount.
 *
 * So a drift between this file and contracts.ts fails on the screen that drifted,
 * on the first render, with the capability named.
 */
type Bindings = Parameters<TableAgentContract["bind"]>[0];

export function useTableAgentComponent<
  T,
  F extends Record<string, string> = Record<string, string>,
>({
  contract,
  rows,
  total,
  filterRows,
  rowSummary,
  filters,
  columns,
  sort,
  sortableIds: explicitSortableIds,
  selection,
  rowId,
}: TableAgentComponentOptions<T, F>): void {
  const sortableIds =
    explicitSortableIds ?? (columns ? Object.keys(columns.sortAccessors) : []);

  /** See `filterRows` — narrowed rows are a lossy source for select options. */
  const optionRows = filterRows ?? rows;
  const columnFilterIds = columns ? columns.filterable.map((c) => c.id) : [];

  /**
   * True when the screen injected its `useFilterState` into `useTableColumns`,
   * so the column filter values live in the same URL params the toolbar reset
   * clears.
   */
  const columnFiltersCoveredByReset =
    filters !== undefined &&
    columnFilterIds.length > 0 &&
    columnFilterIds.every((id) => Object.keys(filters.values).includes(id));

  const observations: Record<string, unknown> = {
    readState: {
      read: (): TableReadState => ({
        visibleRows: rows.slice(0, MAX_VISIBLE_ROWS).map(rowSummary),
        rowCount: rows.length,
        ...(total !== undefined ? { totalRows: total } : {}),
        truncated: rows.length > MAX_VISIBLE_ROWS,
        ...(sort
          ? {
              sort: sort.sort ? { key: sort.sort.key, direction: sort.sort.direction } : null,
            }
          : {}),
      }),
    },
  };

  const actions: Record<string, unknown> = {};

  if (filters) {
    observations.readFilters = { read: (): FilterMap => ({ ...filters.values }) };
    actions.setFilters = {
      // No unknown-key precondition any more: each contract lists its own
      // filter keys with `additionalProperties: false`, so an unknown key is a
      // schema error before any handler runs — and the model can read the valid
      // keys off the schema instead of discovering them from a rejection.
      execute: (patch: FilterMap) => {
        // One URL write — looping `set` drops all but the last key
        // (react-router's functional setter reads a stale ref).
        if (filters.setMany) filters.setMany(patch as Partial<F>);
        else {
          for (const [key, value] of Object.entries(patch)) {
            filters.set(key as keyof F, value);
          }
        }
      },
    };
  }

  if (selection) {
    observations.readSelection = {
      read: () => ({ selectedIds: [...selection.ids], count: selection.ids.length }),
    };
  }

  if (columns) {
    observations.readColumns = {
      // Re-shaped rather than passed through: `ManagedColumn` is an interface,
      // which TS will not treat as index-signature compatible with JsonValue.
      read: () =>
        columns.managed.map((c) => ({
          id: c.id,
          label: c.label,
          hidden: c.hidden,
          hideable: c.hideable,
        })),
    };

    actions.setColumnVisibility = {
      precondition: ({ id }: ColumnVisibilityInput) => {
        const column = columns.managed.find((c) => c.id === id);
        if (!column) {
          return {
            message: `"${id}" is not a movable column on this table.`,
            details: { columnIds: columns.managed.map((c) => c.id) },
          };
        }
        return column.hideable
          ? undefined
          : { message: `"${id}" cannot be hidden on this table.` };
      },
      execute: ({ id, hidden }: ColumnVisibilityInput) => {
        const column = columns.managed.find((c) => c.id === id);
        if (column && column.hidden !== hidden) columns.toggle(id);
      },
    };

    actions.moveColumn = {
      precondition: ({ id }: MoveColumnInput) =>
        columns.managed.some((c) => c.id === id)
          ? undefined
          : {
              message: `"${id}" is not a movable column on this table.`,
              details: { columnIds: columns.managed.map((c) => c.id) },
            },
      execute: ({ id, direction }: MoveColumnInput) =>
        columns.move(id, direction === "left" ? -1 : 1),
    };
  }

  if (columns && columnFilterIds.length) {
    observations.readColumnFilters = {
      // Options are computed at READ time, not at registration: they are
      // derived from live rows, and a list captured on mount would go stale
      // the moment the underlying query resolves.
      read: (): ColumnFilterReport[] =>
        columns.filterable.map((c) => ({
          id: c.id,
          label: c.label,
          kind: c.kind as string,
          value: columns.filterValue(c.id),
          // Re-shaped rather than passed through, same as `readColumns`:
          // `ColumnFilterOption` is an interface.
          ...(c.options
            ? { options: c.options(optionRows).map((o) => ({ value: o.value, label: o.label })) }
            : {}),
        })),
    };

    actions.setColumnFilters = {
      // Through `columns.setFilter`, the same setter the funnel control calls —
      // so a screen that injected `filterState` writes the URL and one that did
      // not writes the hook's own state, without this hook needing to know which.
      execute: (patch: FilterMap) => {
        for (const [id, value] of Object.entries(patch)) columns.setFilter(id, value);
      },
    };
  }

  // One verb for both filter layers: a person clicking "clear" does not
  // distinguish them either, and a model that had to clear each separately
  // would leave a table half-narrowed whenever it forgot the second call.
  if (filters || (columns && columnFilterIds.length)) {
    actions.clearFilters = {
      execute: () => {
        filters?.reset();
        // A screen that injected its `useFilterState` into `useTableColumns`
        // keeps BOTH layers in the same URL params, so the reset above already
        // cleared the columns. Calling `clearFilters` too would be a second
        // router write in the same tick, computed from a pre-reset snapshot —
        // the stale-ref hazard `setMany` exists to avoid.
        if (columnFilterIds.length && !columnFiltersCoveredByReset) {
          columns?.clearFilters();
        }
      },
    };
  }

  if (sort) {
    actions.sort = {
      precondition: ({ key }: TableSortInput) =>
        key === null || sortableIds.includes(key)
          ? undefined
          : {
              message: `"${key}" is not a sortable column on this table.`,
              details: { sortableIds: [...sortableIds] },
            },
      // `direction` is optional and JSON Schema `default` is annotation-only —
      // Agent Surface never applies it — so the fallback lives here.
      execute: ({ key, direction }: TableSortInput) =>
        sort.onSortChange(key === null ? null : { key, direction: direction ?? "desc" }),
    };
  }

  if (selection && rowId) {
    actions.selectRows = {
      precondition: ({ ids }: SelectRowsInput) => {
        // A row the filters are hiding is not a row the user is looking at, so
        // it is not one the agent may act on.
        const visible = new Set(rows.map(rowId));
        const missing = ids.filter((id) => !visible.has(id));
        return missing.length
          ? {
              message: `${missing.length} of those ids are not in the visible rows. Adjust the filters, re-read the table, then select.`,
              details: { missingIds: missing.slice(0, 20) },
            }
          : undefined;
      },
      execute: ({ ids }: SelectRowsInput) => selection.select(ids),
    };
  }

  useAgentComponent(contract, { observations, actions } as unknown as Bindings);
}
