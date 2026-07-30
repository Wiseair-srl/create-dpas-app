"use client";

import { action, observation } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";
import { FilterX, MapPin, Signal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { zs } from "@/agent/surface/schema";
import { CITY_OPTIONS, type StatusFilter } from "@/features/devices/schemas/device";
import {
  FiltersPatchSchema,
  FiltersStateSchema,
  type FiltersState,
} from "@/features/devices/capabilities/schemas";

/**
 * Filter bar. The Agent Surface registration lives WITH the state it
 * describes: while this component is mounted the agent can read and set
 * filters semantically — `view:devices.filters.read` / `.set` — and both
 * paths (human clicks, agent calls) go through the same `onChange`.
 */

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "disabled", label: "Disabled" },
];

const ALL_CITIES = "__all__";

export function DeviceFilters({
  filters,
  onChange,
}: {
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
}) {
  useAgentComponent({
    type: "devices.filters",
    description: "Status and city filters applied to the devices table",
    observations: {
      read: observation({
        description: "Currently active filters",
        output: zs(FiltersStateSchema),
        read: () => filters,
      }),
    },
    actions: {
      set: action({
        description:
          "Update one or both filters; omitted fields keep their current value. " +
          "The table updates through the app's normal data flow.",
        input: zs(FiltersPatchSchema),
        effect: "local-state",
        idempotent: true,
        execute: (patch) =>
          onChange({
            status: patch.status ?? filters.status,
            city: patch.city !== undefined ? patch.city : filters.city,
          }),
      }),
    },
  });

  const isFiltered = filters.status !== "all" || filters.city !== null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Device filters">
      <Select
        ariaLabel="Filter by status"
        value={filters.status}
        onValueChange={(value) => onChange({ ...filters, status: value as StatusFilter })}
        options={STATUS_OPTIONS}
        icon={<Signal aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
      />
      <Select
        ariaLabel="Filter by city"
        value={filters.city ?? ALL_CITIES}
        onValueChange={(value) =>
          onChange({ ...filters, city: value === ALL_CITIES ? null : value })
        }
        options={[
          { value: ALL_CITIES, label: "All cities" },
          ...CITY_OPTIONS.map((city) => ({ value: city, label: city })),
        ]}
        icon={<MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
      />
      {isFiltered ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ status: "all", city: null })}
          className="text-muted-foreground"
        >
          <FilterX aria-hidden className="h-3.5 w-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
