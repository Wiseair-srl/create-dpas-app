import type { TdHTMLAttributes } from "react";

import { TableCell } from "@/components/ui/table";
import { formatEur } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CurrencyCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  value: number | null | undefined;
  /** Render with `font-medium` (e.g. running totals). */
  emphasis?: boolean;
}

/** Right-aligned, tabular-nums EUR cell. The canonical money column. */
export function CurrencyCell({ value, emphasis, className, ...props }: CurrencyCellProps) {
  return (
    <TableCell className={cn("text-right tabular-nums", emphasis && "font-medium", className)} {...props}>
      {value == null ? "—" : formatEur(value)}
    </TableCell>
  );
}

/** EUR cell coloured by sign — green for inflow, red for outflow — via the
 *  `--positive`/`--negative` tokens. Use for signed amounts / deltas. */
export function SignedAmountCell({ value, emphasis, className, ...props }: CurrencyCellProps) {
  return (
    <TableCell
      className={cn(
        "text-right tabular-nums",
        emphasis && "font-medium",
        (value ?? 0) < 0 ? "text-negative" : "text-positive",
        className,
      )}
      {...props}
    >
      {value == null ? "—" : formatEur(value)}
    </TableCell>
  );
}
