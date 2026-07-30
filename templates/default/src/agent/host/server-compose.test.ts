import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatStepFrame, WireModelMessage, WireToolDescriptor } from "./protocol";

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

    const toolCall = frames.find((f) => f.type === "tool-call");
    expect(toolCall).toMatchObject({
      executor: "browser",
      canonicalId: "view:devices.filters.set",
      input: { status: "offline", city: "Milan" },
    });

    const finish = frames.find((f) => f.type === "step-finish");
    expect(finish).toBeDefined();
    if (finish?.type === "step-finish") {
      expect(finish.finishReason).toBe("tool-calls");
      expect(finish.pendingToolCalls).toHaveLength(1);
      expect(finish.pendingToolCalls[0]).toMatchObject({
        wireName: "view_devices__filters__set",
      });
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

  it("rejects a duplicate model-visible path for one domain operation", async () => {
    const contextualList: WireToolDescriptor = {
      ...filtersTool,
      wireName: "domain_devices__list",
      canonicalId: "domain:devices.list",
      plane: "domain",
    };
    const response = await handleChatStep(
      request(stepBody({ frontendTools: [contextualList] })),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CATALOG_COLLISION");
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

  it("returns MODEL_NOT_CONFIGURED in demo mode instead of pretending", async () => {
    vi.stubEnv("MODEL_PROVIDER", "demo");
    const response = await handleChatStep(request(stepBody()));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MODEL_NOT_CONFIGURED");
  });
});
