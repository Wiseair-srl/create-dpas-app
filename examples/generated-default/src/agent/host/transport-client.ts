"use client";

import type { AgentSurfaceRegistry, AgentToolset } from "@agent-surface/core";
import { inspector } from "@/agent/inspector/inspector-store";
import { buildFrontendToolDescriptors } from "./catalog";
import { dispatchFrontendToolCall } from "./client-dispatch";
import { HOST_CONSUMER } from "./identity";
import { createLoopGuard, type ToolOutcome } from "./loop-guard";
import {
  CATALOG_LIMITS,
  catalogTooLargeMessage,
  createFrameDecoder,
  PROTOCOL_VERSION,
  type ChatStepFrame,
  type DomainToolInfo,
  type StepUsage,
  type WireModelMessage,
} from "./protocol";
import { scopeForRoute } from "./scope";
import { NAVIGATION_SETTLE_BUDGET, waitForSurfaceSettled } from "./surface-settle";
import { currentPathname } from "./toolset";
import type { CatalogMode } from "./catalog-mode";

/**
 * The browser half of the Agent Host loop (ADR-0002).
 *
 * One turn = repeat until the model stops:
 *   1. project the LIVE surface into frontend tool descriptors;
 *   2. POST a step; stream frames (text, server tool activity, inspector);
 *   3. if the step ended at frontend tool-calls, execute them through Agent
 *      Surface (confirmations wait here, between requests), wait for the
 *      surface to absorb them (`surface-settle.ts`), and loop.
 *
 * Step 3 waits because "project the LIVE surface" is a claim about timing, not
 * just about where the data comes from: a call returns to this loop across
 * microtasks, and the surface it changed moves on a React commit. Without the
 * wait, step N+1 is handed the surface as it was before step N acted.
 *
 * Run limits live in host code, not prompts: max steps, a turn deadline, and
 * loop detection over both planes (see `loop-guard.ts`).
 *
 * Whatever ends a turn, its message history must still be WELL-FORMED, because
 * it is persisted and replayed into the next one. An assistant tool-call with
 * no matching result is a list most providers reject outright, so a turn that
 * stops mid-step answers the calls it is not going to run rather than leaving
 * the next turn to fail for a reason of its own.
 */

const MAX_STEPS_PER_TURN = 8;
const TURN_DEADLINE_MS = 180_000;

export interface TurnEvents {
  onTextDelta: (text: string) => void;
  onReasoningDelta: (text: string) => void;
  onToolCall: (call: {
    toolCallId: string;
    wireName: string;
    canonicalId: string;
    executor: "server" | "browser";
    input: unknown;
  }) => void;
  onToolResult: (result: {
    toolCallId: string;
    wireName: string;
    canonicalId: string;
    executor: "server" | "browser";
    ok: boolean;
    result: unknown;
  }) => void;
  onDomainCatalog: (tools: DomainToolInfo[]) => void;
  /**
   * What one step-request cost. Called once per step, and not at all when the
   * provider reported nothing — so a silent provider leaves the counter
   * unmeasured rather than zeroed.
   */
  onUsage: (usage: StepUsage) => void;
  onAssistantMessageBoundary: () => void;
  onError: (error: { code: string; message: string }) => void;
}

export interface RunTurnOptions {
  conversationId: string;
  turnId: string;
  /** Full model-message history including the new user message. */
  messages: WireModelMessage[];
  registry: AgentSurfaceRegistry;
  toolset: AgentToolset;
  /** The route this turn runs on; scopes the catalog on both planes. */
  pathname: string;
  /** How the surface is projected: one tool per capability, or three. */
  mode: CatalogMode;
  signal: AbortSignal;
  events: TurnEvents;
}

export interface TurnOutcome {
  /** Updated history to persist for the next turn. */
  messages: WireModelMessage[];
  status: "completed" | "error" | "cancelled";
}

export async function runTurn(options: RunTurnOptions): Promise<TurnOutcome> {
  const { conversationId, turnId, registry, toolset, pathname, mode, signal, events } = options;
  let messages = [...options.messages];
  const startedAt = performance.now();
  const guard = createLoopGuard();

  for (let stepIndex = 0; stepIndex < MAX_STEPS_PER_TURN; stepIndex++) {
    if (signal.aborted) return { messages, status: "cancelled" };
    if (performance.now() - startedAt > TURN_DEADLINE_MS) {
      events.onError({
        code: "RUN_LIMIT_EXCEEDED",
        message: "Turn deadline exceeded; the run was stopped.",
      });
      return { messages, status: "error" };
    }

    // Same scope on both halves: the toolset was built with it, so the
    // snapshot that supplies the metadata index must agree or descriptors
    // fall through to defaults.
    const scope = scopeForRoute(pathname);
    const snapshot = registry.snapshot({
      consumer: HOST_CONSUMER,
      includeUnavailable: true,
      ...(scope.length > 0 ? { scope: [...scope] } : {}),
    });
    const {
      descriptors: frontendTools,
      state: frontendState,
      undecodable,
    } = buildFrontendToolDescriptors(toolset, snapshot, mode);

    // Pre-flight. Exceeding a named limit is reported here rather than
    // discovered as a 400 that says "malformed" about a perfectly legal
    // request (§1.1).
    if (frontendTools.length > CATALOG_LIMITS.maxFrontendTools) {
      events.onError({
        code: "CATALOG_TOO_LARGE",
        message: catalogTooLargeMessage(
          "frontend",
          frontendTools.length,
          CATALOG_LIMITS.maxFrontendTools,
        ),
      });
      return { messages, status: "error" };
    }
    if (messages.length > CATALOG_LIMITS.maxMessages) {
      events.onError({
        code: "CATALOG_TOO_LARGE",
        message: catalogTooLargeMessage("messages", messages.length, CATALOG_LIMITS.maxMessages),
      });
      return { messages, status: "error" };
    }

    // Withholding a tool is a reduction of the catalog, so it is reported
    // rather than absorbed (invariant 7).
    if (undecodable.length > 0) {
      inspector.push({
        lane: "host",
        type: "catalog.undecodable",
        status: "error",
        summary: `${undecodable.length} tool(s) withheld — wire name did not map to a canonical id`,
        correlation: { conversationId, turnId },
        data: { wireNames: undecodable },
      });
    }

    inspector.push({
      lane: "host",
      type: "step-request",
      status: "info",
      summary: `step ${stepIndex} · ${frontendTools.length} frontend tools · surface v${snapshot.surfaceVersion}`,
      correlation: { conversationId, turnId },
    });

    let response: Response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          conversationId,
          turnId,
          stepIndex,
          pathname,
          messages,
          catalog: {
            mode,
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            frontendTools,
            frontendState,
            ...(undecodable.length > 0
              ? { truncated: { dropped: undecodable.length, reason: "undecodable" as const } }
              : {}),
          },
        }),
      });
    } catch (error) {
      if (signal.aborted) return { messages, status: "cancelled" };
      events.onError({ code: "TRANSPORT_FAILED", message: "Could not reach the chat endpoint." });
      return { messages, status: "error" };
    }

    if (!response.ok || !response.body) {
      const detail = await safeErrorDetail(response);
      events.onError(detail);
      return { messages, status: "error" };
    }

    const step = await consumeStepStream(response.body, signal, events, {
      conversationId,
      turnId,
    });
    if (step.status === "cancelled") return { messages, status: "cancelled" };
    if (step.status === "error") return { messages, status: "error" };

    messages = [...messages, ...step.responseMessages];

    // Server-plane results are already answered in `responseMessages`, but the
    // guard still has to see them: a domain tool failing over and over is the
    // same stuck turn as a view tool doing it, and counting only one plane
    // means half the loops run unbounded.
    for (const settled of step.serverToolResults) {
      const verdict = guard.record(settled);
      if (verdict) {
        messages = [...messages, ...unexecutedResults(step.pendingToolCalls)];
        events.onError(verdict);
        return { messages, status: "error" };
      }
    }

    if (step.pendingToolCalls.length === 0) {
      return { messages, status: "completed" };
    }

    // Execute the frontend tool calls this step ended on. Confirmations for
    // destructive contextual procedures block HERE — no server stream is open.
    const toolMessages: WireModelMessage[] = [];
    // What this step told the model each tool does. A read cannot move the
    // surface; every other effect can, and that is what decides whether the
    // next reader has to wait for it.
    const effectOf = new Map(frontendTools.map((tool) => [tool.wireName, tool.effect]));
    let executed = 0;
    let cancelled = false;
    let verdict: ReturnType<typeof guard.record> = null;

    for (const pending of step.pendingToolCalls) {
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      events.onToolCall({
        toolCallId: pending.toolCallId,
        wireName: pending.wireName,
        canonicalId: pending.canonicalId,
        executor: "browser",
        input: pending.input,
      });
      const versionBeforeCall = registry.getVersion();
      const routeBeforeCall = currentPathname();
      const outcome = await dispatchFrontendToolCall(
        toolset,
        { toolCallId: pending.toolCallId, wireName: pending.wireName, input: pending.input },
        { conversationId, turnId },
      );
      events.onToolResult({
        toolCallId: pending.toolCallId,
        wireName: pending.wireName,
        canonicalId: pending.canonicalId,
        executor: "browser",
        ok: outcome.ok,
        result: outcome.value,
      });

      // Recorded BEFORE the verdict is acted on: the call did run and did
      // produce this result, so history carries it either way.
      toolMessages.push(toolResultMessage(pending, outcome.value));
      executed += 1;

      // Let the surface absorb the call before anything reads it again —
      // the next call in this step (a model that emits `setFilters` and
      // `readState` together gets the filtered rows, not the previous ones)
      // and the next step's snapshot at the top of this loop.
      if (effectOf.get(pending.wireName) !== "read") {
        // Keyed on the route actually changing, not on the declared effect: a
        // `goTo` to the route already open moves nothing and should not buy
        // the long budget, and a route that changed needs it whatever the
        // capability called itself.
        const navigated = currentPathname() !== routeBeforeCall;
        const settled = await waitForSurfaceSettled(registry, versionBeforeCall, {
          signal,
          ...(navigated ? { budget: NAVIGATION_SETTLE_BUDGET } : {}),
        });
        if (settled.reason === "settled" || settled.reason === "timeout") {
          inspector.push({
            lane: "host",
            type: "surface-settled",
            status: settled.reason === "timeout" ? "error" : "info",
            summary:
              settled.reason === "timeout"
                ? `surface still changing after ${settled.waitedMs}ms — catalog may lag`
                : `surface v${settled.fromVersion} → v${settled.toVersion} in ${settled.waitedMs}ms`,
            durationMs: settled.waitedMs,
            correlation: {
              conversationId,
              turnId,
              toolCallId: pending.toolCallId,
              capabilityId: pending.canonicalId,
            },
          });
        }
      }

      verdict = guard.record({
        canonicalId: pending.canonicalId,
        input: pending.input,
        ok: outcome.ok,
        result: outcome.value,
      });
      if (verdict) break;
    }

    messages = [
      ...messages,
      ...toolMessages,
      ...unexecutedResults(step.pendingToolCalls.slice(executed)),
    ];

    if (cancelled) return { messages, status: "cancelled" };
    if (verdict) {
      events.onError(verdict);
      return { messages, status: "error" };
    }
    events.onAssistantMessageBoundary();
  }

  events.onError({
    code: "RUN_LIMIT_EXCEEDED",
    message: `Stopped after ${MAX_STEPS_PER_TURN} steps in one turn.`,
  });
  return { messages, status: "error" };
}

interface PendingToolCall {
  toolCallId: string;
  wireName: string;
  canonicalId: string;
  input: unknown;
}

interface StepConsumption {
  status: "completed" | "error" | "cancelled";
  responseMessages: WireModelMessage[];
  pendingToolCalls: PendingToolCall[];
  /** Server-plane calls that settled during this step, in order, for the guard. */
  serverToolResults: ToolOutcome[];
}

export function toolResultMessage(call: PendingToolCall, value: unknown): WireModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.wireName,
        output: { type: "json", value },
      },
    ],
  };
}

/**
 * Answers for calls this turn will not run. Same code and wording the server
 * uses for its own orphans (`settleOrphanedServerCalls`), because it is the
 * same fact: the call was issued, nothing executed it, and saying so is what
 * keeps the model from assuming it succeeded.
 */
export function unexecutedResults(calls: readonly PendingToolCall[]): WireModelMessage[] {
  return calls.map((call) =>
    toolResultMessage(call, {
      error: {
        code: "TOOL_NOT_EXECUTED",
        message: "The run ended before this tool produced a result. Call it again.",
        retry: "yes",
      },
    }),
  );
}

async function consumeStepStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  events: TurnEvents,
  correlation: { conversationId: string; turnId: string },
): Promise<StepConsumption> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const outcome: StepConsumption = {
    status: "completed",
    responseMessages: [],
    pendingToolCalls: [],
    serverToolResults: [],
  };
  let sawError = false;
  // `tool-result` frames carry no input, so the guard's identity key has to be
  // rebuilt from the matching `tool-call`.
  const serverInputs = new Map<string, unknown>();

  const frameDecoder = createFrameDecoder((frame) => {
    handleFrame(frame);
  });

  function handleFrame(frame: ChatStepFrame) {
    switch (frame.type) {
      case "step-start":
        events.onDomainCatalog(frame.domainTools);
        inspector.push({
          lane: "host",
          type: "step-start",
          status: "info",
          summary: `server composed catalog · ${frame.domainTools.length} domain tools`,
          correlation: { ...correlation, stepId: frame.stepId },
        });
        break;
      case "text-delta":
        events.onTextDelta(frame.text);
        break;
      case "reasoning-delta":
        events.onReasoningDelta(frame.text);
        break;
      case "tool-call":
        if (frame.executor === "server") {
          serverInputs.set(frame.toolCallId, frame.input);
          events.onToolCall({
            toolCallId: frame.toolCallId,
            wireName: frame.wireName,
            canonicalId: frame.canonicalId,
            executor: "server",
            input: frame.input,
          });
        }
        break;
      case "tool-result":
        outcome.serverToolResults.push({
          canonicalId: frame.canonicalId,
          input: serverInputs.get(frame.toolCallId) ?? {},
          ok: frame.ok,
          result: frame.result,
        });
        events.onToolResult({
          toolCallId: frame.toolCallId,
          wireName: frame.wireName,
          canonicalId: frame.canonicalId,
          executor: "server",
          ok: frame.ok,
          result: frame.result,
        });
        break;
      case "inspector":
        inspector.push({
          lane: frame.lane,
          type: frame.eventType,
          status: "info",
          summary: frame.summary,
          ...(frame.correlation ? { correlation: frame.correlation } : {}),
          ...(frame.data !== undefined ? { data: frame.data } : {}),
        });
        break;
      case "step-finish":
        outcome.responseMessages = frame.responseMessages;
        outcome.pendingToolCalls = frame.pendingToolCalls;
        // Per step, not per turn: a turn that loops through tool calls resends
        // the whole conversation each time, so the steps add up to what the
        // turn actually cost.
        if (frame.usage) events.onUsage(frame.usage);
        break;
      case "error":
        sawError = true;
        events.onError(frame.error);
        break;
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      frameDecoder.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    if (signal.aborted) return { ...outcome, status: "cancelled" };
    events.onError({ code: "TRANSPORT_FAILED", message: "The chat stream was interrupted." });
    return { ...outcome, status: "error" };
  }

  if (sawError) return { ...outcome, status: "error" };
  return outcome;
}

async function safeErrorDetail(response: Response): Promise<{ code: string; message: string }> {
  try {
    const parsed = (await response.json()) as { error?: { code?: string; message?: string } };
    if (parsed.error?.code && parsed.error.message) {
      return { code: parsed.error.code, message: parsed.error.message };
    }
  } catch {
    // fall through
  }
  return {
    code: "TRANSPORT_FAILED",
    message: `Chat endpoint returned ${response.status}.`,
  };
}
