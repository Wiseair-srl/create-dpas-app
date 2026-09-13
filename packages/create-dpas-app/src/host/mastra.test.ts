import { expect, it, vi } from "vitest";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { createMastraDomainTools, stopOnHostSuspension } from "./mastra.js";
import { createMemoryHostCallStore, type DomainOutcome } from "./domain.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const descriptor = {
  id: "invoice.pay",
  description: "Pay invoice",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  contractDigest: "v1",
  toolNames: { aiSdk: "pay_invoice" },
};
function setup(pending = false) {
  const completed: DomainOutcome = {
    status: "completed",
    executionId: "exec",
    output: { paid: true },
  };
  let outcome: DomainOutcome = pending
    ? { status: "approval-required", executionId: "exec", approval: { id: "approval" } }
    : completed;
  const client = {
    invoke: vi.fn(async () => outcome),
    getInvocation: vi.fn(async () => ({ outcome })),
    resumeApproval: vi.fn(async () => {
      outcome = completed;
      return completed;
    }),
  };
  const store = createMemoryHostCallStore();
  const options = { client, store, sessionId: "user", runId: "run", descriptors: [descriptor] };
  return { client, store, tools: createMastraDomainTools(options), options };
}
function model() {
  let calls = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      return {
        content:
          calls === 1
            ? [
                {
                  type: "tool-call",
                  toolCallId: "tool",
                  toolName: "pay_invoice",
                  input: '{"id":"1"}',
                },
              ]
            : [{ type: "text", text: "Done" }],
        finishReason: { unified: calls === 1 ? "tool-calls" : "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
    doStream: async () => {
      calls += 1;
      const first = calls === 1;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            if (first)
              controller.enqueue({
                type: "tool-call",
                toolCallId: "tool",
                toolName: "pay_invoice",
                input: '{"id":"1"}',
              });
            else {
              controller.enqueue({ type: "text-start", id: "text" });
              controller.enqueue({ type: "text-delta", id: "text", delta: "Done" });
              controller.enqueue({ type: "text-end", id: "text" });
            }
            controller.enqueue({
              type: "finish",
              finishReason: { unified: first ? "tool-calls" : "stop", raw: undefined },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  });
}

it("executes published-shape remote capabilities through real AI SDK 6", async () => {
  const { tools, client } = setup();
  const response = await generateText({
    model: model(),
    tools,
    prompt: "Pay",
    stopWhen: stepCountIs(3),
  });
  expect(response.text).toBe("Done");
  expect(client.invoke).toHaveBeenCalledTimes(1);
});

it("stops the AI SDK 6 loop on backend approval", async () => {
  const { tools, client } = setup(true);
  const scripted = model();
  const response = await generateText({
    model: scripted,
    tools,
    prompt: "Pay",
    stopWhen: [stepCountIs(3), stopOnHostSuspension],
  });
  expect(response.steps).toHaveLength(1);
  expect(client.resumeApproval).not.toHaveBeenCalled();
});

it("suspends and resumes the original tool with native Mastra 1.53", async () => {
  const { tools, client, options } = setup(true);
  const scripted = model();
  const agent = new Agent({
    id: "test-agent",
    name: "Test",
    instructions: "Use tools.",
    model: scripted,
  });
  const storage = new InMemoryStore();
  new Mastra({ agents: { agent }, storage });
  const first = await agent.stream("Pay invoice", {
    runId: "run",
    toolsets: { domain: tools },
    maxSteps: 3,
  });
  await first.consumeStream();
  const state = await first.getFullOutput();
  expect(state.finishReason).toBe("suspended");
  expect(client.invoke).toHaveBeenCalledTimes(1);
  expect(client.resumeApproval).not.toHaveBeenCalled();
  const refreshedClient = {
    ...client,
    getInvocation: vi.fn(client.getInvocation.getMockImplementation()!),
    resumeApproval: vi.fn(client.resumeApproval.getMockImplementation()!),
  };
  client.getInvocation.mockRejectedValue(new Error("expired original credentials"));
  client.resumeApproval.mockRejectedValue(new Error("expired original credentials"));
  const replacement = new Agent({
    id: "test-agent",
    name: "Test",
    instructions: "Use tools.",
    model: scripted,
  });
  new Mastra({ agents: { agent: replacement }, storage });
  const resumed = await replacement.resumeStream(
    { continue: true },
    {
      runId: "run",
      toolCallId: "tool",
      toolsets: { domain: createMastraDomainTools({ ...options, client: refreshedClient }) },
      maxSteps: 3,
    },
  );
  await resumed.consumeStream();
  expect(await resumed.text).toBe("Done");
  expect(refreshedClient.resumeApproval).toHaveBeenCalledTimes(1);
  expect(client.resumeApproval).not.toHaveBeenCalled();
  expect(client.invoke).toHaveBeenCalledTimes(1);
});

it("withholds contextual declarations and rejects duplicate paths", () => {
  const { options } = setup();
  expect(
    Object.keys(
      createMastraDomainTools({
        ...options,
        descriptors: [{ ...descriptor, discovery: "contextual" }],
      }),
    ),
  ).toEqual([]);
  expect(() =>
    createMastraDomainTools({ ...options, descriptors: [descriptor, descriptor] }),
  ).toThrow("unique");
});

it("fresh agents isolate successive users while sharing Mastra storage", async () => {
  const storage = new InMemoryStore();
  const executions: string[] = [];
  for (const sessionId of ["user-a", "user-b"]) {
    const { options } = setup();
    const client = {
      ...options.client,
      invoke: vi.fn(async () => {
        executions.push(sessionId);
        return {
          status: "completed" as const,
          executionId: sessionId,
          output: { owner: sessionId },
        };
      }),
    };
    const agent = new Agent({
      id: "shared-agent-id",
      name: "Test",
      instructions: "Use tools.",
      model: model(),
    });
    new Mastra({ agents: { agent }, storage });
    const result = await agent.stream("Pay", {
      runId: `run-${sessionId}`,
      toolsets: {
        domain: createMastraDomainTools({
          ...options,
          client,
          sessionId,
          runId: `run-${sessionId}`,
        }),
      },
      maxSteps: 3,
    });
    await result.consumeStream();
    expect(await result.text).toBe("Done");
    expect(client.invoke).toHaveBeenCalledTimes(1);
  }
  expect(executions).toEqual(["user-a", "user-b"]);
});
