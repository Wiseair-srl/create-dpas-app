import { beforeEach, describe, expect, it } from "vitest";
import { inspector } from "@/agent/inspector/inspector-store";
import { buildConversationReport } from "./conversation-report";
import { useMessageStore } from "./message-store";

/**
 * The report exists to make a bug reproducible from a paste. What matters is
 * that the things a screenshot cannot carry survive: the canonical id actually
 * called, the input, the error code, and the catalog mode it happened under.
 */

beforeEach(() => {
  useMessageStore.getState().reset();
  inspector.push({ lane: "host", type: "reset", status: "info", summary: "test reset" });
});

function failedToolCall() {
  const store = useMessageStore.getState();
  store.appendUser("disable the offline devices in Milan");
  store.upsertToolCall({
    toolCallId: "call_1",
    wireName: "surface_act",
    canonicalId: "domain:devices.disable",
    plane: "domain",
    executor: "browser",
    input: { capabilityId: "domain:devices.disable", input: {} },
  });
  useMessageStore.getState().settleToolCall("call_1", false, {
    error: {
      code: "CAPABILITY_NOT_FOUND",
      message: "This capability does not exist in the current surface.",
      retry: "after-refresh",
    },
  });
}

describe("conversation report", () => {
  it("leads with the failure rather than burying it in the transcript", () => {
    failedToolCall();
    const report = buildConversationReport();

    const failuresAt = report.indexOf("## Failures");
    const conversationAt = report.indexOf("## Conversation");
    expect(failuresAt).toBeGreaterThan(-1);
    expect(failuresAt).toBeLessThan(conversationAt);
    expect(report).toContain("CAPABILITY_NOT_FOUND");
  });

  it("records the canonical id, not just the tool that was called", () => {
    failedToolCall();
    const report = buildConversationReport();

    // Under meta mode the tool is `surface_act`; the operation is what it was
    // pointed at, and a report naming only the former is useless.
    expect(report).toContain("domain:devices.disable");
    expect(report).toContain("surface_act");
  });

  it("carries the context needed to reproduce", () => {
    failedToolCall();
    const report = buildConversationReport();

    expect(report).toContain("Catalog mode");
    expect(report).toContain("Protocol");
    expect(report).toContain("Scope");
    expect(report).toMatch(/Entries \| \d+ \(1 tool calls, 1 failed\)/);
  });

  it("includes tool inputs and results", () => {
    failedToolCall();
    const report = buildConversationReport();
    expect(report).toContain('"capabilityId": "domain:devices.disable"');
    expect(report).toContain("after-refresh");
  });

  it("omits the failures section when nothing failed", () => {
    const store = useMessageStore.getState();
    store.appendUser("hello");
    store.appendAssistantText("hi");
    expect(buildConversationReport()).not.toContain("## Failures");
  });

  it("truncates a huge value instead of emitting an unpasteable wall", () => {
    const store = useMessageStore.getState();
    store.upsertToolCall({
      toolCallId: "call_big",
      wireName: "view_devices__table__readState",
      canonicalId: "view:devices.table.readState",
      plane: "view",
      executor: "browser",
      input: {},
    });
    useMessageStore.getState().settleToolCall("call_big", true, { blob: "x".repeat(5_000) });

    const report = buildConversationReport();
    expect(report).toContain("truncated");
    expect(report.length).toBeLessThan(5_000);
  });

  it("survives a value that cannot be serialized", () => {
    const store = useMessageStore.getState();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    store.upsertToolCall({
      toolCallId: "call_cycle",
      wireName: "view_devices__filters__set",
      canonicalId: "view:devices.filters.set",
      plane: "view",
      executor: "browser",
      input: cyclic,
    });

    expect(() => buildConversationReport()).not.toThrow();
    expect(buildConversationReport()).toContain("[unserializable]");
  });
});
