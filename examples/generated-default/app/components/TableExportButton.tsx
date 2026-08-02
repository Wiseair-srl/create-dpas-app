import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** One CSV column: a header and how to read it from a row. */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /**
   * Emit as a raw number (dot decimal, unquoted) so spreadsheets parse it
   * numerically. Without this, numbers are stringified and quoted as text.
   */
  numeric?: boolean;
}

const NEEDS_QUOTING = /[",\n\r]/;

function escapeField(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Build a comma-separated CSV (CRLF rows). Text fields are quoted as needed. */
export function buildCsv<T>(rows: readonly T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const v = c.value(row);
        if (v == null) return "";
        if (c.numeric && typeof v === "number") return Number.isFinite(v) ? String(v) : "";
        return escapeField(String(v));
      })
      .join(","),
  );
  return [header, ...body].join("\r\n");
}

/** Trigger a client-side download of `csv` as `filename`, with a UTF-8 BOM for Excel.
 *  Browser-only by construction (Blob + anchor click); only ever called from
 *  click handlers, so it never runs during SSR. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Export" button for a `TableToolbar` actions slot. Exports the *current view*
 * (already filtered/sorted rows the page passes in) to a comma-separated CSV.
 */
export function TableExportButton<T>({
  rows,
  columns,
  filename,
  label = "Export",
}: {
  rows: readonly T[];
  columns: ExportColumn<T>[];
  /** File name without extension. */
  filename: string;
  /** Button label — override when two export buttons sit side by side. */
  label?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={rows.length === 0}
      onClick={() => {
        downloadCsv(`${filename}.csv`, buildCsv(rows, columns));
        toast.success(`Exported ${rows.length} ${rows.length === 1 ? "row" : "rows"}`);
      }}
    >
      <Download className="size-4" />
      {label}
    </Button>
  );
}
