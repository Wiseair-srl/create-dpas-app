"use client";

import { observation } from "@agent-surface/core";
import { AgentSurfaceProvider, useAgentComponent, useAgentSurface } from "@agent-surface/react";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { z } from "zod";
import { useInvalidateDevices } from "@/features/devices/queries/use-devices";
import { inspector } from "@/agent/inspector/inspector-store";
import { snapshotToCatalogRows } from "@/agent/host/catalog";
import { HOST_CONSUMER } from "@/agent/host/identity";
import { useSession } from "@/lib/session";
import { getSurfaceRegistry, setSurfaceRoute, type SurfaceUser } from "./registry";
import { zs } from "./schema";

/**
 * Mounts the Agent Surface registry into React and wires the two runtime
 * couplings the architecture requires:
 *
 * 1. Reconciliation — a successful `domain:devices.disable` invocation
 *    invalidates the devices query. The agent writes through the same data
 *    layer as every button in the app.
 * 2. Observability — registry events stream into the Agent Inspector.
 */

const SessionReadSchema = z.object({
  name: z.string(),
  role: z.enum(["viewer", "operator"]),
});

function SessionSentinel({ user }: { user: SurfaceUser }) {
  // Remounted per role (key={role} below): registering bumps the surface
  // version, so per-turn toolsets recompute after a role switch.
  useAgentComponent({
    type: "app.session",
    description: "The identity this dashboard session is acting as",
    observations: {
      read: observation({
        description: "Current demo user and role",
        output: zs(SessionReadSchema),
        read: () => ({ name: user.name, role: user.role }),
      }),
    },
  });
  return null;
}

function SurfaceWiring() {
  const registry = useAgentSurface();
  const pathname = usePathname();
  const invalidateDevices = useInvalidateDevices();
  const { session } = useSession();

  useEffect(() => {
    // Route info feeds snapshots; the registry reads it lazily.
    setSurfaceRoute(pathname ?? "/");
  }, [pathname]);

  useEffect(() => {
    const refreshCatalog = () => {
      const snapshot = registry.snapshot({ consumer: HOST_CONSUMER, includeUnavailable: true });
      inspector.setViewCatalog(snapshotToCatalogRows(snapshot), snapshot.surfaceVersion);
    };
    refreshCatalog();

    return registry.subscribe((event) => {
      if (
        event.type === "invocation-settled" &&
        "capabilityId" in event &&
        typeof event.capabilityId === "string" &&
        event.capabilityId.startsWith("domain:")
      ) {
        if ("status" in event && event.status === "ok") invalidateDevices();
        // The guided demo has no server stream, so pull the authoritative
        // domain audit records the call just produced into the inspector.
        void pullDomainAudit();
      }
      ingestSurfaceEvent(event as Record<string, unknown> & { type: string });
      if (
        event.type === "surface-changed" ||
        event.type === "availability-changed" ||
        event.type === "component-registered" ||
        event.type === "component-unregistered"
      ) {
        refreshCatalog();
      }
    });
  }, [registry, invalidateDevices]);

  return session ? <SessionSentinel key={session.role} user={session} /> : null;
}

interface ServerAuditEntry {
  id: string;
  at: string;
  source: "domain" | "orpc-agent" | "host";
  type: string;
  capabilityId?: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

let lastAuditId: string | undefined;

/** Fetch server audit records emitted since the last pull. Diagnostics only. */
async function pullDomainAudit(): Promise<void> {
  try {
    const query = lastAuditId ? `?since=${encodeURIComponent(lastAuditId)}` : "";
    const response = await fetch(`/api/agent/audit${query}`);
    if (!response.ok) return;
    const { entries } = (await response.json()) as { entries: ServerAuditEntry[] };
    for (const entry of entries) {
      lastAuditId = entry.id;
      inspector.push({
        lane: entry.source === "orpc-agent" ? "runtime" : "domain",
        type: entry.type,
        status: "info",
        at: entry.at,
        summary: entry.capabilityId ? `${entry.type} · ${entry.capabilityId}` : entry.type,
        correlation: {
          ...(entry.capabilityId ? { capabilityId: entry.capabilityId } : {}),
          ...(entry.correlationId
            ? { invocationId: entry.correlationId, toolCallId: entry.correlationId }
            : {}),
        },
        ...(entry.data ? { data: entry.data } : {}),
      });
    }
  } catch {
    // The inspector is diagnostics; never let it disturb the app.
  }
}

function ingestSurfaceEvent(event: Record<string, unknown> & { type: string }) {
  const capabilityId = typeof event.capabilityId === "string" ? event.capabilityId : undefined;
  const registrationId = typeof event.registrationId === "string" ? event.registrationId : undefined;
  const invocationId = typeof event.invocationId === "string" ? event.invocationId : undefined;
  const confirmationId = typeof event.confirmationId === "string" ? event.confirmationId : undefined;
  const status =
    event.type === "invocation-settled"
      ? event.status === "ok"
        ? ("ok" as const)
        : ("error" as const)
      : ("info" as const);
  inspector.push({
    lane: "surface",
    type: event.type,
    status,
    summary: capabilityId ? `${event.type} · ${capabilityId}` : event.type,
    correlation: {
      ...(capabilityId ? { capabilityId } : {}),
      ...(registrationId ? { registrationId } : {}),
      ...(invocationId ? { invocationId, toolCallId: invocationId } : {}),
      ...(confirmationId ? { confirmationId } : {}),
    },
  });
}

export function AgentSurfaceRoot({ children }: { children: ReactNode }) {
  return (
    <AgentSurfaceProvider registry={getSurfaceRegistry()}>
      <SurfaceWiring />
      {children}
    </AgentSurfaceProvider>
  );
}
