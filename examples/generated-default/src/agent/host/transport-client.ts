"use client";

import type { AgentSurfaceRegistry, AgentToolset } from "@agent-surface/core";
import { inspector } from "@/agent/inspector/inspector-store";
import { buildFrontendToolDescriptors } from "./catalog";
import { dispatchFrontendToolCall } from "./client-dispatch";
import { HOST_CONSUMER } from "./identity";
import {
  createFrameDecoder,
  PROTOCOL_VERSION,
  type ChatStepFrame,
  type DomainToolInfo,
  type WireModelMessage,
} from "./protocol";

/**
 * The browser half of the Agent Host loop (ADR-0002).
 *
 * One turn = repeat until the model stops:
 *   1. project the LIVE surface into frontend tool descriptors;
 *   2. POST a step; stream frames (text, server tool activity, inspector);
 *   3. if the step ended at frontend tool-calls, execute them through Agent
 *      Surface (confirmations wait here, between requests) and loop.
 *
 * Run limits live in host code, not prompts: max steps, a turn deadline, and
 * repeated-failure loop detection.
 */

const MAX_STEPS_PER_TURN = 8;
const TURN_DEADLINE_MS = 180_000;
const MAX_IDENTICAL_FAILURES = 3;

export interface TurnEvents {
  onTextDelta: (text: string) => void;
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
  signal: AbortSignal;
  events: TurnEvents;
}

export interface TurnOutcome {
  /** Updated history to persist for the next turn. */
  messages: WireModelMessage[];
  status: "completed" | "error" | "cancelled";
}

export async function runTurn(options: RunTurnOptions): Promise<TurnOutcome> {
  const { conversationId, turnId, registry, toolset, signal, events } = options;
  let messages = [...options.messages];
  const startedAt = performance.now();
  const failureCounts = new Map<string, number>();

  for (let stepIndex = 0; stepIndex < MAX_STEPS_PER_TURN; stepIndex++) {
    if (signal.aborted) return { messages, status: "cancelled" };
    if (performance.now() - startedAt > TURN_DEADLINE_MS) {
      events.onError({
        code: "RUN_LIMIT_EXCEEDED",
        message: "Turn deadline exceeded; the run was stopped.",
      });
      return { messages, status: "error" };
    }

    const snapshot = registry.snapshot({ consumer: HOST_CONSUMER, includeUnavailable: true });
    const frontendTools = buildFrontendToolDescriptors(toolset, snapshot);

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
          messages,
          frontendTools,
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

    if (step.pendingToolCalls.length === 0) {
      return { messages, status: "completed" };
    }

    // Execute the frontend tool calls this step ended on. Confirmations for
    // destructive contextual procedures block HERE — no server stream is open.
    const toolMessages: WireModelMessage[] = [];
    for (const pending of step.pendingToolCalls) {
      if (signal.aborted) return { messages, status: "cancelled" };
      events.onToolCall({
        toolCallId: pending.toolCallId,
        wireName: pending.wireName,
        canonicalId: pending.canonicalId,
        executor: "browser",
        input: pending.input,
      });
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

      if (!outcome.ok) {
        const key = `${pending.canonicalId}:${JSON.stringify(pending.input ?? {})}`;
        const failures = (failureCounts.get(key) ?? 0) + 1;
        failureCounts.set(key, failures);
        if (failures >= MAX_IDENTICAL_FAILURES) {
          events.onError({
            code: "RUN_LIMIT_EXCEEDED",
            message: `Stopped: ${pending.canonicalId} failed identically ${failures} times.`,
          });
          return { messages, status: "error" };
        }
      }

      toolMessages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: pending.toolCallId,
            toolName: pending.wireName,
            output: { type: "json", value: outcome.value },
          },
        ],
      });
    }

    messages = [...messages, ...toolMessages];
    events.onAssistantMessageBoundary();
  }

  events.onError({
    code: "RUN_LIMIT_EXCEEDED",
    message: `Stopped after ${MAX_STEPS_PER_TURN} steps in one turn.`,
  });
  return { messages, status: "error" };
}

interface StepConsumption {
  status: "completed" | "error" | "cancelled";
  responseMessages: WireModelMessage[];
  pendingToolCalls: Array<{
    toolCallId: string;
    wireName: string;
    canonicalId: string;
    input: unknown;
  }>;
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
  };
  let sawError = false;

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
      case "tool-call":
        if (frame.executor === "server") {
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
