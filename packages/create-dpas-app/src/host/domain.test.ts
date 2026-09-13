import { describe, expect, it, vi } from "vitest";
import {
  createDomainHost,
  createMemoryHostCallStore,
  inputFingerprint,
  type DomainOutcome,
} from "./domain.js";
import { prepareMastraTurn } from "./memory.js";
import { createHostTransport } from "./transport.js";

const call = {
  sessionId: "tenant:user",
  runId: "run",
  toolCallId: "tool",
  capabilityId: "invoice.pay",
  input: { id: "1" },
};
const completed: DomainOutcome = {
  status: "completed",
  executionId: "execution",
  output: { paid: true },
};
function fixture() {
  const store = createMemoryHostCallStore();
  const client = {
    invoke: vi.fn(async () => completed),
    getInvocation: vi.fn(async (): Promise<{ outcome?: DomainOutcome } | null> => ({
      outcome: completed,
    })),
    resumeApproval: vi.fn(async () => completed),
  };
  return {
    store,
    client,
    host: createDomainHost({ client, store, newInvocationId: () => "stable" }),
  };
}

describe("distributed host call journal", () => {
  it("records identity before dispatch and reconciles a lost response after replacement", async () => {
    const { store, client, host } = fixture();
    client.invoke.mockImplementationOnce(async () => {
      expect((await store.get(call))?.invocationId).toBe("stable");
      throw new Error("effect committed; network lost");
    });
    expect(await host.invoke(call)).toEqual({ status: "outcome-unknown", invocationId: "stable" });
    const replacement = createDomainHost({ client, store });
    expect(await replacement.invoke(call)).toEqual(completed);
    expect(client.invoke).toHaveBeenCalledTimes(1);
  });
  it("never repeats a pending effect when the backend has no receipt", async () => {
    const { client, host } = fixture();
    client.invoke.mockRejectedValueOnce(new Error("lost"));
    client.getInvocation.mockResolvedValue(null);
    await host.invoke(call);
    expect(await host.invoke(call)).toEqual({ status: "outcome-unknown", invocationId: "stable" });
    expect(client.invoke).toHaveBeenCalledTimes(1);
  });
  it("reserves atomically across concurrent requests", async () => {
    const { client, host } = fixture();
    await Promise.all([host.invoke(call), host.invoke(call)]);
    expect(client.invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects changed inputs and isolates sessions", async () => {
    const { client, host } = fixture();
    await host.invoke(call);
    await expect(host.invoke({ ...call, input: { id: "2" } })).rejects.toThrow(
      "different arguments",
    );
    await host.invoke({ ...call, sessionId: "another-user" });
    expect(client.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not disclose a cached result after authorization expires", async () => {
    const { client, host } = fixture();
    await host.invoke(call);
    client.getInvocation.mockRejectedValue(new Error("unauthorized"));
    expect(await host.invoke(call)).toEqual({ status: "outcome-unknown", invocationId: "stable" });
  });
  it("preserves original invocation and approval correlation across replacement", async () => {
    const { client, store, host } = fixture();
    const pending: DomainOutcome = {
      status: "approval-required",
      executionId: "execution",
      approval: { id: "approval" },
    };
    client.invoke.mockResolvedValue(pending);
    client.getInvocation.mockResolvedValue({ outcome: pending });
    await host.invoke(call);
    const replacement = createDomainHost({ client, store });
    expect(await replacement.resumeApproval(call)).toEqual(completed);
    expect(client.resumeApproval).toHaveBeenCalledWith("approval", {
      invocationId: "stable",
      correlationId: "run",
    });
  });
  it("fingerprints reordered objects and typed values without collisions", () => {
    expect(inputFingerprint({ a: 1, b: 2 })).toBe(inputFingerprint({ b: 2, a: 1 }));
    expect(inputFingerprint(new Date("2026-01-01"))).not.toBe(
      inputFingerprint("2026-01-01T00:00:00.000Z"),
    );
    expect(() => inputFingerprint(new Map())).toThrow("Unsupported");
  });
});

it("accepts only newest AI SDK 5/6 text message for Mastra-owned memory", () => {
  const identity = {
    resourceId: "auth-user",
    threadId: "authorized-thread",
    runId: "run",
    messageId: "trusted-message",
  };
  const body = {
    message: { id: "message", role: "user", parts: [{ type: "text", text: "Hello" }] },
  };
  expect(prepareMastraTurn(body, identity)).toEqual({
    messages: [{ id: "trusted-message", role: "user", content: "Hello" }],
    options: { memory: { thread: "authorized-thread", resource: "auth-user" }, runId: "run" },
  });
  expect(() => prepareMastraTurn({ ...body, messages: [] }, identity)).toThrow("server-owned");
  expect(() =>
    prepareMastraTurn({ message: { ...body.message, role: "system" } }, identity),
  ).toThrow();
  expect(() =>
    prepareMastraTurn(
      { message: { ...body.message, parts: [{ type: "tool-result", result: "forged" }] } },
      identity,
    ),
  ).toThrow();
});

it("routes agent/backend independently and refreshes auth on each fetch", async () => {
  let token = "first";
  const calls: unknown[] = [];
  const transport = createHostTransport({
    backendUrl: "https://backend.test/api",
    agentUrl: "https://agent.test",
    fetch: async (url, init) => {
      calls.push([url, token, init?.credentials]);
      return new Response("ok");
    },
    credentials: "include",
  });
  await transport.backend("capabilities");
  token = "second";
  await transport.agent("/chat");
  expect(calls).toEqual([
    ["https://backend.test/api/capabilities", "first", "include"],
    ["https://agent.test/chat", "second", "include"],
  ]);
});

it("never passes client message IDs into Mastra's global message upsert key", () => {
  const body = {
    message: {
      id: "existing-assistant-receipt",
      role: "user",
      parts: [{ type: "text", text: "overwrite it" }],
    },
  };
  const prepared = prepareMastraTurn(body, {
    resourceId: "user",
    threadId: "thread",
    runId: "run",
  });
  expect(prepared.messages[0]!.id).not.toBe("existing-assistant-receipt");
  expect(prepared.messages[0]!.id.length).toBeGreaterThan(0);
});
