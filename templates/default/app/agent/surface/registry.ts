import {
  authenticated,
  createAgentSurfaceRegistry,
  type AgentCapabilityErrorPayload,
  type AgentEnvironment,
  type AgentSurfaceRegistry,
} from "@agent-surface/core";
import { createOrpcAgentBridge, type OrpcAgentBridge } from "@agent-surface/orpc";
import authority from "virtual:agent-surface-contract";

import { domainManifest } from "@/agent/domain/manifest";
import { client } from "@/lib/rpc";

import type { CollectionStatusInput, CollectionStatusReading } from "./contracts";

/**
 * The browser half of the capability model: ONE Agent Surface registry per
 * tab. Components register `view:` capabilities against it; the oRPC bridge
 * lets them reference `domain:` procedures contextually through the app's
 * authenticated client (the same /rpc every button uses). Everything the agent
 * can see or do in this tab flows through here.
 */

export interface SurfaceUser {
  email: string;
  name: string;
  role: "analyst" | "controller";
}

const sessionRef: { current: SurfaceUser | null } = { current: null };
const routeRef: { current: string } = { current: "/" };

/**
 * The location the RENDERED TREE is showing, path and query together, written
 * from a mount effect (surface/wiring.tsx).
 *
 * Not the same thing as `window.location`, and the difference is the point.
 * React Router pushes history synchronously and then commits the tree in a
 * transition, so between the two `window.location` describes a screen that is
 * not on screen yet. Anything that must act on what the user can actually see —
 * the host's settle step — compares the two and waits for them to agree.
 */
const committedLocationRef: { current: string } = { current: "/" };

export function setSurfaceSession(user: SurfaceUser | null) {
  sessionRef.current = user;
}

export function setSurfaceRoute(path: string, search = "") {
  routeRef.current = path;
  committedLocationRef.current = `${path}${search}`;
}

export function currentSurfaceUser(): SurfaceUser | null {
  return sessionRef.current;
}

/** Path + query of the location the tree has committed to. */
export function committedSurfaceLocation(): string {
  return committedLocationRef.current;
}

/**
 * The subset of the oRPC client the surface may reference, as PLAIN records.
 *
 * `createORPCClient` returns callable Proxies at every level, which the
 * bridge's tree-walk (plain records + function leaves) cannot traverse — so
 * the manifest paths are materialized into ordinary functions once, up front.
 * Narrowing to this subset also makes the exposure ceiling visible in types.
 *
 * The registry is FLAT (capabilities/registry.ts), so this tree is one level
 * deep and the keys are the capability ids verbatim.
 */
type CallOptions = { context?: Record<string, unknown>; signal?: AbortSignal };

interface DomainClientTree {
  "update-collection-status": (
    input: CollectionStatusInput,
    options?: CallOptions,
    // Typed rather than `unknown`: the contract this ref is bound against
    // declares an output schema, and a ref whose result is `unknown` cannot
    // satisfy it. The shape is the server's, mirrored in contracts.ts.
  ) => Promise<CollectionStatusReading>;
}

function forward<K extends keyof DomainClientTree>(id: K): DomainClientTree[K] {
  return ((input: never, options?: CallOptions) =>
    (client as unknown as Record<string, (i: unknown, o?: unknown) => Promise<unknown>>)[id]!(
      input,
      {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.context ? { context: options.context } : {}),
      },
    )) as DomainClientTree[K];
}

function materializeDomainClient(): DomainClientTree {
  return { "update-collection-status": forward("update-collection-status") };
}

interface SurfaceBundle {
  registry: AgentSurfaceRegistry;
  bridge: OrpcAgentBridge<DomainClientTree>;
}

/**
 * Typed oRPC errors arrive with a `code` (server/rpc.ts maps the governed
 * pipeline's codes onto oRPC statuses). Give the model an actionable hint for
 * the ones it can do something about; the bridge's built-in default already
 * handles authorization.
 */
function mapServerError(error: unknown): AgentCapabilityErrorPayload | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  switch ((error as { code: unknown }).code) {
    case "NOT_FOUND":
      return {
        code: "PRECONDITION_FAILED",
        message: "That invoice no longer exists. Refresh the table and try again.",
        retry: "after-refresh",
      };
    case "BAD_REQUEST":
      return {
        code: "INVALID_INPUT",
        message: "The server rejected those arguments. Re-read the current state and retry once.",
        retry: "yes",
      };
    default:
      return undefined;
  }
}

let environmentOverride: AgentEnvironment | undefined;

function build(): SurfaceBundle {
  const registry = createAgentSurfaceRegistry({
    // The compiled contract, served by the Vite plugin (vite.config.ts). It is
    // the exposure CEILING: the registry verifies every registration against
    // it and refuses anything it cannot prove, so a capability that exists only
    // because some component asked for it at runtime does not exist at all.
    authority,
    environment: environmentOverride ?? (import.meta.env.PROD ? "production" : "development"),
    // Host context read by policies at snapshot/invoke time. Kept in a ref so
    // reads are synchronous and cheap, as the registry contract requires.
    context: () => ({ user: sessionRef.current }),
    route: () => ({ path: routeRef.current }),
    // Deny-by-default baseline: with no authenticated user there is no surface.
    policies: [authenticated()],
  });

  const bridge = createOrpcAgentBridge<DomainClientTree>({
    client: domainClientFactory(),
    manifest: domainManifest,
    // Correlation metadata rides the authenticated oRPC call; the server
    // records it for audit and never uses it for authorization.
    callContext: (info): Record<string, unknown> => ({
      agentInvocationId: info.invocationId,
      ...(info.confirmation ? { confirmation: info.confirmation } : {}),
    }),
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

/**
 * Force the registry's environment, for harnesses that build it outside a
 * browser. `import.meta.env.PROD` is false under vite-node, which would
 * otherwise yield "development" — and core's default audit sink adds a
 * `console.debug` leg in development only. In a terminal that leg IS stdout,
 * so it interleaves with the agent-surface CLI's own render and corrupts
 * `--json`. Call BEFORE the first `getSurfaceRegistry()`; the bundle is built
 * lazily and cached.
 */
export function setSurfaceEnvironmentForTests(env: AgentEnvironment | undefined) {
  environmentOverride = env;
}

export function resetSurfaceForTests() {
  const g = globalThis as Record<string, unknown>;
  // The host toolsets (agent/host/toolset.ts) are cached in a WeakMap keyed by
  // this registry, so disposing it makes them unreachable — nothing to clear
  // by hand.
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

/** Typed refs to manifest-backed domain procedures. */
export function getDomainRefs() {
  return bundle().bridge.refs;
}
