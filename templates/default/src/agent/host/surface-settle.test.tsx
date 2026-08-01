import {
  createAgentSurfaceRegistry,
  createAgentToolset,
  observation,
  type AgentSurfaceRegistry,
  type AgentToolset,
} from "@agent-surface/core";
import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zs } from "@/agent/surface/schema";
import { createFixture, FixturePage, FixtureProviders } from "@/test/devices-fixture";
import { HOST_CONSUMER } from "./identity";
import { encodeFrame, type ChatStepFrame, type ChatStepRequestV2 } from "./protocol";
import { waitForSurfaceSettled } from "./surface-settle";
import { runTurn } from "./transport-client";

/**
 * Surface settlement.
 *
 * A frontend tool call returns to the step loop across microtasks; the surface
 * it changed moves on a React commit. Without a wait between the two, the
 * catalog the model receives in step N+1 is the surface as it was before step
 * N acted — capabilities gained by a navigation are missing entirely, and
 * availability that a `local-state` action flipped still reads the old way.
 *
 * The loop-level test below deliberately runs OUTSIDE `act()`. The
 * agent-surface test harness wraps `invoke()` in `act()`, which flushes
 * effects synchronously — a courtesy production does not get, and the reason
 * this class of bug survives a green suite.
 */

const ACT_FLAG = "IS_REACT_ACT_ENVIRONMENT" as const;

function setActEnvironment(enabled: boolean) {
  (globalThis as Record<string, unknown>)[ACT_FLAG] = enabled;
}

// ---------------------------------------------------------------------------
// The primitive

describe("waitForSurfaceSettled", () => {
  let registry: AgentSurfaceRegistry | undefined;

  afterEach(() => {
    registry?.dispose();
    registry = undefined;
  });

  /** A registration is the cheapest way to move the version by exactly one. */
  function bump(target: AgentSurfaceRegistry, n: number) {
    target.register({
      type: "probe",
      instanceId: `p${n}`,
      description: "Moves the surface version",
      observations: {
        read: observation({
          description: "Nothing in particular",
          output: zs(z.object({ n: z.number() })),
          read: () => ({ n }),
        }),
      },
    });
  }

  it("reports `unchanged` when nothing moves, without waiting out the ceiling", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const started = performance.now();

    const result = await waitForSurfaceSettled(registry, registry.getVersion());

    expect(result.reason).toBe("unchanged");
    expect(result.fromVersion).toBe(result.toVersion);
    // The standing cost of the gate is the first-change budget, not the
    // ceiling — otherwise every read-only step would pay 750ms.
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("waits for a change that lands after the caller returned", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const before = registry.getVersion();
    // A macrotask later — exactly where a React passive effect lands, and
    // exactly what a microtask-only return path misses.
    setTimeout(() => bump(registry!, 1), 10);

    const result = await waitForSurfaceSettled(registry, before);

    expect(result.reason).toBe("settled");
    expect(result.toVersion).not.toBe(before);
  });

  it("sees a change that landed before it was called", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const before = registry.getVersion();
    bump(registry, 1);

    // `surface-changed` is coalesced per microtask, so subscribing after the
    // bump never delivers an event for it. Comparing versions does.
    const result = await waitForSurfaceSettled(registry, before);

    expect(result.reason).toBe("settled");
    expect(result.toVersion).not.toBe(before);
  });

  it("re-arms the quiet window so a staged transition settles once", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const before = registry.getVersion();
    // Unmount-then-mount, the shape of a route change.
    setTimeout(() => bump(registry!, 1), 10);
    setTimeout(() => bump(registry!, 2), 45);

    const result = await waitForSurfaceSettled(registry, before);

    expect(result.reason).toBe("settled");
    // Both bumps are behind us: version 0 → 2, not 0 → 1.
    expect(result.toVersion).toBe("2");
  });

  it("gives up on a surface that never stops changing", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const before = registry.getVersion();
    let n = 0;
    const churn = setInterval(() => bump(registry!, ++n), 15);

    try {
      const result = await waitForSurfaceSettled(registry, before, {
        budget: { timeoutMs: 200 },
      });
      expect(result.reason).toBe("timeout");
    } finally {
      clearInterval(churn);
    }
  });

  it("returns immediately when the turn is already cancelled", async () => {
    registry = createAgentSurfaceRegistry({ environment: "production" });
    const aborted = AbortSignal.abort();

    const result = await waitForSurfaceSettled(registry, registry.getVersion(), {
      signal: aborted,
    });

    expect(result.reason).toBe("aborted");
  });
});

// ---------------------------------------------------------------------------
// The loop

interface ScriptedStep {
  frames: ChatStepFrame[];
}

/** A `/api/chat` response the transport can consume, minus the network. */
function ndjson(frames: ChatStepFrame[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(encodeFrame(frame)));
      controller.close();
    },
  });
  // The transport reads `ok` and `body` only; a real Response would drag in
  // fetch-environment differences for nothing.
  return { ok: true, body } as unknown as Response;
}

function stepStart(): ChatStepFrame {
  return {
    type: "step-start",
    stepId: "stp_1",
    turnId: "trn_1",
    conversationId: "cnv_1",
    domainTools: [],
  };
}

function callsFrontendTool(wireName: string, input: unknown): ChatStepFrame[] {
  const toolCallId = "call_1";
  return [
    stepStart(),
    {
      type: "step-finish",
      stepId: "stp_1",
      finishReason: "tool-calls",
      responseMessages: [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId, toolName: wireName, input }],
        },
      ],
      pendingToolCalls: [{ toolCallId, wireName, canonicalId: "view:probe", input }],
    },
  ];
}

function finishes(text: string): ChatStepFrame[] {
  return [
    stepStart(),
    { type: "text-delta", text },
    {
      type: "step-finish",
      stepId: "stp_2",
      finishReason: "stop",
      responseMessages: [{ role: "assistant", content: [{ type: "text", text }] }],
      pendingToolCalls: [],
    },
  ];
}

function wireNameFor(toolset: AgentToolset, canonicalId: string): string {
  // `tools()` is what assigns the names; the map is authoritative after it.
  toolset.tools();
  for (const [wireName, id] of toolset.wireNameMap()) {
    if (id === canonicalId) return wireName;
  }
  throw new Error(`no wire name for ${canonicalId}`);
}

const noopEvents = {
  onTextDelta: () => {},
  onReasoningDelta: () => {},
  onToolCall: () => {},
  onToolResult: () => {},
  onDomainCatalog: () => {},
  onUsage: () => {},
  onAssistantMessageBoundary: () => {},
  onError: () => {},
};

describe("step loop · the next catalog reflects the call just made", () => {
  let fixture: ReturnType<typeof createFixture> | undefined;
  let surface: RenderedAgentSurface | undefined;
  let toolset: AgentToolset | undefined;

  afterEach(() => {
    setActEnvironment(true);
    vi.unstubAllGlobals();
    toolset?.dispose();
    toolset = undefined;
    surface?.dispose();
    surface = undefined;
    fixture?.cleanup();
    fixture = undefined;
  });

  it("sends availability the model can act on in the very next step", async () => {
    fixture = createFixture();
    surface = await renderAgentSurface(<FixturePage />, {
      registry: fixture.registry,
      wrapper: ({ children }) => (
        <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>
      ),
    });
    toolset = createAgentToolset(fixture.registry, {
      consumer: HOST_CONSUMER,
      topology: "remote",
      confirmations: "wait",
    });

    // `selectRows` is `local-state`: it flips `domain:devices.disable` from
    // unavailable (nothing selected) to available and bound to the selection.
    const selectRows = wireNameFor(toolset, "view:devices.table.selectRows");
    const disable = wireNameFor(toolset, "domain:devices.disable");

    const script: ScriptedStep[] = [
      { frames: callsFrontendTool(selectRows, { ids: ["d-mi-03", "d-mi-05"], mode: "replace" }) },
      { frames: finishes("Two devices are selected.") },
    ];
    const requests: ChatStepRequestV2[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as ChatStepRequestV2;
        requests.push(body);
        return ndjson(script[requests.length - 1]?.frames ?? finishes("done"));
      }),
    );

    // Production does not run the loop inside act(); neither does this.
    setActEnvironment(false);
    const outcome = await runTurn({
      conversationId: "cnv_1",
      turnId: "trn_1",
      messages: [{ role: "user", content: "Select the two broken Milan devices." }],
      registry: fixture.registry,
      toolset,
      pathname: "/dashboard",
      mode: "direct",
      signal: new AbortController().signal,
      events: noopEvents,
    });

    expect(outcome.status).toBe("completed");
    expect(requests).toHaveLength(2);

    const before = requests[0]?.catalog.frontendState.find((s) => s.wireName === disable);
    const after = requests[1]?.catalog.frontendState.find((s) => s.wireName === disable);

    // Step 0: nothing selected yet.
    expect(before?.available).toBe(false);
    // Step 1: the selection the model just made is visible to it. Before the
    // settlement gate this still read `false`, and the instruction not to work
    // around an unavailable capability turned that into a refusal.
    expect(after?.available).toBe(true);
    expect(after?.note).toMatch(/2 selected device/i);
  });

  it("does not stall a turn whose calls change nothing", async () => {
    fixture = createFixture();
    surface = await renderAgentSurface(<FixturePage />, {
      registry: fixture.registry,
      wrapper: ({ children }) => (
        <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>
      ),
    });
    toolset = createAgentToolset(fixture.registry, {
      consumer: HOST_CONSUMER,
      topology: "remote",
      confirmations: "wait",
    });

    const readState = wireNameFor(toolset, "view:devices.table.readState");
    const script: ScriptedStep[] = [
      { frames: callsFrontendTool(readState, {}) },
      { frames: finishes("Twelve devices are visible.") },
    ];
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson(script[requests++]?.frames ?? finishes("done"))),
    );

    setActEnvironment(false);
    const started = performance.now();
    const outcome = await runTurn({
      conversationId: "cnv_1",
      turnId: "trn_1",
      messages: [{ role: "user", content: "What is on screen?" }],
      registry: fixture.registry,
      toolset,
      pathname: "/dashboard",
      mode: "direct",
      signal: new AbortController().signal,
      events: noopEvents,
    });

    expect(outcome.status).toBe("completed");
    // An observation cannot move the surface, so the gate is skipped outright
    // rather than paying even the first-change budget.
    expect(performance.now() - started).toBeLessThan(400);
  });
});
