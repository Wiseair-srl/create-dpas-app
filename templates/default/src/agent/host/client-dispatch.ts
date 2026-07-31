"use client";

import type { AgentToolset, JsonValue } from "@agent-surface/core";
import { inspector } from "@/agent/inspector/inspector-store";
import { frontendResultToModelValue, missingToolResult, type ModelToolResult } from "./errors";
import { canonicalIdOfCall } from "./wire-names";

/**
 * Browser-side dispatch: resolves a frontend tool-call against the LIVE
 * toolset (never a cached handler) and executes it through Agent Surface.
 * The model's toolCallId becomes the surface invocationId, so a retried
 * transport can never double-execute an action.
 */
export interface FrontendToolCall {
  toolCallId: string;
  wireName: string;
  input: unknown;
}

export async function dispatchFrontendToolCall(
  toolset: AgentToolset,
  call: FrontendToolCall,
  context: { conversationId: string; turnId: string },
): Promise<ModelToolResult> {
  const tool = toolset.tools().find((t) => t.name === call.wireName);
  // Authoritative reversal (D30), then the meta-mode correction: under
  // `surface_act` the operation is named in the arguments, not by the tool.
  // A miss means the model named a tool this catalog never offered, which
  // `missingToolResult` below rejects — the wire name is only ever a label for
  // that rejection, never an audit identity.
  const canonicalId =
    canonicalIdOfCall(call.wireName, call.input, toolset.wireNameMap().get(call.wireName)) ??
    call.wireName;

  inspector.push({
    lane: "host",
    type: "dispatch",
    status: "pending",
    summary: `dispatch → ${canonicalId}`,
    correlation: {
      conversationId: context.conversationId,
      turnId: context.turnId,
      toolCallId: call.toolCallId,
      invocationId: call.toolCallId,
      capabilityId: canonicalId,
    },
  });

  if (!tool) {
    return missingToolResult(call.wireName);
  }

  const started = performance.now();
  const result = await tool.execute((call.input ?? {}) as JsonValue, {
    toolCallId: call.toolCallId,
  });
  const model = frontendResultToModelValue(result);

  inspector.push({
    lane: "host",
    type: "dispatch-settled",
    status: model.ok ? "ok" : "error",
    summary: `${canonicalId} → ${model.ok ? "ok" : describeError(model.value)}`,
    durationMs: Math.round(performance.now() - started),
    correlation: {
      conversationId: context.conversationId,
      turnId: context.turnId,
      toolCallId: call.toolCallId,
      invocationId: call.toolCallId,
      capabilityId: canonicalId,
    },
    data: model.value,
  });

  return model;
}

function describeError(value: unknown): string {
  if (value && typeof value === "object" && "error" in value) {
    const err = (value as { error: { code?: string } }).error;
    return err?.code ?? "error";
  }
  return "error";
}
