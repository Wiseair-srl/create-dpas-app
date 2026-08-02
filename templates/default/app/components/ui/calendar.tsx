import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DropdownProps } from "react-day-picker";

import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Month/year navigation dropdown, rendered in place of react-day-picker's native
 * `<select>` (which pops the OS-native list). Backed by the app's Radix Select so
 * it matches the design system and stays clickable inside the modal popover.
 */
function CalendarDropdown({ options, value, onChange, "aria-label": ariaLabel }: DropdownProps) {
  const current = options?.find((o) => o.value === Number(value));
  return (
    <Select
      value={value != null ? String(value) : undefined}
      onValueChange={(next) =>
        // react-day-picker reads `Number(e.target.value)` — a minimal synthetic
        // change event is all it needs.
        onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>)
      }
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-7 w-fit gap-1 border-0 bg-transparent px-2 py-0 font-medium shadow-none hover:bg-accent focus:ring-1 focus:ring-ring [&>svg]:size-3.5 [&>svg]:opacity-60"
      >
        <SelectValue>{current?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options?.map((o) => (
          <SelectItem key={o.value} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * shadcn-style calendar wrapping react-day-picker (v10), themed with the app's
 * design tokens so it tracks light/dark automatically. Used by the date and
 * date-range pickers; rarely rendered directly.
 *
 * Month/year dropdowns are on by default; without explicit bounds the years
 * list spans ±15y around today (the library default stops at the current year,
 * which would hide future contract end dates).
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  startMonth,
  endMonth,
  ...props
}: CalendarProps) {
  const thisYear = new Date().getFullYear();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth ?? new Date(thisYear - 15, 0)}
      endMonth={endMonth ?? new Date(thisYear + 15, 11)}
      className={cn("p-3", className)}
      classNames={{
        // relative: anchors the absolutely-positioned nav; without it the nav
        // spans the popover and the next button overflows the right border.
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-4",
        month_caption: "flex h-7 items-center justify-center",
        caption_label:
          "flex h-7 select-none items-center gap-1 rounded-md px-2 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
        dropdowns: "flex h-7 items-center justify-center gap-1 text-sm font-medium",
        // pointer-events-none: the nav strip spans the full caption row and would
        // otherwise swallow clicks meant for the month/year dropdowns beneath it.
        nav: "pointer-events-none absolute z-10 flex w-full items-center justify-between px-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto size-7 bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto size-7 bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "w-8 rounded-md text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: cn(
          "relative size-8 p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:bg-selected/40",
          "[&:has(.day-range-start)]:rounded-l-md [&:has(.day-range-end)]:rounded-r-md",
          "[&:has([aria-selected].day-outside)]:bg-selected/20",
          "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 font-normal aria-selected:opacity-100",
        ),
        range_start:
          "day-range-start rounded-l-md [&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
        range_end:
          "day-range-end rounded-r-md [&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary [&>button:focus]:bg-primary",
        range_middle:
          "rounded-none [&>button]:bg-transparent [&>button]:text-foreground [&>button:hover]:bg-transparent",
        today: "[&>button]:font-semibold [&>button]:text-primary",
        outside: "day-outside text-muted-foreground/50 aria-selected:text-muted-foreground/50",
        disabled: "text-muted-foreground/40 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Dropdown: CalendarDropdown,
        Chevron: ({ orientation, className: cls, ...rest }) => {
          const Icon =
            orientation === "left" ? ChevronLeft : orientation === "down" ? ChevronDown : ChevronRight;
          return <Icon className={cn("size-4", cls)} {...rest} />;
        },
      }}
      {...props}
    />
  );
}
