import { createAgentToolset } from "@agent-surface/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSurfaceRegistry,
  resetSurfaceForTests,
  setSurfaceEnvironmentForTests,
} from "@/agent/surface/registry";

import { HOST_CONSUMER } from "./identity";
import { encodeFrame, type ChatStepFrame, type DomainToolInfo } from "./protocol";
import { runTurn, type TurnEvents } from "./transport-client";

/**
 * Cache reconciliation for the SERVER plane, over canned protocol frames.
 *
 * A direct domain tool runs inside the server's model loop: it never reaches
 * the browser's Agent Surface registry, so the `invocation-settled`
 * subscription in `surface/wiring.tsx` cannot fire for it. The stream consumer
 * invalidates off the result frame instead — and the interesting cases are the
 * ones where it must NOT: reads, refusals, and above all the approval
 * suspension, whose `ok` result wrote nothing. The write a suspension defers
 * lands later, inside `POST /api/approvals/:id`, where no stream is open at
 * all — that path reconciles itself (tool-ui.tsx), and no frame here may
 * claim its write early.
 */

function domainTool(
  canonicalId: string,
  sideEffect: string,
  requiresApproval = false,
): DomainToolInfo {
  return {
    canonicalId: `domain:${canonicalId}`,
    wireName: canonicalId.replace(/-/g, "_"),
    description: "",
    requiresApproval,
    sideEffect,
  };
}

/** One step: the server calls its own tools and stops. */
function serverTurn(
  domainTools: DomainToolInfo[],
  calls: Array<{ tool: DomainToolInfo; ok: boolean; result?: unknown }>,
): ChatStepFrame[] {
  return [
    { type: "step-start", stepId: "s0", turnId: "t", conversationId: "c", domainTools },
    ...calls.flatMap((call, index): ChatStepFrame[] => [
      {
        type: "tool-call",
        toolCallId: `tc${index}`,
        wireName: call.tool.wireName,
        canonicalId: call.tool.canonicalId,
        executor: "server",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: `tc${index}`,
        wireName: call.tool.wireName,
        canonicalId: call.tool.canonicalId,
        ok: call.ok,
        result:
          call.result ??
          (call.ok
            ? { status: "ok", data: { id: 1 } }
            : { error: { code: "EXECUTION_FAILED", message: "no" } }),
      },
    ]),
    {
      type: "step-finish",
      stepId: "s0",
      finishReason: "stop",
      responseMessages: [{ role: "assistant", content: "done" }],
      pendingToolCalls: [],
    },
  ];
}

/** Runs one turn over canned frames; returns how often it asked to refetch. */
async function reconciliationsFor(frames: ChatStepFrame[]): Promise<number> {
  let reconciled = 0;
  const encoder = new TextEncoder();

  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(encodeFrame(frame)));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    ),
  );

  const registry = getSurfaceRegistry();
  const events: TurnEvents = {
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
    onDomainCatalog: () => {},
    onDomainMutation: () => {
      reconciled += 1;
    },
    onUsage: () => {},
    onAssistantMessageBoundary: () => {},
    onError: () => {},
  };

  const outcome = await runTurn({
    conversationId: "c",
    turnId: "t",
    messages: [{ role: "user", content: "do it" }],
    registry,
    toolsetFor: () =>
      createAgentToolset(registry, {
        consumer: HOST_CONSUMER,
        topology: "remote",
        confirmations: "wait",
      }),
    pathname: "/receivables/pending",
    signal: new AbortController().signal,
    events,
  });
  expect(outcome.status).toBe("completed");
  return reconciled;
}

describe("server-plane reconciliation", () => {
  beforeEach(() => {
    resetSurfaceForTests();
    setSurfaceEnvironmentForTests("test");
  });

  afterEach(() => {
    resetSurfaceForTests();
    setSurfaceEnvironmentForTests(undefined);
    vi.unstubAllGlobals();
  });

  it("refetches after a write the server executed", async () => {
    const write = domainTool("update-invoice", "write");

    const reconciled = await reconciliationsFor(serverTurn([write], [{ tool: write, ok: true }]));

    expect(reconciled).toBe(1);
  });

  it("refetches after a destructive call too", async () => {
    const remove = domainTool("delete-invoice", "destructive");

    const reconciled = await reconciliationsFor(serverTurn([remove], [{ tool: remove, ok: true }]));

    expect(reconciled).toBe(1);
  });

  it("leaves the cache alone for reads", async () => {
    const read = domainTool("list-invoices", "read");

    const reconciled = await reconciliationsFor(serverTurn([read], [{ tool: read, ok: true }]));

    expect(reconciled).toBe(0);
  });

  it("does not refetch after a write that failed", async () => {
    const write = domainTool("update-invoice", "write");

    const reconciled = await reconciliationsFor(serverTurn([write], [{ tool: write, ok: false }]));

    expect(reconciled).toBe(0);
  });

  it("does not refetch when the write suspended at the approval gate", async () => {
    // The FIRST result of a gated capability: `ok` on the wire, nothing
    // written. Reconciling here is the inverted half of the bug — a refetch
    // for a write that has not happened, then silence later when the approval
    // decision actually executes it (that path reconciles itself, in
    // tool-ui.tsx `decide`).
    const gated = domainTool("issue-invoice", "destructive", true);

    const reconciled = await reconciliationsFor(
      serverTurn(
        [gated],
        [
          {
            tool: gated,
            ok: true,
            result: {
              status: "approval-required",
              approvalId: "apr_1",
              message: "Awaiting approval.",
            },
          },
        ],
      ),
    );

    expect(reconciled).toBe(0);
  });

  it("refetches once per write in a multi-call step", async () => {
    const write = domainTool("update-invoice", "write");
    const read = domainTool("list-invoices", "read");

    const reconciled = await reconciliationsFor(
      serverTurn(
        [write, read],
        [
          { tool: read, ok: true },
          { tool: write, ok: true },
          { tool: write, ok: true },
        ],
      ),
    );

    expect(reconciled).toBe(2);
  });
});
