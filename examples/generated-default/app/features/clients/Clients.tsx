import { useMemo } from "react";

import { formatEur } from "../../../capabilities/model";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { PageHeader } from "@/components/PageHeader";
import { TableToolbar } from "@/components/TableToolbar";
import { ColumnCells, ColumnHeads, defineColumns } from "@/components/ui/data-table";
import { DataTableSkeleton, QueryErrorRow, TableEmpty } from "@/components/ui/loaders";
import { Table, TableBody, TableHeader, TableRow, useTableSort } from "@/components/ui/table";
import { useFilterState, useUrlSort } from "@/lib/hooks/useFilterState";
import { clientsTableContract } from "@/agent/surface/contracts";
import { useTableAgentComponent } from "@/lib/hooks/useTableAgentComponent";
import { useTableColumns } from "@/lib/hooks/useTableColumns";
import { useClients } from "../invoices/hooks";

/**
 * Who owes what. The simplest of the three screens, and deliberately so: it
 * registers the same table plane as the other two with a third of the code,
 * which is the point of putting that plane in a hook.
 */

interface ClientRow {
  id: number;
  name: string;
  segment: string;
  payment_terms_days: number;
  email: string;
  open_invoices: number;
  outstanding: number;
  overdue: number;
}

export function Clients() {
  const clients = useClients();
  const filters = useFilterState({ q: "" });
  const sortControl = useUrlSort("sort", { key: "outstanding", direction: "desc" });

  const columns = useMemo(
    () =>
      defineColumns<ClientRow>([
        {
          id: "name",
          header: "Client",
          pin: "left",
          sortAccessor: (row) => row.name,
          cellClassName: "font-medium",
          cell: (row) => row.name,
          exportValue: (row) => row.name,
        },
        {
          id: "segment",
          header: "Segment",
          sortAccessor: (row) => row.segment,
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
          id: "payment_terms_days",
          header: "Terms",
          headClassName: "text-right",
          cellClassName: "text-right tabular-nums text-muted-foreground",
          sortAccessor: (row) => row.payment_terms_days,
          cell: (row) => `${row.payment_terms_days}d`,
          exportValue: (row) => row.payment_terms_days,
          exportNumeric: true,
        },
        {
          id: "open_invoices",
          header: "Open",
          headClassName: "text-right",
          cellClassName: "text-right tabular-nums",
          sortAccessor: (row) => row.open_invoices,
          cell: (row) => row.open_invoices,
          exportValue: (row) => row.open_invoices,
          exportNumeric: true,
        },
        {
          id: "outstanding",
          header: "Outstanding",
          headClassName: "text-right",
          cellClassName: "text-right tabular-nums",
          sortAccessor: (row) => row.outstanding,
          cell: (row) => formatEur(row.outstanding),
          exportValue: (row) => row.outstanding / 100,
          exportNumeric: true,
        },
        {
          id: "overdue",
          header: "Overdue",
          headClassName: "text-right",
          cellClassName: (row) =>
            row.overdue > 0
              ? "text-right tabular-nums text-negative"
              : "text-right tabular-nums text-muted-foreground",
          sortAccessor: (row) => row.overdue,
          cell: (row) => formatEur(row.overdue),
          exportValue: (row) => row.overdue / 100,
          exportNumeric: true,
        },
        {
          id: "email",
          header: "Billing email",
          defaultHidden: true,
          truncate: true,
          cell: (row) => row.email,
          exportValue: (row) => row.email,
        },
      ]),
    [],
  );

  const cols = useTableColumns(columns, { storageKey: "clients" });
  const all = useMemo(() => (clients.data ?? []) as ClientRow[], [clients.data]);

  const filtered = useMemo(() => {
    const q = filters.values.q.trim().toLowerCase();
    return cols.applyColumnFilters(
      q ? all.filter((row) => row.name.toLowerCase().includes(q)) : all,
    );
  }, [all, filters.values.q, cols]);

  const { sorted, getSortProps } = useTableSort(filtered, cols.sortAccessors, undefined, sortControl);
  const rows = useMemo(() => sorted ?? [], [sorted]);

  useTableAgentComponent<ClientRow, typeof filters.values>({
    contract: clientsTableContract,
    rows,
    total: all.length,
    filterRows: all,
    rowSummary: (row) => ({
      id: row.id,
      name: row.name,
      segment: row.segment,
      paymentTermsDays: row.payment_terms_days,
      openInvoices: row.open_invoices,
      outstanding: row.outstanding,
      overdue: row.overdue,
    }),
    filters,
    columns: cols,
    sort: sortControl,
  });

  return (
    <div>
      <PageHeader title="Clients" />
      <TableToolbar
        search={filters.values.q}
        onSearchChange={(value) => filters.set("q", value)}
        searchPlaceholder="Search clients…"
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
          {clients.isPending ? (
            <DataTableSkeleton colSpan={cols.colSpan} />
          ) : clients.isError ? (
            <QueryErrorRow colSpan={cols.colSpan} onRetry={() => void clients.refetch()} />
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={cols.colSpan}>No clients match.</TableEmpty>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-client-row={row.id}>
                <ColumnCells cols={cols} row={row} />
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
