import {
  allow,
  createAgentRuntime,
  createCapabilityRegistry,
  defineGovernance,
  definePolicy,
  hide,
  type AgentAuditEvent,
  type AgentRuntime,
} from "@orpc-agent/core";
import { router } from "@/server/orpc/router";
import { getAuditLog } from "@/server/audit/log";
import type { AppContext } from "@/server/orpc/context";

/**
 * The governed domain runtime (oRPC Agent). Procedures without `meta.agent`
 * are excluded automatically; exposure is deny-by-default per surface.
 *
 * Policy demonstrates the DPAS rule "authority hides, state discloses":
 * a viewer does not merely get an error calling a write capability — the
 * capability is absent from their catalog entirely, indistinguishable from
 * one that never existed.
 */

const viewerHidesWrites = definePolicy(
  "viewer-hides-writes",
  (request) => {
    const { sideEffect } = request.capability.meta;
    if (sideEffect === "read" || sideEffect === "none") return allow();
    const session = (request.context as AppContext).session;
    if (session?.role !== "operator") return hide();
    return allow();
  },
  { phases: ["discovery", "invocation"] },
);

export const capabilities = createCapabilityRegistry(router);

export const governance = defineGovernance({
  registry: capabilities,
  policies: [viewerHidesWrites],
});

function auditSink(event: AgentAuditEvent) {
  getAuditLog().record({
    source: "orpc-agent",
    type: event.type,
    ...(event.actor ? { actorId: event.actor.id } : {}),
    ...(event.capabilityId ? { capabilityId: `domain:${event.capabilityId}` } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    data: JSON.parse(JSON.stringify("data" in event ? (event.data ?? {}) : {})) as Record<
      string,
      unknown
    >,
  });
}

function buildRuntime(): AgentRuntime<AppContext> {
  return createAgentRuntime<AppContext>({
    governance,
    audit: { sinks: [auditSink], strict: false },
  });
}

const globalKey = "__dpasAgentRuntime" as const;
export function getAgentRuntime(): AgentRuntime<AppContext> {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = buildRuntime();
  return g[globalKey] as AgentRuntime<AppContext>;
}
