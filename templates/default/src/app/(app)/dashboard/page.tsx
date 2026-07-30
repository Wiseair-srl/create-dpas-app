"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The dashboard mounts client-only: Agent Surface capabilities describe a
 * live browser tab, and the panel layout persists to localStorage — neither
 * has a meaningful server rendering. The shell below keeps first paint calm.
 */
const DashboardScreen = dynamic(() => import("./dashboard-screen"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex h-14 items-center border-b border-border bg-surface px-4 lg:px-6">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5 lg:p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="px-4 lg:px-5">
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="flex-1 p-4 lg:p-5">
        <Skeleton className="h-full min-h-64 w-full" />
      </div>
    </div>
  ),
});

export default function DashboardPage() {
  return <DashboardScreen />;
}
