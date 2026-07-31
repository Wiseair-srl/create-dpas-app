import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The projection reaches the PROMPT, not just the tool block.
 *
 * `direct` and `meta` hand the model completely different tools, so a prompt
 * describing the wrong one is worse than none: under meta the `view_`/`domain_`
 * names it teaches do not exist, and a model hunting for them guesses at
 * `surface_discover({scope})` — where a token outside the route's floor returns
 * an empty surface (AS-META-002) that reads as "this page has nothing".
 *
 * Isolated in its own file because the assertion needs `buildAssistantAgent`
 * wrapped, which would apply to every case in `server-compose.test.ts`.
 */

process.env.DPAS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "dpas-instructions-test-"));

const requestedModes: Array<string | undefined> = [];

vi.mock("@/agent/runtime/mastra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/runtime/mastra")>();
  return {
    ...actual,
    buildAssistantAgent: (mode?: "direct" | "meta") => {
      requestedModes.push(mode);
      return actual.buildAssistantAgent(mode);
    },
  };
});

let handleChatStep: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("MODEL_PROVIDER", "mock");
  ({ handleChatStep } = await import("./server-compose"));
});

function step(mode: "direct" | "meta"): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 2,
      conversationId: "cnv_t",
      turnId: "trn_t",
      stepIndex: 0,
      pathname: "/dashboard",
      messages: [{ role: "user", content: "hello" }],
      catalog: { mode, scope: ["devices"], frontendTools: [] },
    }),
  });
}

describe("chat step · instructions follow the catalog mode", () => {
  it("builds the agent with the mode the step requested", async () => {
    requestedModes.length = 0;

    await handleChatStep(step("meta"));
    expect(requestedModes).toEqual(["meta"]);

    await handleChatStep(step("direct"));
    expect(requestedModes).toEqual(["meta", "direct"]);
  });

  it("serves each mode a prompt describing the tools it actually gets", async () => {
    const { buildAssistantAgent } = await import("@/agent/runtime/mastra");

    const meta = await buildAssistantAgent("meta")!.getInstructions();
    const direct = await buildAssistantAgent("direct")!.getInstructions();

    expect(meta).toContain("surface_discover");
    expect(meta).toContain("with NO arguments");
    expect(meta).not.toContain('Tools prefixed "view_"');

    expect(direct).toContain('"view_"');
    expect(direct).not.toContain("surface_discover");
  });

  it("defaults to direct, so protocol v1 — which has no mode — is unchanged", async () => {
    const { buildAssistantAgent } = await import("@/agent/runtime/mastra");
    const fallback = await buildAssistantAgent()!.getInstructions();

    expect(fallback).toBe(await buildAssistantAgent("direct")!.getInstructions());
  });
});
