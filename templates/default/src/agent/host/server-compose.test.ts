import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatStepFrame, WireModelMessage, WireToolDescriptor } from "./protocol";
import {
  createResponseAccumulator,
  createUsageAccumulator,
  settleOrphanedServerCalls,
  withResultCapture,
  type ToolExecutionRecord,
} from "./server-compose";

/**
 * Server half of the Agent Host, exercised through real Request/Response
 * objects with the scripted model (ADR-0006). Covers: per-turn composition,
 * frame streaming, client-tool suspension, message reconstruction, collision
 * rejection, protocol versioning, and the demo-mode 503.
 */

process.env.DPAS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "dpas-compose-test-"));

let handleChatStep: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("MODEL_PROVIDER", "mock");
  ({ handleChatStep } = await import("./server-compose"));
});

afterEach(() => {
  vi.stubEnv("MODEL_PROVIDER", "mock");
});

const filtersTool: WireToolDescriptor = {
  wireName: "view_devices__filters__set",
  canonicalId: "view:devices.filters.set",
  plane: "view",
  description: "[view] set filters",
  inputSchema: { type: "object" },
  effect: "local-state",
  confirmation: "never",
  available: true,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stepBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    protocolVersion: 1,
    conversationId: "cnv_t",
    turnId: "trn_t",
    stepIndex: 0,
    messages: [{ role: "user", content: "disable the offline devices in Milan" }],
    frontendTools: [filtersTool],
    ...overrides,
  };
}

async function readFrames(response: Response): Promise<ChatStepFrame[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatStepFrame);
}

/**
 * Regression: when one assistant message calls a SERVER tool and a CLIENT
 * tool, Mastra executes the server tool but suspends the run for the browser
 * and never emits that result — it is absent from `fullStream` AND from
 * `stream.toolResults`. Left alone, the model receives a tool-call with no
 * tool-result (providers reject that, and the run stalls) and the browser
 * shows a card stuck on "running" forever.
 */
describe("orphaned server tool calls", () => {
  it("answers an unresolved server call with the captured result", () => {
    const accumulator = createResponseAccumulator();
    accumulator.toolCall("call_server", "domain_devices__list", { city: "Turin" }, "server");
    accumulator.toolCall("call_client", "view_devices__filters__set", {}, "browser");

    const recorded = new Map<string, ToolExecutionRecord>([
      ["call_server", { ok: true, result: { devices: [{ id: "d-to-03" }], total: 1 } }],
    ]);

    const settled = settleOrphanedServerCalls(accumulator, recorded);
    expect(settled).toEqual([
      {
        toolCallId: "call_server",
        wireName: "domain_devices__list",
        ok: true,
        result: { devices: [{ id: "d-to-03" }], total: 1 },
      },
    ]);

    // The history now answers the server call, and the client call is still
    // the browser's to execute.
    const toolMessages = accumulator.messages().filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toMatchObject([
      { type: "tool-result", toolCallId: "call_server" },
    ]);
    expect(accumulator.pendingBrowserCalls().map((c) => c.toolCallId)).toEqual(["call_client"]);
  });

  it("tells the model plainly when a server call never ran", () => {
    const accumulator = createResponseAccumulator();
    accumulator.toolCall("call_server", "domain_devices__list", {}, "server");
    const settled = settleOrphanedServerCalls(accumulator, new Map());
    expect(settled[0]).toMatchObject({
      ok: false,
      result: { error: { code: "TOOL_NOT_EXECUTED", retry: "yes" } },
    });
  });

  it("leaves calls Mastra already resolved alone", () => {
    const accumulator = createResponseAccumulator();
    accumulator.toolCall("call_server", "domain_devices__list", {}, "server");
    accumulator.toolResult("call_server", "domain_devices__list", { total: 0 });
    expect(settleOrphanedServerCalls(accumulator, new Map())).toEqual([]);
  });

  it("captures results and failures from the wrapped domain toolset", async () => {
    const recorded = new Map<string, ToolExecutionRecord>();
    const wrapped = withResultCapture(
      {
        good: {
          description: "d",
          inputSchema: { type: "object" },
          execute: async () => ({ total: 2 }),
        },
        bad: {
          description: "d",
          inputSchema: { type: "object" },
          execute: async () => {
            throw new Error("boom");
          },
        },
        declarationOnly: { description: "d", inputSchema: { type: "object" } },
      } as never,
      recorded,
    );

    await wrapped.good!.execute!({} as never, { toolCallId: "c1" } as never);
    await expect(
      wrapped.bad!.execute!({} as never, { toolCallId: "c2" } as never),
    ).rejects.toThrow("boom");

    expect(recorded.get("c1")).toEqual({ ok: true, result: { total: 2 } });
    expect(recorded.get("c2")).toMatchObject({ ok: false });
    // An execute-less declaration passes through untouched.
    expect(wrapped.declarationOnly!.execute).toBeUndefined();
  });
});

/**
 * The runtime reports token usage twice: per model step, and again as a run
 * total on the closing `finish`. Both are legitimate; adding them together is
 * not, and a counter that silently doubles is worse than no counter.
 */
describe("token usage accounting", () => {
  const step = (inputTokens: number, outputTokens: number) => ({
    output: { usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } },
  });

  it("does not add the run total on top of the steps it already summed", () => {
    const usage = createUsageAccumulator();
    usage.step(step(10, 4));
    usage.step(step(20, 6));
    // The run total the runtime emits is those two, already added up.
    usage.finish(step(30, 10));

    expect(usage.value()).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      reportedSteps: 2,
    });
  });

  it("keeps the partial sum when the run ends without a total", () => {
    // Timeout, error and abort all end the stream before `finish`. Those
    // tokens were spent, so they still have to be reported.
    const usage = createUsageAccumulator();
    usage.step(step(10, 4));
    usage.step(step(20, 6));

    expect(usage.value()).toMatchObject({ inputTokens: 30, outputTokens: 10, reportedSteps: 2 });
  });

  it("reports nothing at all when the provider reported nothing", () => {
    const usage = createUsageAccumulator();
    usage.step({ output: {} });
    usage.step({ output: { usage: { promptTokens: 12 } } });
    usage.finish(undefined);

    // Undefined, never a zero: "0 tokens" and "not measured" are different
    // claims, and only one of them is true here.
    expect(usage.value()).toBeUndefined();
  });

  it("accepts the alternative fields a runtime may fill instead", () => {
    const fromTotalUsage = createUsageAccumulator();
    fromTotalUsage.step({ totalUsage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } });
    expect(fromTotalUsage.value()).toMatchObject({ inputTokens: 7, outputTokens: 3 });

    const bare = createUsageAccumulator();
    bare.step({ usage: { inputTokens: 5, outputTokens: 2 } });
    // No total reported, so it is the parts added up.
    expect(bare.value()).toMatchObject({ outputTokens: 2, totalTokens: 7 });
  });

  it("ignores counts that are not counts", () => {
    const usage = createUsageAccumulator();
    usage.step({ output: { usage: { inputTokens: -5, outputTokens: Number.NaN, totalTokens: 9 } } });
    expect(usage.value()).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 9 });
  });

  it("keeps reasoning and cached input as subsets, never as additions", () => {
    // Reasoning bills AS output and is already inside it; cached input is
    // already inside the input. Anything that adds them reports tokens nobody
    // is charged for.
    const usage = createUsageAccumulator();
    usage.step({
      output: {
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          cachedInputTokens: 60,
          reasoningTokens: 25,
        },
      },
    });

    const value = usage.value();
    expect(value).toMatchObject({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    expect(value!.cachedInputTokens).toBeLessThanOrEqual(value!.inputTokens);
    expect(value!.reasoningTokens).toBeLessThanOrEqual(value!.outputTokens);
    expect(value).toMatchObject({ cachedInputTokens: 60, reasoningTokens: 25 });
  });

  it("leaves a subset absent when the provider never mentioned it", () => {
    // Absent is not zero: a model that reports no reasoning figure is not a
    // model that provably did none.
    const usage = createUsageAccumulator();
    usage.step(step(10, 4));
    expect(usage.value()).not.toHaveProperty("reasoningTokens");
    expect(usage.value()).not.toHaveProperty("cachedInputTokens");
  });

  it("does not let a silent step zero out a subset another step reported", () => {
    const usage = createUsageAccumulator();
    usage.step({ output: { usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 3 } } });
    usage.step(step(10, 4));
    expect(usage.value()).toMatchObject({ outputTokens: 8, reasoningTokens: 3 });
  });

  it("carries a provider total that exceeds input + output", () => {
    // Reasoning and other overhead land in the total; recomputing it as a sum
    // would quietly under-report what gets billed.
    const usage = createUsageAccumulator();
    usage.step({ output: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 40 } } });
    expect(usage.value()).toMatchObject({ totalTokens: 40 });
  });
});

describe("chat step composition", () => {
  it("streams the composed catalog, suspends at the frontend tool, and reconstructs messages", async () => {
    const response = await handleChatStep(request(stepBody()));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-dpas-protocol-version")).toBe("1");

    const frames = await readFrames(response);
    const start = frames.find((f) => f.type === "step-start");
    expect(start).toBeDefined();
    if (start?.type === "step-start") {
      const ids = start.domainTools.map((t) => t.canonicalId).sort();
      // Governed, deny-by-default: reads only; disable is contextual-only.
      expect(ids).toEqual(["domain:devices.get", "domain:devices.list"]);
      expect(start.domainTools.map((t) => t.wireName).sort()).toEqual([
        "domain_devices__get",
        "domain_devices__list",
      ]);
    }

    // The model batches a server tool and a client tool in one message.
    const toolCalls = frames.filter((f) => f.type === "tool-call");
    expect(toolCalls).toMatchObject([
      { executor: "server", canonicalId: "domain:devices.list" },
      {
        executor: "browser",
        canonicalId: "view:devices.filters.set",
        input: { status: "offline", city: "Milan" },
      },
    ]);

    // Mastra drops the server result when the run suspends; the host answers
    // that call itself, so the browser still gets a matching tool-result.
    const domainResult = frames.find(
      (f) => f.type === "tool-result" && f.canonicalId === "domain:devices.list",
    );
    expect(domainResult).toBeDefined();
    if (domainResult?.type === "tool-result") {
      expect(domainResult.ok).toBe(true);
      // orpc-agent's model-facing envelope: { status, data }.
      expect(domainResult.result).toMatchObject({ status: "ok", data: { total: 3 } });
    }

    const finish = frames.find((f) => f.type === "step-finish");
    expect(finish).toBeDefined();
    if (finish?.type === "step-finish") {
      expect(finish.finishReason).toBe("tool-calls");
      expect(finish.pendingToolCalls).toHaveLength(1);
      expect(finish.pendingToolCalls[0]).toMatchObject({
        wireName: "view_devices__filters__set",
      });
      // Every server tool-call is answered in the history, so the model never
      // sees an unresolved call (providers reject that shape).
      const answered = finish.responseMessages
        .filter((m) => m.role === "tool")
        .flatMap((m) => m.content as Array<Record<string, unknown>>)
        .map((part) => part.toolName);
      expect(answered).toContain("domain_devices__list");

      // Reconstructed suffix: assistant text + the pending tool call.
      const assistant = finish.responseMessages.find((m) => m.role === "assistant");
      expect(assistant).toBeDefined();
      const content = assistant!.content as Array<Record<string, unknown>>;
      expect(content.some((part) => part.type === "tool-call")).toBe(true);
    }
  });

  it("continues from returned tool results and eventually finishes with text", async () => {
    const messages: WireModelMessage[] = [
      { role: "user", content: "disable the offline devices in Milan" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "t1",
            toolName: "view_devices__filters__set",
            input: { status: "offline", city: "Milan" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "view_devices__filters__set",
            output: { type: "json", value: { done: true } },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "t2",
            toolName: "view_devices__table__readState",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t2",
            toolName: "view_devices__table__readState",
            output: {
              type: "json",
              value: { visibleRows: [], selectedIds: [], sorting: null },
            },
          },
        ],
      },
    ];
    const response = await handleChatStep(request(stepBody({ messages, stepIndex: 2 })));
    const frames = await readFrames(response);
    const text = frames
      .filter((f): f is Extract<ChatStepFrame, { type: "text-delta" }> => f.type === "text-delta")
      .map((f) => f.text)
      .join("");
    // Empty table → the scripted model reports there is nothing to disable.
    expect(text).toContain("no offline devices in Milan");
    const finish = frames.find((f) => f.type === "step-finish");
    if (finish?.type === "step-finish") {
      expect(finish.pendingToolCalls).toHaveLength(0);
    }
  });

  const contextualList: WireToolDescriptor = {
    ...filtersTool,
    wireName: "domain_devices__list",
    canonicalId: "domain:devices.list",
    plane: "domain",
  };

  it("rejects a duplicate model-visible path for one domain operation (v1)", async () => {
    const response = await handleChatStep(
      request(stepBody({ frontendTools: [contextualList] })),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CATALOG_COLLISION");
  });

  it("degrades a collision to a dropped duplicate under v2 and completes the turn", async () => {
    // One misconfigured capability must not take down the whole assistant.
    const response = await handleChatStep(
      request({
        protocolVersion: 2,
        conversationId: "cnv_t",
        turnId: "trn_t",
        stepIndex: 0,
        pathname: "/dashboard",
        messages: [{ role: "user", content: "list the devices" }],
        catalog: {
          mode: "direct",
          scope: ["devices"],
          frontendTools: [filtersTool, contextualList],
        },
      }),
    );

    expect(response.status).toBe(200);
    const frames = await readFrames(response);
    // The turn ran, and the drop was reported rather than absorbed.
    expect(frames.some((f) => f.type === "step-finish")).toBe(true);
    const notice = frames.find(
      (f) => f.type === "inspector" && f.eventType === "catalog.collision",
    );
    expect(notice).toBeDefined();
    expect(notice && "data" in notice ? notice.data : undefined).toMatchObject({
      capabilityIds: ["domain:devices.list"],
    });
  });

  it("reports what the step cost, once, on the finish frame", async () => {
    const response = await handleChatStep(request(stepBody()));
    const frames = await readFrames(response);

    const finish = frames.find((f) => f.type === "step-finish");
    expect(finish).toBeDefined();
    if (finish?.type === "step-finish") {
      // The scripted model bills 16/16 per model step (ADR-0006). This request
      // suspends after one, so it is exactly one step's worth — proof the run
      // total did not get added on top of it.
      expect(finish.usage).toEqual({
        inputTokens: 16,
        outputTokens: 16,
        totalTokens: 32,
        // Subsets, so they stay INSIDE their parents rather than adding to them.
        cachedInputTokens: 8,
        reasoningTokens: 4,
        reportedSteps: 1,
      });
    }

    // And it reaches the inspector, so the cost of a step is traceable next to
    // the catalog that produced it.
    const traced = frames.find((f) => f.type === "inspector" && f.eventType === "model.usage");
    expect(traced).toBeDefined();
    expect(traced && "data" in traced ? traced.data : undefined).toMatchObject({
      inputTokens: 16,
      outputTokens: 16,
    });
  });

  it("reports the effective mode and scope on step-start", async () => {
    const response = await handleChatStep(
      request({
        protocolVersion: 2,
        conversationId: "cnv_t",
        turnId: "trn_t",
        stepIndex: 0,
        pathname: "/dashboard",
        messages: [{ role: "user", content: "hello" }],
        catalog: { mode: "direct", scope: ["devices"], frontendTools: [filtersTool] },
      }),
    );

    const frames = await readFrames(response);
    const start = frames.find((f) => f.type === "step-start");
    expect(start).toMatchObject({ catalogMode: "direct", scope: ["devices"] });
  });

  it("keeps the route floor when the browser asks for a token it lacks", async () => {
    const response = await handleChatStep(
      request({
        protocolVersion: 2,
        conversationId: "cnv_t",
        turnId: "trn_t",
        stepIndex: 0,
        pathname: "/dashboard",
        messages: [{ role: "user", content: "hello" }],
        // Asking for something the route does not grant yields nothing extra,
        // and must not blank the catalog either.
        catalog: { mode: "direct", scope: ["billing"], frontendTools: [filtersTool] },
      }),
    );

    const frames = await readFrames(response);
    const start = frames.find((f) => f.type === "step-start");
    expect(start).toMatchObject({ scope: ["devices"] });
    if (start?.type === "step-start") {
      expect(start.domainTools.length).toBeGreaterThan(0);
    }
  });

  it("rejects protocol version mismatches with a typed error", async () => {
    const response = await handleChatStep(request(stepBody({ protocolVersion: 99 })));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PROTOCOL_VERSION_MISMATCH");
  });

  it("rejects malformed requests", async () => {
    const response = await handleChatStep(request({ nonsense: true }));
    expect(response.status).toBe(400);
  });

  /**
   * The scope the host forwards has to actually reach `describe`, not merely
   * ride along in the request. Every capability in this template carries the
   * same tag, so scoping to it cannot demonstrate exclusion — this drives the
   * runtime directly to prove the mechanism the host depends on.
   */
  it("forwards scope to discovery, which narrows the domain catalog", async () => {
    const { getAgentRuntime } = await import("@/server/agent/runtime");
    const { createContextForSession } = await import("@/server/orpc/context");
    const { resolveSession } = await import("@/server/auth/session");

    const session = resolveSession(null);
    const actor = { id: session.userId, kind: "user" as const };
    const context = createContextForSession(session);
    const runtime = getAgentRuntime();

    const unscoped = await runtime.describe("aiSdk", { actor, context });
    const inScope = await runtime.describe("aiSdk", {
      actor,
      context,
      scope: { tags: ["devices"] },
    });
    const outOfScope = await runtime.describe("aiSdk", {
      actor,
      context,
      scope: { tags: ["billing"] },
    });

    expect(unscoped.length).toBeGreaterThan(0);
    expect(inScope.map((d) => d.id).sort()).toEqual(unscoped.map((d) => d.id).sort());
    expect(outOfScope).toEqual([]);
  });

  it("returns MODEL_NOT_CONFIGURED in demo mode instead of pretending", async () => {
    vi.stubEnv("MODEL_PROVIDER", "demo");
    const response = await handleChatStep(request(stepBody()));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MODEL_NOT_CONFIGURED");
  });
});
