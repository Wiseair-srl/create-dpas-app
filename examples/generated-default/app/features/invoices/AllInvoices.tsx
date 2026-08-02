import { useMemo } from "react";

import { formatEur, type InvoiceRow } from "../../../capabilities/model";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { PageHeader } from "@/components/PageHeader";
import { TableToolbar } from "@/components/TableToolbar";
import { Badge } from "@/components/ui/badge";
import { ColumnCells, ColumnHeads, defineColumns } from "@/components/ui/data-table";
import { DataTableSkeleton, QueryErrorRow, TableEmpty } from "@/components/ui/loaders";
import { Table, TableBody, TableHeader, TableRow, useTableSort } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { useFilterState, useUrlSort } from "@/lib/hooks/useFilterState";
import { allInvoicesTableContract } from "@/agent/surface/contracts";
import { useTableAgentComponent } from "@/lib/hooks/useTableAgentComponent";
import { useTableColumns } from "@/lib/hooks/useTableColumns";
import { useInvoices } from "./hooks";

/**
 * The whole ledger, drafts included.
 *
 * Narrowing here is per-COLUMN rather than by toolbar selects — the second of
 * the two filter layers `useTableAgentComponent` exposes (`setColumnFilters`).
 * A screen with only that layer is still a screen the agent can narrow, which
 * is why both are exposed rather than just the toolbar one.
 */

const STATUS_VARIANT: Record<InvoiceRow["status"], "default" | "secondary" | "outline"> = {
  draft: "secondary",
  sent: "default",
  paid: "outline",
};

export function AllInvoices() {
  const invoices = useInvoices("all");
  const filters = useFilterState({ q: "" });
  const sortControl = useUrlSort("sort", { key: "due_date", direction: "desc" });

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
          id: "status",
          header: "Status",
          sortAccessor: (row) => row.status,
          filter: {
            kind: "select",
            // Fixed list rather than derived: a status the ledger happens not to
            // contain today is still a status you can filter to, and an option
            // list that disappears when the last draft is issued is a worse
            // control than one that returns no rows.
            options: () => [
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "paid", label: "Paid" },
            ],
            predicate: (row, value) => row.status === value,
            allLabel: "Any status",
          },
          cell: (row) => <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>,
          exportValue: (row) => row.status,
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
          id: "issue_date",
          header: "Issued",
          sortAccessor: (row) => row.issue_date,
          filter: { kind: "date-range", accessor: (row) => row.issue_date },
          cell: (row) => <span className="text-muted-foreground">{formatDate(row.issue_date)}</span>,
          exportValue: (row) => row.issue_date,
        },
        {
          id: "due_date",
          header: "Due",
          sortAccessor: (row) => row.due_date,
          cell: (row) => <span className="text-muted-foreground">{formatDate(row.due_date)}</span>,
          exportValue: (row) => row.due_date,
        },
      ]),
    [],
  );

  const cols = useTableColumns(columns, { storageKey: "all-invoices" });
  const all = useMemo(() => invoices.data ?? [], [invoices.data]);

  const filtered = useMemo(() => {
    const q = filters.values.q.trim().toLowerCase();
    return cols.applyColumnFilters(
      q ? all.filter((row) => `${row.reference} ${row.client_name}`.toLowerCase().includes(q)) : all,
    );
  }, [all, filters.values.q, cols]);

  const { sorted, getSortProps } = useTableSort(filtered, cols.sortAccessors, undefined, sortControl);
  const rows = useMemo(() => sorted ?? [], [sorted]);

  useTableAgentComponent<InvoiceRow, typeof filters.values>({
    contract: allInvoicesTableContract,
    rows,
    total: all.length,
    filterRows: all,
    rowSummary: (row) => ({
      id: row.id,
      reference: row.reference,
      client: row.client_name,
      status: row.status,
      amount: row.amount,
      issueDate: row.issue_date,
      dueDate: row.due_date,
    }),
    filters,
    columns: cols,
    sort: sortControl,
  });

  return (
    <div>
      <PageHeader title="All invoices" />
      <TableToolbar
        search={filters.values.q}
        onSearchChange={(value) => filters.set("q", value)}
        searchPlaceholder="Search invoice or client…"
        hasActiveFilters={!filters.isDefault || cols.hasActiveFilters}
        onClearFilters={() => {
          filters.reset();
          cols.clearFilters();
        }}
        actions={<ColumnsMenu cols={cols} />}
        count={rows.length}
        total={all.length}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <ColumnHeads cols={cols} getSortProps={getSortProps} filterRows={all} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.isPending ? (
            <DataTableSkeleton colSpan={cols.colSpan} />
          ) : invoices.isError ? (
            <QueryErrorRow colSpan={cols.colSpan} onRetry={() => void invoices.refetch()} />
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={cols.colSpan}>No invoices match these filters.</TableEmpty>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-invoice-row={row.id}>
                <ColumnCells cols={cols} row={row} />
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
