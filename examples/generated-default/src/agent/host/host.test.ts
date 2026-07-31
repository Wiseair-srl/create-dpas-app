import { describe, expect, it } from "vitest";
import type { AgentSurfaceSnapshot, AgentToolset } from "@agent-surface/core";
import { buildFrontendToolDescriptors, findCatalogCollisions } from "./catalog";
import { dispatchFrontendToolCall } from "./client-dispatch";
import { frontendResultToModelValue, missingToolResult } from "./errors";
import {
  ChatStepRequestSchema,
  createFrameDecoder,
  encodeFrame,
  type ChatStepFrame,
} from "./protocol";
import { domainToolName, encodeWireName } from "./wire-names";

describe("wire names", () => {
  it("encodes both planes through one convention", () => {
    expect(encodeWireName("view:devices.table.selectRows")).toBe(
      "view_devices__table__selectRows",
    );
    expect(domainToolName("devices.list")).toBe("domain_devices__list");
  });

  it("keeps every encoded name inside the 64-character wire limit", () => {
    const long = domainToolName(
      "devices.reallyLongComponentName.withDeeplyNestedPath.andAnotherSegment.selectAllRows",
    );
    expect(long.length).toBeLessThanOrEqual(64);
  });
});

/**
 * D30: a shortened wire name is not reversible by string surgery, and the
 * canonical id is the audit identity — so the projection reads the toolset's
 * authoritative map and withholds anything absent from it.
 */
describe("catalog projection", () => {
  const emptySnapshot = {
    components: [],
    procedures: [],
  } as unknown as AgentSurfaceSnapshot;

  const toolsetWith = (
    tools: Array<{ name: string }>,
    wireNames: Record<string, string>,
  ): AgentToolset =>
    ({
      tools: () =>
        tools.map((t) => ({
          ...t,
          description: "d",
          inputSchema: {},
          // Volatile half lives here, never in `description` (D28).
          state: { available: true },
        })),
      wireNameMap: () => new Map(Object.entries(wireNames)),
    }) as unknown as AgentToolset;

  it("takes canonical ids from the map, not from the wire name", () => {
    const { descriptors, undecodable } = buildFrontendToolDescriptors(
      toolsetWith([{ name: "view_devices__table__selectRows_0_abc123" }], {
        view_devices__table__selectRows_0_abc123: "view:devices.table.selectAllTheVisibleRows",
      }),
      emptySnapshot,
    );

    expect(undecodable).toEqual([]);
    expect(descriptors[0]?.canonicalId).toBe("view:devices.table.selectAllTheVisibleRows");
  });

  it("withholds a tool whose wire name does not map, rather than guessing", () => {
    const { descriptors, undecodable } = buildFrontendToolDescriptors(
      toolsetWith([{ name: "view_devices__table__unmapped" }], {}),
      emptySnapshot,
    );

    expect(descriptors).toEqual([]);
    expect(undecodable).toEqual(["view_devices__table__unmapped"]);
  });
});

describe("duplicate-path detection", () => {
  it("flags a domain operation exposed both directly and contextually", () => {
    const collisions = findCatalogCollisions(
      [{ canonicalId: "domain:devices.disable" }, { canonicalId: "view:devices.filters.set" }],
      ["domain:devices.list", "domain:devices.disable"],
    );
    expect(collisions).toEqual(["domain:devices.disable"]);
  });

  // The shipped configuration is checked against the real registry and a
  // mounted surface in `catalog-guards.test.tsx`; this covers the predicate.
  it("passes disjoint planes", () => {
    expect(
      findCatalogCollisions(
        [{ canonicalId: "domain:devices.disable" }],
        ["domain:devices.list", "domain:devices.get"],
      ),
    ).toEqual([]);
  });
});

describe("protocol", () => {
  const validRequest = {
    protocolVersion: 1,
    conversationId: "cnv_1",
    turnId: "trn_1",
    stepIndex: 0,
    messages: [{ role: "user", content: "hello" }],
    frontendTools: [],
  };

  it("accepts a valid step request", () => {
    expect(ChatStepRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("rejects unknown protocol versions and malformed messages", () => {
    expect(
      ChatStepRequestSchema.safeParse({ ...validRequest, protocolVersion: 2 }).success,
    ).toBe(false);
    expect(
      ChatStepRequestSchema.safeParse({
        ...validRequest,
        messages: [{ role: "wizard", content: "hi" }],
      }).success,
    ).toBe(false);
  });

  it("decodes NDJSON frames across arbitrary chunk boundaries", () => {
    const frames: ChatStepFrame[] = [
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
      {
        type: "tool-call",
        toolCallId: "t1",
        wireName: "view_devices__filters__set",
        canonicalId: "view:devices.filters.set",
        executor: "browser",
        input: { status: "offline" },
      },
    ];
    const wire = frames.map(encodeFrame).join("");
    const received: ChatStepFrame[] = [];
    const decoder = createFrameDecoder((frame) => received.push(frame));
    // Feed byte-by-byte to prove boundary independence.
    for (const char of wire) decoder.push(char);
    expect(received).toEqual(frames);
  });

  it("surfaces malformed frames as typed protocol errors", () => {
    const received: ChatStepFrame[] = [];
    const decoder = createFrameDecoder((frame) => received.push(frame));
    decoder.push("{not json}\n");
    expect(received).toEqual([
      {
        type: "error",
        error: { code: "PROTOCOL_DECODE_ERROR", message: "Malformed frame received." },
      },
    ]);
  });
});

describe("result envelopes", () => {
  it("returns outputs on success and typed payloads on error — never throws", () => {
    expect(
      frontendResultToModelValue({
        status: "ok",
        invocationId: "i",
        capabilityId: "c",
        output: { selectedIds: ["a"] },
        surfaceVersion: "1",
      }),
    ).toEqual({ ok: true, value: { selectedIds: ["a"] } });

    expect(
      frontendResultToModelValue({
        status: "ok",
        invocationId: "i",
        capabilityId: "c",
        surfaceVersion: "1",
      }),
    ).toEqual({ ok: true, value: { done: true } });

    const error = frontendResultToModelValue({
      status: "error",
      invocationId: "i",
      capabilityId: "c",
      error: { code: "CAPABILITY_NOT_AVAILABLE", message: "m", retry: "after-refresh" },
      surfaceVersion: "1",
    });
    expect(error.ok).toBe(false);
    expect(error.value).toMatchObject({ error: { code: "CAPABILITY_NOT_AVAILABLE" } });
  });

  it("shapes missing-tool results with an after-refresh hint", () => {
    expect(missingToolResult("view_gone").value).toMatchObject({
      error: { code: "CAPABILITY_NOT_FOUND", retry: "after-refresh" },
    });
  });
});

describe("frontend dispatch · a throwing tool cannot take down the turn", () => {
  const toolsetWith = (execute: () => Promise<unknown>): AgentToolset =>
    ({
      tools: () => [{ name: "view_boom", execute }],
      wireNameMap: () => new Map([["view_boom", "view:boom"]]),
    }) as unknown as AgentToolset;

  const context = { conversationId: "c1", turnId: "t1" };
  const call = { toolCallId: "call_1", wireName: "view_boom", input: {} };

  it("returns a typed result when the tool rejects", async () => {
    // The contract is that failures come back as results. When something
    // below it breaks that — a library defect, a dev probe throwing out of
    // invoke() — the turn must survive it. Before this, the rejection escaped
    // runTurn as an unhandled rejection and killed the whole run.
    const toolset = toolsetWith(() =>
      Promise.reject(new TypeError("Cannot read properties of undefined (reading 'length')")),
    );

    const result = await dispatchFrontendToolCall(toolset, call, context);

    expect(result.ok).toBe(false);
    expect(result.value).toMatchObject({ error: { code: "EXECUTION_FAILED", retry: "no" } });
  });

  it("keeps returning results for the calls after the one that threw", async () => {
    let calls = 0;
    const toolset = toolsetWith(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ status: "ok", output: { done: true } });
    });

    expect((await dispatchFrontendToolCall(toolset, call, context)).ok).toBe(false);
    expect((await dispatchFrontendToolCall(toolset, call, context)).ok).toBe(true);
  });
});
