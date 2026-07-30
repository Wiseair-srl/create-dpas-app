import type { AgentInvocationResult } from "@agent-surface/core";

/**
 * One result envelope for everything the model reads back from a tool.
 * Typed errors are part of the protocol: the model uses `retry` hints
 * ("after-refresh", "with-changes", …) to self-correct instead of blindly
 * retrying — so error payloads are returned as tool RESULTS, never thrown.
 */

export interface ModelToolResult {
  ok: boolean;
  /** What the model sees: the output on success, the typed payload on error. */
  value: unknown;
}

export function frontendResultToModelValue(result: AgentInvocationResult): ModelToolResult {
  if (result.status === "ok") {
    return { ok: true, value: result.output ?? { done: true } };
  }
  return { ok: false, value: { error: result.error } };
}

export function missingToolResult(wireName: string): ModelToolResult {
  return {
    ok: false,
    value: {
      error: {
        code: "CAPABILITY_NOT_FOUND",
        message: `Tool ${wireName} is not present on the current surface.`,
        retry: "after-refresh",
      },
    },
  };
}
