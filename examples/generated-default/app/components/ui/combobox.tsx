import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional leading swatch (e.g. a category color). Renders a small dot before the label. */
  color?: string;
}

/**
 * Searchable single-select (Popover + cmdk). Drop-in for the old Radix-backed
 * SelectField — same {value, options, onValueChange} contract — but the list
 * filters as you type once it's long enough to be worth a search box (more than
 * `searchThreshold` options). Filtering matches the visible label, not the
 * value (which is often an id/slug). Uses a modal Popover so it stays clickable
 * inside Radix Dialogs (same reason the date pickers do — see date-picker.tsx).
 *
 * Popover-inside-Dialog focus only works if both resolve to the SAME copy of
 * @radix-ui/react-focus-scope: each copy keeps its own scope stack, so with two
 * copies the Dialog never pauses its focus trap and yanks focus off the search
 * input on every keystroke. If search dies again, `pnpm why
 * @radix-ui/react-focus-scope` and re-align the radix versions until one is left.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  searchThreshold = 6,
  className,
  id,
  disabled,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Render the search box only when the list has more than this many options. */
  searchThreshold?: number;
  className?: string;
  id?: string;
  disabled?: boolean;
  /**
   * Accessible name. A combobox whose only label is its current VALUE renames
   * itself every time it is used, which leaves a screen reader — and a test —
   * with no stable handle on the control.
   */
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  const showSearch = options.length > searchThreshold;
  // Reserve an aligned dot column for the whole list once any option has a color,
  // so labels stay flush whether or not a given row carries a swatch.
  const anyColor = options.some((o) => o.color);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-xs ring-offset-background focus:outline-hidden focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("min-w-0 truncate text-left", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[10rem] p-0" align="start">
        {/* Match on the label substring (cmdk lowercases both sides for us). */}
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          {showSearch && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            {showSearch && <CommandEmpty>{emptyText}</CommandEmpty>}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  // Searchable text = label (+ value to keep keys unique across dup labels).
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 size-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")}
                  />
                  {anyColor &&
                    (o.color ? (
                      <span
                        className="mr-1.5 size-2 shrink-0 rounded-full border"
                        style={{ backgroundColor: o.color }}
                      />
                    ) : (
                      <span className="mr-1.5 size-2 shrink-0" />
                    ))}
                  <span className="min-w-0 truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
