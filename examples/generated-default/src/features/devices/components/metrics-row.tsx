"use client";

import { Activity, Building2, PowerOff, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceMetrics } from "@/features/devices/queries/use-devices";

/** Fleet metrics derived from the same query the table uses — no fake numbers. */
export function MetricsRow() {
  const metrics = useDeviceMetrics();

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" role="group" aria-label="Fleet metrics">
      <Metric
        label="Devices"
        value={metrics.total}
        icon={<Activity aria-hidden className="h-4 w-4 text-muted-foreground" />}
        isLoading={metrics.isLoading}
      />
      <Metric
        label="Online"
        value={metrics.online}
        icon={<Wifi aria-hidden className="h-4 w-4 text-success" />}
        isLoading={metrics.isLoading}
      />
      <Metric
        label="Offline"
        value={metrics.offline}
        icon={<WifiOff aria-hidden className="h-4 w-4 text-warning" />}
        isLoading={metrics.isLoading}
      />
      <Metric
        label="Disabled"
        value={metrics.disabled}
        icon={<PowerOff aria-hidden className="h-4 w-4 text-muted-foreground" />}
        isLoading={metrics.isLoading}
      />
      <Metric
        label="Cities"
        value={metrics.cities}
        icon={<Building2 aria-hidden className="h-4 w-4 text-muted-foreground" />}
        isLoading={metrics.isLoading}
        className="max-lg:hidden"
      />
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  isLoading,
  className,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  isLoading: boolean;
  className?: string;
}) {
  return (
    <div
      data-metric={label}
      className={`rounded-lg border border-border bg-surface px-4 py-3 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-7 w-10" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}
