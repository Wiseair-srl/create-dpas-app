"use client";

import {
  authenticated,
  createAgentSurfaceRegistry,
  type AgentSurfaceRegistry,
} from "@agent-surface/core";
import { createOrpcAgentBridge, type OrpcAgentBridge } from "@agent-surface/orpc";
import type { AgentCapabilityErrorPayload } from "@agent-surface/core";
import { orpcClient, type AgentCallClientContext } from "@/features/devices/queries/orpc-client";
import { domainManifest } from "@/features/devices/domain/manifest";
import type { Role } from "@/server/auth/session";

/**
 * The browser half of the capability model: ONE Agent Surface registry per
 * tab. Components register `view:` capabilities against it; the oRPC bridge
 * lets them reference `domain:` procedures contextually through the app's
 * authenticated client. Everything the agent can see or do in this tab flows
 * through here.
 */

export interface SurfaceUser {
  id: string;
  name: string;
  role: Role;
  permissions: string[];
}

const sessionRef: { current: SurfaceUser | null } = { current: null };
const routeRef: { current: string } = { current: "/" };

export function setSurfaceSession(user: SurfaceUser | null) {
  sessionRef.current = user;
}

export function setSurfaceRoute(path: string) {
  routeRef.current = path;
}

export function currentSurfaceUser(): SurfaceUser | null {
  return sessionRef.current;
}

/**
 * The subset of the oRPC client the surface may reference, as PLAIN records.
 * `createORPCClient` returns callable Proxies at every level, which the
 * bridge's tree-walk (plain records + function leaves) cannot traverse — so
 * we materialize the manifest paths into ordinary functions once, up front.
 * Narrowing to this subset also makes the exposure ceiling visible in types.
 */
interface DomainClientTree {
  devices: {
    disable: (
      input: { deviceIds: string[]; reason?: string },
      options?: { context?: Record<string, unknown>; signal?: AbortSignal },
    ) => Promise<{ disabled: number; devices: unknown[] }>;
  };
}

function materializeDomainClient(): DomainClientTree {
  return {
    devices: {
      disable: (input, options) =>
        orpcClient.devices.disable(input, {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.context ? { context: options.context as never } : {}),
        }),
    },
  };
}

interface SurfaceBundle {
  registry: AgentSurfaceRegistry;
  bridge: OrpcAgentBridge<DomainClientTree>;
}

function mapServerError(error: unknown): AgentCapabilityErrorPayload | undefined {
  // Typed oRPC errors arrive with a `code`; give the model actionable hints
  // for the ones it can do something about. Authorization mapping is handled
  // by the bridge's built-in default.
  if (error && typeof error === "object" && "code" in error) {
    if ((error as { code: unknown }).code === "DEVICE_NOT_FOUND") {
      return {
        code: "PRECONDITION_FAILED",
        message: "One or more selected devices no longer exist. Refresh and reselect.",
        retry: "after-refresh",
      };
    }
  }
  return undefined;
}

function build(): SurfaceBundle {
  const registry = createAgentSurfaceRegistry({
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    // Host context read by policies at snapshot/invoke time. Kept in a ref so
    // reads are synchronous and cheap, as the registry contract requires.
    context: () => ({ user: sessionRef.current }),
    route: () => ({ path: routeRef.current }),
    // Deny-by-default baseline: with no authenticated user there is no surface.
    policies: [authenticated()],
    // Keep a contextual binding's live text OUT of `description` (D28). The
    // description then changes only when code or the mount set changes, which
    // is what lets the provider tool block be prompt-prefix cached across the
    // steps of a turn; the live text rides in `contextualNote` and is rendered
    // outside the tool definitions.
    snapshotMergesContextualNote: false,
  });

  const bridge = createOrpcAgentBridge<DomainClientTree>({
    client: domainClientFactory(),
    manifest: domainManifest,
    // Correlation metadata rides the authenticated oRPC call as headers; the
    // server records it for audit and never uses it for authorization.
    callContext: (info): Record<string, unknown> =>
      ({
        agentInvocationId: info.invocationId,
        ...(info.confirmation ? { confirmation: info.confirmation } : {}),
      }) satisfies AgentCallClientContext as Record<string, unknown>,
    mapServerError,
  });

  registry.setProcedureExecutor(bridge.executor);
  return { registry, bridge };
}

const globalKey = "__dpasSurface" as const;

let domainClientFactory: () => DomainClientTree = materializeDomainClient;

function bundle(): SurfaceBundle {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = build();
  return g[globalKey] as SurfaceBundle;
}

/**
 * Test seams: swap the domain client (so contract tests capture oRPC calls
 * instead of hitting the network) and rebuild the singleton. Production code
 * never calls these.
 */
export function setDomainClientFactoryForTests(factory: () => DomainClientTree) {
  domainClientFactory = factory;
}

export function resetSurfaceForTests() {
  const g = globalThis as Record<string, unknown>;
  // The host toolsets (src/agent/host/toolset.ts) are cached in a WeakMap
  // keyed by this registry, so disposing it makes them unreachable — nothing
  // to clear by hand.
  const current = g[globalKey] as SurfaceBundle | undefined;
  current?.registry.dispose();
  delete g[globalKey];
  sessionRef.current = null;
  routeRef.current = "/";
}

export type { DomainClientTree };

export function getSurfaceRegistry(): AgentSurfaceRegistry {
  return bundle().registry;
}

/** Typed refs to manifest-backed domain procedures (e.g. refs.devices.disable). */
export function getDomainRefs() {
  return bundle().bridge.refs;
}
