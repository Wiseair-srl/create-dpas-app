"use client";

import { action, hasPermission, observation } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";
import { useAgentProcedure } from "@agent-surface/orpc/react";
import { ArrowDown, ArrowUp, ChevronRight, PowerOff, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { zs } from "@/agent/surface/schema";
import { getDomainRefs } from "@/agent/surface/registry";
import {
  SelectRowsSchema,
  SortStateSchema,
  TableStateSchema,
  type SortState,
} from "@/features/devices/capabilities/schemas";
import type { Device } from "@/features/devices/schemas/device";
import {
  useDisableDevicesMutation,
  useEnableDevicesMutation,
} from "@/features/devices/queries/use-devices";
import { StatusBadge } from "./status-badge";

/**
 * The device table owns selection and sorting, so it registers the
 * capabilities that describe them (`view:devices.table.*`) AND the contextual
 * reference to `domain:devices.disable`:
 *
 *  - hidden entirely for identities without the devices:disable permission
 *    (authority hides…),
 *  - visible but unavailable until rows are selected (…state discloses),
 *  - `deviceIds` bound to the live selection and locked — the model cannot
 *    aim it anywhere the user isn't looking,
 *  - confirmation required; evidence is single-use and input-bound.
 *
 * The human path (toolbar buttons) calls the same oRPC procedure with no
 * agent evidence: a person clicking in their own session has already
 * expressed intent. The server authorizes both paths identically.
 */

type SortColumn = SortState["column"];

const SelectionResultSchema = z.object({ selectedIds: z.array(z.string()) });

const COLUMNS: Array<{ key: SortColumn; label: string; className?: string }> = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "city", label: "City" },
  { key: "lastSeenAt", label: "Last seen", className: "max-lg:hidden" },
  { key: "firmwareVersion", label: "Firmware", className: "max-md:hidden" },
];

function compare(a: Device, b: Device, sorting: SortState): number {
  const direction = sorting.direction === "asc" ? 1 : -1;
  const key = sorting.column;
  if (key === "status") {
    const rank = (d: Device) => (d.disabled ? 2 : d.status === "online" ? 0 : 1);
    return (rank(a) - rank(b)) * direction;
  }
  return String(a[key]).localeCompare(String(b[key])) * direction;
}

export function DevicesTable({
  devices,
  isLoading,
  isError,
  onRetry,
  selectedIds,
  onSelectionChange,
  sorting,
  onSortingChange,
  onOpenDevice,
  onClearFilters,
  isFiltered,
}: {
  devices: Device[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  sorting: SortState | null;
  onSortingChange: (sorting: SortState | null) => void;
  onOpenDevice: (deviceId: string) => void;
  onClearFilters: () => void;
  isFiltered: boolean;
}) {
  const { session } = useSession();
  const isOperator = session?.role === "operator";

  const sorted = useMemo(() => {
    if (!sorting) return devices;
    return [...devices].sort((a, b) => compare(a, b, sorting));
  }, [devices, sorting]);

  useAgentComponent({
    type: "devices.table",
    description: "Table of devices matching the active filters",
    observations: {
      readState: observation({
        description: "Visible rows (in view order), current selection, current sorting",
        output: zs(TableStateSchema),
        read: () => ({
          visibleRows: sorted.map((d) => ({
            id: d.id,
            name: d.name,
            status: d.status,
            city: d.city,
            disabled: d.disabled,
          })),
          selectedIds,
          sorting,
        }),
      }),
    },
    actions: {
      selectRows: action({
        description:
          "Replace, extend or reduce the row selection. Ids must be visible in the table.",
        input: zs(SelectRowsSchema),
        effect: "local-state",
        precondition: ({ ids }) => {
          const unknown = ids.filter((id) => !sorted.some((row) => row.id === id));
          if (unknown.length > 0) {
            return {
              message: "Some ids are not in the current result set. Read the table state first.",
              details: { unknown },
            };
          }
          return undefined;
        },
        execute: ({ ids, mode }) => {
          const applied =
            mode === "add"
              ? Array.from(new Set([...selectedIds, ...ids]))
              : mode === "remove"
                ? selectedIds.filter((id) => !ids.includes(id))
                : ids;
          onSelectionChange(applied);
          return { selectedIds: applied };
        },
        output: zs(SelectionResultSchema),
      }),
      sort: action({
        description: "Change the table sorting",
        input: zs(SortStateSchema),
        effect: "local-state",
        idempotent: true,
        execute: (next) => onSortingChange(next),
      }),
    },
  });

  useAgentProcedure(getDomainRefs().devices.disable, {
    when: () => selectedIds.length > 0,
    unavailableReason: "Select at least one device first",
    bind: () => ({ deviceIds: selectedIds }),
    confirmation: "required",
    describe: () => `Currently bound to the ${selectedIds.length} selected device(s).`,
    policies: [
      hasPermission("devices:disable", (host) => {
        const user = host.user as { permissions?: string[] } | null | undefined;
        return Boolean(user?.permissions?.includes("devices:disable"));
      }),
    ],
  });

  const allVisibleSelected = sorted.length > 0 && sorted.every((d) => selectedIds.includes(d.id));

  const toggleAll = () => {
    onSelectionChange(allVisibleSelected ? [] : sorted.map((d) => d.id));
  };

  const toggleRow = (id: string) => {
    onSelectionChange(
      selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id],
    );
  };

  const cycleSort = (column: SortColumn) => {
    if (sorting?.column !== column) return onSortingChange({ column, direction: "asc" });
    if (sorting.direction === "asc") return onSortingChange({ column, direction: "desc" });
    return onSortingChange(null);
  };

  return (
    <section aria-label="Devices" className="flex min-h-0 flex-1 flex-col">
      <SelectionToolbar
        selectedIds={selectedIds}
        devices={devices}
        isOperator={isOperator}
        onClear={() => onSelectionChange([])}
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border text-left">
              <th scope="col" className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={allVisibleSelected ? "Deselect all visible rows" : "Select all visible rows"}
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  disabled={sorted.length === 0}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sorting?.column === column.key
                      ? sorting.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={cn("px-3 py-1.5 font-medium text-muted-foreground", column.className)}
                >
                  <button
                    onClick={() => cycleSort(column.key)}
                    className="inline-flex items-center gap-1 rounded px-0.5 py-1 hover:text-foreground"
                  >
                    {column.label}
                    {sorting?.column === column.key ? (
                      sorting.direction === "asc" ? (
                        <ArrowUp aria-hidden className="h-3 w-3" />
                      ) : (
                        <ArrowDown aria-hidden className="h-3 w-3" />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
              <th scope="col" className="w-10 px-3 py-2.5">
                <span className="sr-only">Open details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : isError ? (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center">
                  <p className="text-sm text-muted-foreground">Could not load devices.</p>
                  <Button size="sm" className="mt-3" onClick={onRetry}>
                    <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Retry
                  </Button>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium">No devices match these filters</p>
                  {isFiltered ? (
                    <Button size="sm" variant="ghost" className="mt-2" onClick={onClearFilters}>
                      Clear filters
                    </Button>
                  ) : null}
                </td>
              </tr>
            ) : (
              sorted.map((device) => {
                const selected = selectedIds.includes(device.id);
                return (
                  <tr
                    key={device.id}
                    data-device-row={device.id}
                    data-selected={selected || undefined}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      selected ? "bg-accent-soft/60" : "hover:bg-surface-muted/60",
                      device.disabled && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${device.name}`}
                        checked={selected}
                        onChange={() => toggleRow(device.id)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <button
                        onClick={() => onOpenDevice(device.id)}
                        className="rounded text-left hover:text-accent"
                      >
                        {device.name}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge device={device} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{device.city}</td>
                    <td className="px-3 py-2 text-muted-foreground max-lg:hidden">
                      {relativeTime(device.lastSeenAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-md:hidden">
                      {device.firmwareVersion}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        aria-label={`Open ${device.name} details`}
                        onClick={() => onOpenDevice(device.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                      >
                        <ChevronRight aria-hidden className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border last:border-b-0">
          <td className="px-3 py-2.5">
            <Skeleton className="h-4 w-4" />
          </td>
          {COLUMNS.map((column) => (
            <td key={column.key} className={cn("px-3 py-2.5", column.className)}>
              <Skeleton className="h-4 w-24" />
            </td>
          ))}
          <td className="px-3 py-2.5" />
        </tr>
      ))}
    </>
  );
}

/** Selection-scoped human actions. The agent never uses these buttons. */
function SelectionToolbar({
  selectedIds,
  devices,
  isOperator,
  onClear,
}: {
  selectedIds: string[];
  devices: Device[];
  isOperator: boolean;
  onClear: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disable = useDisableDevicesMutation();
  const enable = useEnableDevicesMutation();
  const selectedDevices = devices.filter((d) => selectedIds.includes(d.id));
  const hasDisabled = selectedDevices.some((d) => d.disabled);
  const hasActive = selectedDevices.some((d) => !d.disabled);

  if (selectedIds.length === 0) {
    return (
      <div className="mb-2 flex h-9 items-center text-xs text-muted-foreground" aria-live="polite">
        Select rows to enable bulk actions — or ask the assistant.
      </div>
    );
  }

  return (
    <div className="mb-2 flex h-9 flex-wrap items-center gap-2" aria-live="polite">
      <span className="text-xs font-medium">
        {selectedIds.length} selected
      </span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X aria-hidden className="h-3.5 w-3.5" /> Clear
      </Button>
      {isOperator && hasActive ? (
        <Button
          variant="danger"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={disable.isPending}
        >
          <PowerOff aria-hidden className="h-3.5 w-3.5" />
          Disable
        </Button>
      ) : null}
      {isOperator && hasDisabled ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => enable.mutate({ deviceIds: selectedIds })}
          disabled={enable.isPending}
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Enable
        </Button>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader
            title={`Disable ${selectedIds.length} device${selectedIds.length === 1 ? "" : "s"}?`}
            description="They stop reporting data until an operator re-enables them."
          />
          <ul className="mb-4 max-h-32 overflow-auto rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-xs">
            {selectedDevices.map((d) => (
              <li key={d.id}>{d.name}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={disable.isPending}
              onClick={() => {
                disable.mutate(
                  { deviceIds: selectedIds },
                  { onSettled: () => setConfirmOpen(false) },
                );
              }}
            >
              Disable devices
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
