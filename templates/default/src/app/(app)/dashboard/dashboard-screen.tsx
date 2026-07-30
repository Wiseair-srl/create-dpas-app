"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { Bot, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { AppHeader } from "@/components/app-shell/app-header";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DeviceDrawer } from "@/features/devices/components/device-drawer";
import { DeviceFilters } from "@/features/devices/components/device-filters";
import { DevicesTable } from "@/features/devices/components/devices-table";
import { MetricsRow } from "@/features/devices/components/metrics-row";
import { useFilteredDevices } from "@/features/devices/queries/use-devices";
import type { FiltersState, SortState } from "@/features/devices/capabilities/schemas";

/**
 * The dashboard screen. Filter, selection, sorting and drawer state live here
 * — lifted so the components that render them can also register the agent
 * capabilities that describe them. What you see is what the agent can see.
 *
 * Rendered client-only (see page.tsx): the agent surface describes a LIVE
 * browser tab, and the resizable layout persists to localStorage.
 */
export default function DashboardScreen() {
  const [filters, setFilters] = useState<FiltersState>({ status: "all", city: null });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sorting, setSorting] = useState<SortState | null>(null);
  const [drawerDeviceId, setDrawerDeviceId] = useState<string | null>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  const openDevice = (deviceId: string | null) => {
    if (deviceId !== null) {
      drawerReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setDrawerDeviceId(deviceId);
  };
  const [mobileAssistantOpen, setMobileAssistantOpen] = useState(false);
  // Assistant width persists across reloads (localStorage-backed layout).
  const layout = useDefaultLayout({ id: "dpas-dashboard", panelIds: ["main", "assistant"] });

  const { query, filtered } = useFilteredDevices(filters);

  // Stale-selection cleanup, derived at render time: ids that fall out of
  // the visible set (filter change, data refresh) leave the effective
  // selection immediately, so bound inputs never point at rows the user is
  // no longer looking at. Raw state is only ever set by explicit actions.
  const visibleIds = useMemo(() => new Set(filtered.map((d) => d.id)), [filtered]);
  const selection = useMemo(
    () => selectedIds.filter((id) => visibleIds.has(id)),
    [selectedIds, visibleIds],
  );

  const isFiltered = filters.status !== "all" || filters.city !== null;

  const main = (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader
        title="Device operations"
        subtitle={
          query.isLoading
            ? "Loading fleet…"
            : `${filtered.length} device${filtered.length === 1 ? "" : "s"} in view`
        }
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
        <MetricsRow />
        <DeviceFilters filters={filters} onChange={setFilters} />
        <DevicesTable
          devices={filtered}
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          selectedIds={selection}
          onSelectionChange={setSelectedIds}
          sorting={sorting}
          onSortingChange={setSorting}
          onOpenDevice={openDevice}
          onClearFilters={() => setFilters({ status: "all", city: null })}
          isFiltered={isFiltered}
        />
      </main>
    </div>
  );

  return (
    <>
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel id="main" defaultSize="66" minSize="42" className="flex min-w-0">
          {main}
        </Panel>
        <Separator className="w-1 shrink-0 bg-border transition-colors hover:bg-accent data-[state=drag]:bg-accent max-lg:hidden" />
        <Panel
          id="assistant"
          defaultSize="34"
          minSize={340}
          maxSize="52"
          className="max-lg:hidden"
        >
          <AssistantPanel />
        </Panel>
      </Group>

      <DeviceDrawer
        devices={filtered}
        openDeviceId={drawerDeviceId}
        onOpenChange={openDevice}
        returnFocusTo={() => drawerReturnFocus.current}
      />

      {/* Mobile: the assistant as a full-screen sheet. */}
      <DialogPrimitive.Root open={mobileAssistantOpen} onOpenChange={setMobileAssistantOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            aria-label="Open assistant"
            className="fixed bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg lg:hidden"
          >
            <Bot aria-hidden className="h-5 w-5" />
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex flex-col bg-surface outline-none lg:hidden"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Assistant</DialogPrimitive.Title>
            <div className="flex items-center justify-end border-b border-border px-2 py-1">
              <DialogPrimitive.Close
                aria-label="Close assistant"
                className="rounded p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <X aria-hidden className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1">
              <AssistantPanel />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
