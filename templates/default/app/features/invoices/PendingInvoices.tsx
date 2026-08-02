import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { formatEur, type InvoiceRow } from "../../../capabilities/model";
import { KpiCard } from "@/components/KpiCard";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { PageHeader } from "@/components/PageHeader";
import { TableToolbar } from "@/components/TableToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnCells, ColumnHeads, defineColumns } from "@/components/ui/data-table";
import { DataTableSkeleton, QueryErrorRow, TableEmpty } from "@/components/ui/loaders";
import { SelectField } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useTableSort,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { useFilterState, useUrlSort } from "@/lib/hooks/useFilterState";
import { pendingInvoicesTableContract } from "@/agent/surface/contracts";
import { useTableAgentComponent } from "@/lib/hooks/useTableAgentComponent";
import { useTableColumns } from "@/lib/hooks/useTableColumns";
import { useSession } from "@/lib/session";
import { ChaseDialog } from "../collections/ChaseDialog";
import { useAging, useInvoices, useMarkInvoicePaid, useReceivablesSummary } from "./hooks";

/**
 * The collections working set: every issued invoice that has not been paid.
 *
 * This is the screen the copilot is most useful on, so it registers the fullest
 * presentation plane — filters, sort, columns, selection — through
 * `useTableAgentComponent`. Every capability routes through the SAME setter the
 * toolbar calls, so the agent path and the human path are one implementation
 * and the URL stays the source of truth: a view the agent narrowed is a view
 * the user can bookmark.
 */

const DUE_OPTIONS = [
  { value: "all", label: "All pending" },
  { value: "overdue", label: "Overdue only" },
  { value: "current", label: "Not yet due" },
];

export function PendingInvoices() {
  const { user } = useSession();
  const invoices = useInvoices("pending");
  const summary = useReceivablesSummary();
  const aging = useAging();
  const markPaid = useMarkInvoicePaid();

  // `chase` rides in the same URL state as the filters, for the same reason
  // they do: the dialog is part of what you are looking at, so it belongs in
  // the thing you can bookmark and send to someone. It also makes the state
  // the contextual binding needs reachable by a surface scenario — a binding
  // only ever snapshotted closed is a binding nobody reviews bound.
  const filters = useFilterState({ q: "", due: "all", chase: "" });
  const sortControl = useUrlSort("sort", { key: "days_overdue", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const chasing = Number(filters.values.chase) || null;
  const setChasing = (id: number | null) => filters.set("chase", id === null ? "" : String(id));

  const columns = useMemo(
    () =>
      defineColumns<InvoiceRow>([
        {
          id: "reference",
          header: "Invoice",
          pin: "left",
          sortAccessor: (row) => row.reference,
          cell: (row) => <span className="font-mono text-xs">{row.reference}</span>,
          exportValue: (row) => row.reference,
        },
        {
          id: "client_name",
          header: "Client",
          sortAccessor: (row) => row.client_name,
          filter: {
            kind: "select",
            // Options come from the UNFILTERED rows, so narrowing by client
            // never removes the option you would need to widen back to.
            options: (rows) =>
              [...new Set(rows.map((row) => row.client_name))]
                .sort()
                .map((name) => ({ value: name, label: name })),
            predicate: (row, value) => row.client_name === value,
            allLabel: "All clients",
          },
          cell: (row) => row.client_name,
          exportValue: (row) => row.client_name,
        },
        {
          id: "segment",
          header: "Segment",
          filter: {
            kind: "select",
            options: (rows) =>
              [...new Set(rows.map((row) => row.segment))]
                .sort()
                .map((segment) => ({ value: segment, label: segment })),
            predicate: (row, value) => row.segment === value,
            allLabel: "All segments",
          },
          cell: (row) => <span className="text-muted-foreground">{row.segment}</span>,
          exportValue: (row) => row.segment,
        },
        {
          id: "amount",
          header: "Amount",
          headClassName: "text-right",
          cellClassName: "text-right tabular-nums",
          sortAccessor: (row) => row.amount,
          filter: { kind: "number-range", accessor: (row) => row.amount / 100 },
          cell: (row) => formatEur(row.amount),
          exportValue: (row) => row.amount / 100,
          exportNumeric: true,
        },
        {
          id: "due_date",
          header: "Due",
          sortAccessor: (row) => row.due_date,
          filter: { kind: "date-range", accessor: (row) => row.due_date },
          cell: (row) => <span className="text-muted-foreground">{formatDate(row.due_date)}</span>,
          exportValue: (row) => row.due_date,
        },
        {
          id: "days_overdue",
          header: "Overdue",
          headClassName: "text-right",
          cellClassName: "text-right",
          sortAccessor: (row) => row.days_overdue,
          cell: (row) =>
            row.days_overdue > 0 ? (
              <Badge variant="destructive">{row.days_overdue}d</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          exportValue: (row) => row.days_overdue,
          exportNumeric: true,
        },
        {
          id: "reminders",
          header: "Chased",
          headClassName: "text-right",
          cellClassName: "text-right tabular-nums text-muted-foreground",
          sortAccessor: (row) => row.collection?.reminders_sent ?? 0,
          cell: (row) => row.collection?.reminders_sent ?? 0,
          exportValue: (row) => row.collection?.reminders_sent ?? 0,
          exportNumeric: true,
        },
      ]),
    [],
  );

  const cols = useTableColumns(columns, { storageKey: "pending-invoices" });
  const all = useMemo(() => invoices.data ?? [], [invoices.data]);

  const filtered = useMemo(() => {
    const q = filters.values.q.trim().toLowerCase();
    return cols.applyColumnFilters(
      all.filter((row) => {
        if (q && !`${row.reference} ${row.client_name}`.toLowerCase().includes(q)) return false;
        if (filters.values.due === "overdue" && row.days_overdue <= 0) return false;
        if (filters.values.due === "current" && row.days_overdue > 0) return false;
        return true;
      }),
    );
  }, [all, filters.values, cols]);

  const { sorted, getSortProps } = useTableSort(filtered, cols.sortAccessors, undefined, sortControl);
  const rows = useMemo(() => sorted ?? [], [sorted]);

  // Stale-selection cleanup, derived at render: an id that falls out of the
  // visible set leaves the effective selection immediately, so a bound input
  // never points at a row the user is no longer looking at.
  const visibleIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const selection = useMemo(
    () => selectedIds.filter((id) => visibleIds.has(id)),
    [selectedIds, visibleIds],
  );

  useTableAgentComponent<InvoiceRow, typeof filters.values>({
    contract: pendingInvoicesTableContract,
    rows,
    total: all.length,
    filterRows: all,
    rowSummary: (row) => ({
      id: row.id,
      reference: row.reference,
      client: row.client_name,
      amount: row.amount,
      dueDate: row.due_date,
      daysOverdue: row.days_overdue,
      remindersSent: row.collection?.reminders_sent ?? 0,
    }),
    filters,
    columns: cols,
    sort: sortControl,
    selection: { ids: selection, select: setSelectedIds },
    rowId: (row) => row.id,
  });

  const selectedRows = rows.filter((row) => selection.includes(row.id));
  const chasingRow = rows.find((row) => row.id === chasing) ?? null;
  const isController = user?.role === "controller";
  const allSelected = rows.length > 0 && selection.length === rows.length;
  const over90 = aging.data?.find((bucket) => bucket.id === "90+")?.count ?? 0;

  return (
    <div>
      <PageHeader title="Pending invoices" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Outstanding" value={summary.data ? formatEur(summary.data.outstanding) : "—"} />
        <KpiCard
          label="Overdue"
          value={summary.data ? formatEur(summary.data.overdue) : "—"}
          hint={summary.data ? `${summary.data.overdueCount} invoices` : undefined}
          tone="negative"
        />
        <KpiCard
          label="Collected (30d)"
          value={summary.data ? formatEur(summary.data.collected30d) : "—"}
          tone="positive"
        />
        <KpiCard
          label="Avg days to pay"
          // Null means nothing has been settled yet, which is not the same fact
          // as "paid on day zero" — a KPI that renders it as 0 is lying.
          value={
            summary.data === undefined || summary.data.averageDaysToPay === null
              ? "—"
              : String(summary.data.averageDaysToPay)
          }
          hint={aging.data ? `${over90} over 90 days` : undefined}
        />
      </div>

      <TableToolbar
        search={filters.values.q}
        onSearchChange={(value) => filters.set("q", value)}
        searchPlaceholder="Search invoice or client…"
        filters={
          <SelectField
            ariaLabel="Filter by due status"
            value={filters.values.due}
            onValueChange={(value) => filters.set("due", value)}
            options={DUE_OPTIONS}
            className="w-[11rem]"
          />
        }
        hasActiveFilters={
          filters.values.q !== "" || filters.values.due !== "all" || cols.hasActiveFilters
        }
        onClearFilters={() => {
          // Preserved deliberately: "clear filters" is about narrowing, and
          // closing the dialog you have open is not what it says.
          filters.setMany({ q: "", due: "all" });
          cols.clearFilters();
        }}
        actions={<ColumnsMenu cols={cols} />}
        count={rows.length}
        total={all.length}
      />

      {selection.length > 0 ? (
        <div className="mb-2 flex h-8 flex-wrap items-center gap-2 text-xs" aria-live="polite">
          <span className="font-medium">
            {selection.length} selected ·{" "}
            {formatEur(selectedRows.reduce((total, row) => total + row.amount, 0))}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
            Clear
          </Button>
          {isController ? (
            <Button
              size="sm"
              variant="outline"
              disabled={markPaid.isPending}
              onClick={() => {
                for (const row of selectedRows) markPaid.mutate({ id: row.id });
                setSelectedIds([]);
              }}
            >
              <Check className="size-3.5" aria-hidden /> Record payment
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mb-2 flex h-8 items-center text-xs text-muted-foreground">
          Select rows for bulk actions — or ask the copilot.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead colId="select" className="w-9">
              <input
                type="checkbox"
                aria-label={allSelected ? "Deselect all visible rows" : "Select all visible rows"}
                checked={allSelected}
                onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.id))}
                disabled={rows.length === 0}
                className="size-4 align-middle accent-[var(--primary)]"
              />
            </TableHead>
            <ColumnHeads cols={cols} getSortProps={getSortProps} filterRows={all} />
            <TableHead colId="actions" className="w-24 text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.isPending ? (
            <DataTableSkeleton colSpan={cols.colSpan + 2} />
          ) : invoices.isError ? (
            <QueryErrorRow colSpan={cols.colSpan + 2} onRetry={() => void invoices.refetch()} />
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={cols.colSpan + 2}>No pending invoices match.</TableEmpty>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-invoice-row={row.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.reference}`}
                    checked={selection.includes(row.id)}
                    onChange={() =>
                      setSelectedIds((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
                    className="size-4 align-middle accent-[var(--primary)]"
                  />
                </TableCell>
                <ColumnCells cols={cols} row={row} />
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setChasing(row.id)}>
                    Chase
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <ChaseDialog invoice={chasingRow} onClose={() => setChasing(null)} />
    </div>
  );
}
