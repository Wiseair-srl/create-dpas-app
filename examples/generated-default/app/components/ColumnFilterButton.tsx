import { ListFilter } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TableColumn } from "@/components/ui/data-table";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SelectField } from "@/components/ui/select";
import { columnLabel } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

/**
 * Per-column filter affordance: a small funnel inside a `<TableHead>` (rendered as
 * the head's `headerAction`, a sibling of the sort button — never nested). The
 * control is chosen by the column's `filter.kind`; the value is fully controlled by
 * the page (via `useTableColumns` → `useFilterState` or internal state).
 */
export function ColumnFilterButton<T>({
  col,
  rows,
  value,
  onChange,
}: {
  col: TableColumn<T>;
  rows: readonly T[];
  value: string;
  onChange: (value: string) => void;
}) {
  const filter = col.filter;
  if (!filter) return null;
  const active = value.trim() !== "";
  const label = columnLabel(col);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${label}`}
          // Sit beside the sort button without triggering it or the resize handle.
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded align-middle text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
            active && "text-primary",
          )}
        >
          <ListFilter className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" onClick={(e) => e.stopPropagation()}>
        {filter.kind === "text" && (
          <Input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Filter ${label.toLowerCase()}…`}
            className="h-8"
          />
        )}

        {filter.kind === "select" && (
          <SelectField
            value={value}
            onValueChange={onChange}
            placeholder={filter.allLabel ?? "All"}
            options={[{ value: "", label: filter.allLabel ?? "All" }, ...filter.options(rows)]}
          />
        )}

        {filter.kind === "number-range" && <NumberRange value={value} onChange={onChange} />}

        {filter.kind === "date-range" && (
          <DateRangePicker
            className="w-full"
            numberOfMonths={1}
            from={value.split(",")[0] ?? ""}
            to={value.split(",")[1] ?? ""}
            onChange={(from, to) => onChange(from || to ? `${from},${to}` : "")}
          />
        )}

        {active && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Two min/max inputs encoding a `"min,max"` value. */
function NumberRange({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [min, max] = value.split(",");
  const emit = (nextMin: string, nextMax: string) =>
    onChange(nextMin || nextMax ? `${nextMin},${nextMax}` : "");
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="decimal"
        value={min ?? ""}
        onChange={(e) => emit(e.target.value, max ?? "")}
        placeholder="Min"
        aria-label="Minimum"
        className="h-8"
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="number"
        inputMode="decimal"
        value={max ?? ""}
        onChange={(e) => emit(min ?? "", e.target.value)}
        placeholder="Max"
        aria-label="Maximum"
        className="h-8"
      />
    </div>
  );
}
