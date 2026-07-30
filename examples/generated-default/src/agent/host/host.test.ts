import { describe, expect, it } from "vitest";
import { findCatalogCollisions } from "./catalog";
import { frontendResultToModelValue, missingToolResult } from "./errors";
import {
  ChatStepRequestSchema,
  createFrameDecoder,
  encodeFrame,
  type ChatStepFrame,
} from "./protocol";
import { canonicalIdFromWireName, domainToolName, encodeWireName } from "./wire-names";

describe("wire names", () => {
  it("round-trips both planes through one convention", () => {
    expect(encodeWireName("view:devices.table.selectRows")).toBe(
      "view_devices__table__selectRows",
    );
    expect(domainToolName("devices.list")).toBe("domain_devices__list");
    expect(canonicalIdFromWireName("view_devices__table__selectRows")).toBe(
      "view:devices.table.selectRows",
    );
    expect(canonicalIdFromWireName("domain_devices__list")).toBe("domain:devices.list");
  });

  it("strips multi-instance suffixes before decoding", () => {
    expect(canonicalIdFromWireName("view_devices__table__selectRows_at_main")).toBe(
      "view:devices.table.selectRows",
    );
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

  it("accepts the shipped configuration (no collisions)", () => {
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
