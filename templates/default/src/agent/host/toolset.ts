"use client";

import { createAgentToolset, type AgentToolset } from "@agent-surface/core";
import { getSurfaceRegistry } from "@/agent/surface/registry";
import { HOST_CONSUMER } from "./identity";

/**
 * The one toolset the host projects from the live surface for the embedded
 * assistant. Topology is `remote` (the loop runs server-side); confirmations
 * use `wait` deliberately — under the step-loop protocol frontend tools run
 * BETWEEN requests, so the dialog never holds a server stream open
 * (ADR-0005).
 */
function build(): AgentToolset {
  return createAgentToolset(getSurfaceRegistry(), {
    consumer: HOST_CONSUMER,
    topology: "remote",
    confirmations: "wait",
  });
}

const globalKey = "__dpasHostToolset" as const;
export function getHostToolset(): AgentToolset {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = build();
  return g[globalKey] as AgentToolset;
}
