"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { DeviceDrawer } from "@/features/devices/components/device-drawer";
import { DeviceFilters } from "@/features/devices/components/device-filters";
import { DevicesTable } from "@/features/devices/components/devices-table";
import { matchesFilters } from "@/features/devices/queries/use-devices";
import type { FiltersState, SortState } from "@/features/devices/capabilities/schemas";
import type { Device } from "@/features/devices/schemas/device";
import { seedDevices } from "@/server/db/seed";
import { SessionProvider } from "@/lib/session";
import {
  resetSurfaceForTests,
  setDomainClientFactoryForTests,
  setSurfaceSession,
  getSurfaceRegistry,
  type DomainClientTree,
  type SurfaceUser,
} from "@/agent/surface/registry";
import { permissionsFor, DEMO_USERS, type Role } from "@/server/auth/session";

/**
 * Contract-test fixture: the real dashboard feature components (filters,
 * table, drawer — with all their capability registrations) over fixture data
 * and a captured fake domain client. No network, no model, no Next.js.
 */

export interface CapturedDisableCall {
  input: { deviceIds: string[]; reason?: string };
  context: Record<string, unknown> | undefined;
}

export function createFixture(options?: { role?: Role; failDisableWith?: () => Error }) {
  const role = options?.role ?? "operator";
  const disableCalls: CapturedDisableCall[] = [];
  let devices = seedDevices(new Date("2026-07-30T12:00:00Z"));

  const domainClient: DomainClientTree = {
    devices: {
      disable: async (input, callOptions) => {
        if (options?.failDisableWith) throw options.failDisableWith();
        disableCalls.push({
          input,
          context: callOptions?.context as Record<string, unknown> | undefined,
        });
        devices = devices.map((device) =>
          input.deviceIds.includes(device.id) ? { ...device, disabled: true } : device,
        );
        return {
          disabled: input.deviceIds.length,
          devices: devices.filter((d) => input.deviceIds.includes(d.id)),
        };
      },
    },
  };

  resetSurfaceForTests();
  setDomainClientFactoryForTests(() => domainClient);

  const user: SurfaceUser = {
    id: DEMO_USERS[role].userId,
    name: DEMO_USERS[role].name,
    role,
    permissions: permissionsFor(DEMO_USERS[role]),
  };
  // The registry reads host context lazily; set it before first snapshot.
  setSurfaceSession(user);

  const registry = getSurfaceRegistry();

  return {
    registry,
    user,
    disableCalls,
    devices: () => devices,
    cleanup() {
      resetSurfaceForTests();
    },
  };
}

export function FixturePage({ initialDevices }: { initialDevices?: Device[] }) {
  const [filters, setFilters] = useState<FiltersState>({ status: "all", city: null });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sorting, setSorting] = useState<SortState | null>(null);
  const [drawerDeviceId, setDrawerDeviceId] = useState<string | null>(null);
  const [devices] = useState<Device[]>(
    () => initialDevices ?? seedDevices(new Date("2026-07-30T12:00:00Z")),
  );

  const filtered = useMemo(
    () => devices.filter((device) => matchesFilters(device, filters)),
    [devices, filters],
  );

  return (
    <>
      <DeviceFilters filters={filters} onChange={setFilters} />
      <DevicesTable
        devices={filtered}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sorting={sorting}
        onSortingChange={setSorting}
        onOpenDevice={setDrawerDeviceId}
        onClearFilters={() => setFilters({ status: "all", city: null })}
        isFiltered={filters.status !== "all" || filters.city !== null}
      />
      <DeviceDrawer
        devices={filtered}
        openDeviceId={drawerDeviceId}
        onOpenChange={setDrawerDeviceId}
      />
    </>
  );
}

export function FixtureProviders({
  user,
  children,
}: {
  user: SurfaceUser;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider initialSession={user}>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
