"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Device, StatusFilter } from "@/features/devices/schemas/device";
import { orpcClient, orpcQuery } from "./orpc-client";

/**
 * Normal application data layer (React Query). Agent-driven mutations
 * reconcile through the same invalidation path as human ones — there is no
 * second, agent-specific state system.
 */

export function useDevicesQuery() {
  return useQuery(orpcQuery.devices.list.queryOptions({ input: {} }));
}

export function useInvalidateDevices() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: orpcQuery.devices.list.key() });
}

export interface DeviceFiltersState {
  status: StatusFilter;
  city: string | null;
}

export function matchesFilters(device: Device, filters: DeviceFiltersState): boolean {
  if (filters.city && device.city.toLowerCase() !== filters.city.toLowerCase()) return false;
  switch (filters.status) {
    case "all":
      return true;
    case "disabled":
      return device.disabled;
    case "online":
    case "offline":
      return device.status === filters.status;
  }
}

export function useFilteredDevices(filters: DeviceFiltersState) {
  const query = useDevicesQuery();
  const devices = useMemo(() => query.data?.devices ?? [], [query.data]);
  const filtered = useMemo(
    () => devices.filter((device) => matchesFilters(device, filters)),
    [devices, filters],
  );
  return { query, devices, filtered };
}

export function useDeviceMetrics() {
  const query = useDevicesQuery();
  return useMemo(() => {
    const devices = query.data?.devices ?? [];
    const online = devices.filter((d) => d.status === "online" && !d.disabled).length;
    const offline = devices.filter((d) => d.status === "offline" && !d.disabled).length;
    const disabled = devices.filter((d) => d.disabled).length;
    const cities = new Set(devices.map((d) => d.city)).size;
    return { total: devices.length, online, offline, disabled, cities, isLoading: query.isLoading };
  }, [query.data, query.isLoading]);
}

/** Human mutation paths — no agent evidence attached, by design. */
export function useDisableDevicesMutation() {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: (input: { deviceIds: string[]; reason?: string }) =>
      orpcClient.devices.disable(input),
    onSettled: () => invalidate(),
  });
}

export function useEnableDevicesMutation() {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: (input: { deviceIds: string[] }) => orpcClient.devices.enable(input),
    onSettled: () => invalidate(),
  });
}

export function useResetDevicesMutation() {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: () => orpcClient.devices.reset({}),
    onSettled: () => invalidate(),
  });
}
