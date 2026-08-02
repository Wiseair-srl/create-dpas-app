import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Loading skeleton rows for a table body. The row height tracks the real
 * virtualized row (~29px: `py-1.5` + `h-4`) so the layout doesn't jump when
 * data arrives. Use a single, consistent row count everywhere.
 */
export function DataTableSkeleton({ rows = 8, colSpan }: { rows?: number; colSpan: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} aria-hidden>
          <TableCell colSpan={colSpan} className="py-1.5">
            <Skeleton className="h-4 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** Standard empty-state row for a table body. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** Error-state row with a retry, for a failed table query. */
export function QueryErrorRow({
  colSpan,
  message = "Couldn’t load this data.",
  onRetry,
}: {
  colSpan: number;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Skeleton sized for a chart card while its data loads. */
export function ChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={className ?? "h-[340px] w-full"} />;
}
