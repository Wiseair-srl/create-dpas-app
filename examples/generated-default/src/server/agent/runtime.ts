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
import { createPgAuditSink } from "@orpc-agent/postgres";
import { router } from "@/server/orpc/router";
import { getAuditLog } from "@/server/audit/log";
import { getGovernanceAuditQuery } from "@/server/audit/postgres";
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
  // Governance events also go to their canonical table when durable audit is
  // configured. That record is the library's own `AgentAuditEvent` shape, and
  // it is NOT a substitute for the application log above: domain and host
  // entries never pass through this runtime.
  //
  // `verbose` stays off deliberately. Turning it on restores the full
  // `capabilityIds` array on `capabilities.discovered` — ~6 KB per discovery
  // at 300 capabilities, per step, per turn, per concurrent user.
  const query = getGovernanceAuditQuery();
  const sinks = query ? [auditSink, createPgAuditSink({ query })] : [auditSink];

  return createAgentRuntime<AppContext>({
    governance,
    audit: { sinks, strict: false },
  });
}

const globalKey = "__dpasAgentRuntime" as const;
export function getAgentRuntime(): AgentRuntime<AppContext> {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = buildRuntime();
  return g[globalKey] as AgentRuntime<AppContext>;
}
