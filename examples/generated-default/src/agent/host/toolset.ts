"use client";

import {
  createAgentToolset,
  type AgentSurfaceRegistry,
  type AgentToolset,
} from "@agent-surface/core";
import { getSurfaceRegistry } from "@/agent/surface/registry";
import { currentCatalogMode, type CatalogMode } from "./catalog-mode";
import { HOST_CONSUMER } from "./identity";
import { scopeForRoute, type Scope } from "./scope";

/**
 * The toolset the host projects from the live surface for the embedded
 * assistant. Topology is `remote` (the loop runs server-side); confirmations
 * use `wait` deliberately — under the step-loop protocol frontend tools run
 * BETWEEN requests, so the dialog never holds a server stream open
 * (ADR-0005).
 *
 * `scope` is fixed at construction and narrows both `tools()` and the
 * snapshot behind it, so the toolset is keyed by scope rather than being a
 * single process-wide singleton. Scoping the snapshot alone would not work:
 * the tool LIST comes from `tools()`, so an unscoped toolset would keep every
 * tool while the metadata index lost them — every out-of-scope descriptor
 * would silently fall back to `effect: "unknown"`, `confirmation: "never"`.
 */
function build(
  registry: AgentSurfaceRegistry,
  scope: readonly Scope[],
  mode: CatalogMode,
): AgentToolset {
  return createAgentToolset(registry, {
    consumer: HOST_CONSUMER,
    topology: "remote",
    confirmations: "wait",
    mode,
    ...(scope.length > 0 ? { scope: [...scope] } : {}),
    // Live state stays OUT of `description` and rides in `AgentTool.state`
    // instead (D28) — since core 0.5 this is the only behavior, so there is no
    // longer a flag to ask for it. Tool definitions sit at the front of the
    // provider prompt, so anything volatile in them invalidates the cached
    // prefix behind the whole conversation on every step; the host renders
    // `state` after the messages, where it costs a few hundred tokens and
    // invalidates nothing.
  });
}

/**
 * Keyed by registry first, then scope. A toolset holds a reference to the
 * registry it was built against, so caching by scope alone would hand back a
 * toolset pointing at a disposed registry whenever the registry is replaced —
 * which happens on hot reload and between tests. The WeakMap also lets a
 * discarded registry and its toolsets be collected together.
 */
const cacheKey = "__dpasHostToolsets" as const;
type ToolsetCache = WeakMap<AgentSurfaceRegistry, Map<string, AgentToolset>>;

function cacheFor(registry: AgentSurfaceRegistry): Map<string, AgentToolset> {
  const g = globalThis as Record<string, unknown>;
  if (!g[cacheKey]) g[cacheKey] = new WeakMap() as ToolsetCache;
  const byRegistry = g[cacheKey] as ToolsetCache;
  let byScope = byRegistry.get(registry);
  if (!byScope) {
    byScope = new Map<string, AgentToolset>();
    byRegistry.set(registry, byScope);
  }
  return byScope;
}

/** The route this browser tab is on. This module is client-only. */
export function currentPathname(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

/**
 * The toolset for a route and mode. Cached per (registry, mode, scope) —
 * `buildDirectTools` re-snapshots on every `tools()` call, so the cache saves
 * construction, not freshness. Mode is part of the key because it changes what
 * `tools()` returns entirely, not just which entries survive.
 */
export function getHostToolset(
  pathname: string = currentPathname(),
  mode: CatalogMode = currentCatalogMode(),
): AgentToolset {
  const registry = getSurfaceRegistry();
  const scope = scopeForRoute(pathname);
  const key = `${mode}:${scope.length > 0 ? [...scope].sort().join(",") : "*"}`;
  const toolsets = cacheFor(registry);
  let toolset = toolsets.get(key);
  if (!toolset) {
    toolset = build(registry, scope, mode);
    toolsets.set(key, toolset);
  }
  return toolset;
}

/** Drops the cached toolsets for the current registry. Tests and hot reload. */
export function resetHostToolsets(): void {
  const toolsets = cacheFor(getSurfaceRegistry());
  for (const toolset of toolsets.values()) toolset.dispose();
  toolsets.clear();
}
