import type { AgentSurfaceRegistry, AgentToolset } from "@agent-surface/core";
import { inspector } from "@/agent/inspector/inspector-store";
import { committedSurfaceLocation } from "@/agent/surface/registry";
import { buildFrontendToolDescriptors } from "./catalog";
import { dispatchFrontendToolCall } from "./client-dispatch";
import { HOST_CONSUMER } from "./identity";
import { createLoopGuard, type ToolOutcome } from "./loop-guard";
import {
  CATALOG_LIMITS,
  catalogTooLargeMessage,
  createFrameDecoder,
  mutatesData,
  PROTOCOL_VERSION,
  type ChatStepFrame,
  type DomainToolInfo,
  type StepUsage,
  type WireModelMessage,
} from "./protocol";
import { scopeForRoute } from "./scope";
import { settleSurface } from "./settle";
import { currentPathname } from "./toolset";

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
   * A server-plane write just SUCCEEDED, so anything the tab is displaying may
   * now be stale.
   *
   * This is the second trigger for the app's one reconciliation convention.
   * The first is the surface subscription in `app/agent/surface/wiring.tsx`,
   * which covers capabilities the agent runs in the BROWSER; those never reach
   * this callback, and the calls that reach this callback never reach that
   * subscription. Neither covers the other plane — that split is the whole
   * reason both exist.
   *
   * Fires once per successful write, not once per turn: a turn that writes
   * three times and keeps reasoning should update the screen as it goes, and
   * the agent's own later reads of that screen should see the new state too.
   */
  onDomainMutation: () => void;
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
  /**
   * Toolset for a route. Called per step rather than once per turn: scope is
   * fixed at toolset construction, so a turn that navigates needs a new one to
   * see where it went. Cached per (registry, scope) upstream, so re-asking for
   * the same route is free.
   */
  toolsetFor: (pathname: string) => AgentToolset;
  /** The route this turn STARTS on; scopes the catalog on both planes. */
  pathname: string;
  /**
   * Model the user picked. A preference only — the server checks it against
   * its own allowlist and falls back to the default.
   */
  modelId?: string;
  signal: AbortSignal;
  events: TurnEvents;
}

export interface TurnOutcome {
  /** Updated history to persist for the next turn. */
  messages: WireModelMessage[];
  status: "completed" | "error" | "cancelled";
}

export async function runTurn(options: RunTurnOptions): Promise<TurnOutcome> {
  const { conversationId, turnId, registry, toolsetFor, modelId, signal, events } = options;
  let messages = [...options.messages];
  /**
   * Follows the agent's OWN navigation, and only that. A `goTo` it chose is
   * part of the plan — refusing to rescope after it would leave the model on
   * the destination screen with the origin's catalog, which is the same dead
   * end as not letting it navigate at all. A route change the USER made
   * mid-turn is not reflected here: the catalog must not shift under a run
   * because somebody clicked the sidebar.
   */
  let pathname = options.pathname;
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
    // fall through to defaults. Both re-derive from `pathname`, which the
    // agent's own navigation moves.
    const toolset = toolsetFor(pathname);
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
    } = buildFrontendToolDescriptors(toolset, snapshot);

    // View-plane calls that can move the surface underneath the next snapshot.
    // Observations cannot. Domain calls are excluded deliberately: they
    // reconcile through the query cache on their own schedule and emit no
    // surface event, so waiting on them here would spend the settle budget on
    // every server write and still not be the thing that made it fresh.
    const movesSurface = new Set(
      frontendTools.filter((d) => d.plane === "view" && d.effect !== "read").map((d) => d.wireName),
    );
    // The subset that moves the ROUTE, and so the scope of everything after it.
    const movesRoute = new Set(
      frontendTools.filter((d) => d.effect === "navigation").map((d) => d.wireName),
    );

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
      response = await fetch("/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          conversationId,
          turnId,
          stepIndex,
          pathname,
          ...(modelId ? { modelId } : {}),
          messages,
          catalog: {
            mode: "direct" as const,
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            frontendTools,
            frontendState,
            ...(undecodable.length > 0
              ? { truncated: { dropped: undecodable.length, reason: "undecodable" as const } }
              : {}),
          },
        }),
      });
    } catch {
      // The cause is deliberately unread: a fetch rejection carries the URL and
      // sometimes the response body, and this message reaches the model.
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

      // The call may have mounted a screen, flipped an availability or changed
      // the rows behind an observation — all of which React applies on a later
      // task. Both readers of the surface are synchronous: the next iteration
      // of this loop (a batched `setFilters` + `readState` would otherwise read
      // pre-filter rows) and the next step's snapshot. Wait here so neither
      // describes a surface that no longer exists.
      //
      // Every view mutation this app has either navigates or writes the query
      // string, and the router defers both into a transition — so waiting for
      // the surface to fall quiet is not enough. It must also have caught up
      // with the URL.
      if (movesSurface.has(pending.wireName)) {
        await settleSurface(registry, { until: locationCommitted });
      }

      // Read AFTER settling, so the router has committed. Only a successful
      // navigation rescopes: a rejected `goTo` (unknown route) left the app
      // where it was, and adopting the destination it never reached would hand
      // the next step a catalog for a screen nobody is looking at.
      if (outcome.ok && movesRoute.has(pending.wireName)) {
        pathname = currentPathname();
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
 * Has the rendered tree caught up with the URL?
 *
 * `history.pushState` runs synchronously inside `navigate()` and
 * `setSearchParams()`; the render they trigger is a transition, so for a while
 * afterwards `window.location` describes a screen that has not mounted. The
 * surface writes what it has actually committed from a mount effect, and the
 * two agreeing is the earliest honest moment to describe the screen.
 */
function locationCommitted(): boolean {
  if (typeof window === "undefined") return true;
  return committedSurfaceLocation() === `${window.location.pathname}${window.location.search}`;
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
  /**
   * Wire name → side effect, for THIS step only.
   *
   * Deliberately not hoisted to the turn: the catalog is composed per request
   * from the actor and the route, so a map built for an earlier step describes
   * a different set of tools — and after a `goTo` mid-turn, a materially
   * different one.
   */
  const sideEffectByWire = new Map<string, string | undefined>();

  const frameDecoder = createFrameDecoder((frame) => {
    handleFrame(frame);
  });

  function handleFrame(frame: ChatStepFrame) {
    switch (frame.type) {
      case "step-start":
        for (const tool of frame.domainTools) {
          sideEffectByWire.set(tool.wireName, tool.sideEffect);
        }
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
        // Membership in the map is the test for "this is a governed server
        // tool": a name outside it is a frontend declaration or one the model
        // invented, and neither wrote anything here. Successes only —
        // refetching after a REFUSED write would dress a failure up as an
        // update, which is worse than the stale screen it replaces.
        //
        // `has` and `get` are separate because the field is optional: an
        // absent entry means "not a server tool", while an entry holding
        // `undefined` means "server tool whose effect this server did not
        // declare" — which `mutatesData` counts as a write.
        if (frame.ok && sideEffectByWire.has(frame.wireName)) {
          if (mutatesData(sideEffectByWire.get(frame.wireName))) {
            inspector.push({
              lane: "host",
              type: "reconcile",
              status: "info",
              summary: `${frame.canonicalId} wrote · invalidating query cache`,
              correlation: { ...correlation, toolCallId: frame.toolCallId },
            });
            events.onDomainMutation();
          }
        }
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
