import { CalendarDays, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  daysAgoISO,
  parseISODate,
  startOfMonthISO,
  startOfQuarterISO,
  startOfTrailingMonthsISO,
  startOfYearISO,
  toISODate,
  todayISO,
} from "@/lib/date";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Commit a typed field: "" clears, a full valid YYYY-MM-DD updates, anything
 * partial/invalid leaves the current value untouched (so half-typed dates don't
 * wipe the selection). Accepts pasted ISO datetimes too (parseISODate slices). */
function commitTyped(raw: string, current: string): string {
  const t = raw.trim();
  if (t === "") return "";
  const d = parseISODate(t);
  return d && t.length >= 10 ? toISODate(d) : current;
}

/**
 * Inline clear (×). A real focusable `<button>` (not an icon with an onClick) so
 * keyboard and screen-reader users can clear too, rendered as a sibling of the
 * trigger rather than nested inside it (a button inside a button is invalid).
 */
function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      // Stop the press from reaching the trigger underneath (Radix toggles the
      // popover on the trigger's pointer/click) so the × clears, never opens.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className="absolute right-1.5 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
    >
      <X className="size-3.5" />
    </button>
  );
}

// ---- Single date ------------------------------------------------------------

interface DatePickerProps {
  /** Selected date as `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Show an inline clear (×) when a date is set. Default: true. */
  clearable?: boolean;
  disabled?: boolean;
}

/**
 * shadcn-style single date picker (popover + calendar). Drop-in replacement for
 * `<Input type="date">`: takes and emits a `YYYY-MM-DD` string.
 */
export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "Pick a date",
  className,
  clearable = true,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);
  // Typed/pasted entry, kept in sync with the external value. The calendar month
  // is controlled so typing a date scrolls the grid to it.
  const [text, setText] = useState(value);
  const [month, setMonth] = useState<Date | undefined>(selected);
  useEffect(() => {
    setText(value);
    const d = parseISODate(value);
    if (d) setMonth(d);
  }, [value]);

  const onType = (raw: string) => {
    setText(raw);
    const next = commitTyped(raw, value);
    if (next !== value) onChange(next);
    const d = parseISODate(raw);
    if (d) setMonth(d);
  };

  const showClear = clearable && !disabled && !!value;

  return (
    <div className={cn("relative inline-flex", className)}>
      {/* modal: inside a Radix modal Dialog the body has pointer-events:none, and a
          non-modal portalled popover never re-enables them — days render unclickable. */}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Revert uncommitted/invalid text on close so the field never shows a
          // value that wasn't actually applied.
          if (!o) setText(value);
        }}
        modal
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-10 w-full justify-start gap-2 px-3 font-normal",
              showClear && "pr-9",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{selected ? formatDate(value) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <div className="border-b p-2">
            <Input
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder="YYYY-MM-DD"
              inputMode="numeric"
              aria-label="Type or paste a date (YYYY-MM-DD)"
              className="h-8"
            />
          </div>
          <Calendar
            mode="single"
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={(d) => {
              onChange(d ? toISODate(d) : "");
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {showClear && <ClearButton label="Clear date" onClear={() => onChange("")} />}
    </div>
  );
}

// ---- Date range -------------------------------------------------------------

interface DateRangePickerProps {
  /** Range bounds as `YYYY-MM-DD` strings, or "" when unset. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Number of month grids shown side by side. Default: 2. */
  numberOfMonths?: number;
  /** Show the quick-preset rail (This month, YTD, …). Default: true. */
  presets?: boolean;
}

/** Quick presets, all anchored to today and computed at click time so "today"
 * stays fresh. All end at today (never phantom-future) so they're safe defaults
 * for historical filters; forward ranges are still picked by hand. */
const RANGE_PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Last 30 days", range: () => [daysAgoISO(29), todayISO()] },
  { label: "Last 90 days", range: () => [daysAgoISO(89), todayISO()] },
  { label: "This month", range: () => [startOfMonthISO(), todayISO()] },
  { label: "This quarter", range: () => [startOfQuarterISO(), todayISO()] },
  { label: "Year to date", range: () => [startOfYearISO(), todayISO()] },
  { label: "Last 12 months", range: () => [startOfTrailingMonthsISO(12), todayISO()] },
];

function rangeLabel(from: string, to: string): string | null {
  if (!from && !to) return null;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  return `Until ${formatDate(to)}`;
}

/**
 * shadcn-style date-range picker (popover + preset rail + two-month range
 * calendar). Takes and emits `YYYY-MM-DD` strings for both bounds; either bound
 * may be empty. A reversed range (from > to) is auto-corrected on commit.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  id,
  placeholder = "Date range",
  className,
  numberOfMonths = 2,
  presets = true,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined =
    from || to ? { from: parseISODate(from), to: parseISODate(to) } : undefined;
  const label = rangeLabel(from, to);

  // Typed/pasted entry for each bound, kept in sync with the external values.
  const [fromText, setFromText] = useState(from);
  const [toText, setToText] = useState(to);
  const [month, setMonth] = useState<Date | undefined>(parseISODate(from) ?? parseISODate(to));
  useEffect(() => setFromText(from), [from]);
  useEffect(() => setToText(to), [to]);

  // Emit ordered bounds: a reversed range (from > to, easy to hit by typing or
  // by clicking the end before the start) is silently swapped, otherwise
  // `withinRange` would match nothing and the view would go quietly empty.
  const emit = (f: string, t: string) => {
    if (f && t && f > t) onChange(t, f);
    else onChange(f, t);
  };

  const onTypeFrom = (raw: string) => {
    setFromText(raw);
    emit(commitTyped(raw, from), commitTyped(toText, to));
    const d = parseISODate(raw);
    if (d) setMonth(d);
  };
  const onTypeTo = (raw: string) => {
    setToText(raw);
    emit(commitTyped(fromText, from), commitTyped(raw, to));
    const d = parseISODate(raw);
    if (d) setMonth(d);
  };

  const applyPreset = (f: string, t: string) => {
    emit(f, t);
    const d = parseISODate(f);
    if (d) setMonth(d);
  };

  return (
    <div className={cn("relative inline-flex", className)}>
      {/* modal: see DatePicker — keeps the calendar clickable inside modal dialogs. */}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setFromText(from);
            setToText(to);
          }
        }}
        modal
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "h-10 w-full justify-start gap-2 px-3 font-normal",
              label && "pr-9",
              !label && "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{label ?? placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <div className="flex flex-col sm:flex-row">
            {presets && (
              <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
                {RANGE_PRESETS.map((p) => {
                  const [pf, pt] = p.range();
                  const active = from === pf && to === pt;
                  return (
                    <Button
                      key={p.label}
                      type="button"
                      variant={active ? "secondary" : "ghost"}
                      size="sm"
                      className="justify-start"
                      aria-pressed={active}
                      onClick={() => applyPreset(pf, pt)}
                    >
                      {p.label}
                    </Button>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                  onClick={() => onChange("", "")}
                >
                  All time
                </Button>
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 border-b p-2">
                <Input
                  value={fromText}
                  onChange={(e) => onTypeFrom(e.target.value)}
                  placeholder="From  YYYY-MM-DD"
                  inputMode="numeric"
                  aria-label="From date (YYYY-MM-DD)"
                  className="h-8"
                />
                <span className="shrink-0 text-muted-foreground">–</span>
                <Input
                  value={toText}
                  onChange={(e) => onTypeTo(e.target.value)}
                  placeholder="To  YYYY-MM-DD"
                  inputMode="numeric"
                  aria-label="To date (YYYY-MM-DD)"
                  className="h-8"
                />
              </div>
              <Calendar
                mode="range"
                selected={selected}
                month={month}
                onMonthChange={setMonth}
                numberOfMonths={numberOfMonths}
                // Build the range from the clicked day (triggerDate), not
                // react-day-picker's derived range: from a clean state its first
                // click returns a single-day {from, to}, which would wrongly fill
                // `to`. Two-click semantics — 1st click sets only `from`; 2nd
                // completes it (ordered); a click with a full range starts over.
                // No setMonth here: the clicked day is already on screen, and
                // jumping to it would scroll a cross-month range's start away.
                onSelect={(_range, triggerDate) => {
                  if (!triggerDate) return;
                  const iso = toISODate(triggerDate);
                  if (from && !to) emit(from, iso);
                  else if (to && !from) emit(iso, to);
                  else onChange(iso, "");
                }}
                autoFocus
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {label && <ClearButton label="Clear date range" onClear={() => onChange("", "")} />}
    </div>
  );
}
