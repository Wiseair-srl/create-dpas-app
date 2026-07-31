import { describe, expect, it } from "vitest";
import { createLoopGuard, LOOP_LIMITS } from "./loop-guard";
import { toolResultMessage, unexecutedResults } from "./transport-client";

/**
 * The guard exists for the run that produced it: a model whose output
 * degenerated mid-turn, calling `surface_act` with a different malformed
 * payload each time. Nothing repeated, so identity-keyed counting never fired
 * and the run only ended when the user pressed stop.
 */

const fail = (canonicalId: string, input: unknown = {}, retry?: string) => ({
  canonicalId,
  input,
  ok: false,
  result: { error: { code: "INVALID_INPUT", message: "no", ...(retry ? { retry } : {}) } },
});

const pass = (canonicalId: string, input: unknown = {}) => ({
  canonicalId,
  input,
  ok: true,
  result: { done: true },
});

describe("loop guard · identical failures", () => {
  it("stops a capability failing on the same arguments", () => {
    const guard = createLoopGuard();
    const call = fail("view:devices.filters.set", { city: "Milan" });

    expect(guard.record(call)).toBeNull();
    expect(guard.record(call)).toBeNull();
    expect(guard.record(call)?.message).toContain("failed identically 3 times");
  });

  it("reads shuffled keys as the same call, not a new attempt", () => {
    const guard = createLoopGuard();

    expect(guard.record(fail("view:x", { a: 1, b: 2 }))).toBeNull();
    expect(guard.record(fail("view:x", { b: 2, a: 1 }))).toBeNull();
    expect(guard.record(fail("view:x", { a: 1, b: 2 }))).not.toBeNull();
  });

  it("does not forget an identical failure just because something else worked", () => {
    // Progress resets "everything is failing". It does not make a call that
    // failed three times on the same arguments worth a fourth.
    const guard = createLoopGuard();
    const call = fail("view:x", { a: 1 });

    guard.record(call);
    guard.record(pass("view:other"));
    guard.record(call);
    expect(guard.record(call)?.message).toContain("failed identically 3 times");
  });
});

describe("loop guard · consecutive failures", () => {
  it("stops varied garbage that never repeats itself", () => {
    // The screenshot case. Every call is different, so the identical counter
    // sits at 1 forever.
    const guard = createLoopGuard();

    expect(guard.record(fail("view:a", { x: 1 }))).toBeNull();
    expect(guard.record(fail("view:b", { y: 2 }))).toBeNull();
    expect(guard.record(fail("meta:surface_act", {}))).toBeNull();
    expect(guard.record(fail("view:c", { z: 3 }))?.message).toContain(
      `${LOOP_LIMITS.maxConsecutiveFailures} tool calls failed in a row`,
    );
  });

  it("lets a turn that is making progress keep failing occasionally", () => {
    const guard = createLoopGuard();

    for (let i = 0; i < 10; i++) {
      expect(guard.record(fail("view:a", { attempt: i }))).toBeNull();
      expect(guard.record(pass("view:b"))).toBeNull();
    }
  });
});

describe("loop guard · retry: no", () => {
  it("stops the second call of something that refused a retry", () => {
    // Two calls, not three: "no" is the strongest hint the protocol has, and
    // the instructions already tell the model to respect it.
    const guard = createLoopGuard();
    const call = fail("view:devices.drawer.open", { deviceId: "d-1" }, "no");

    expect(guard.record(call)).toBeNull();
    expect(guard.record(call)?.message).toContain('after answering "retry: no"');
  });

  it("still allows the same capability with different arguments", () => {
    const guard = createLoopGuard();

    expect(guard.record(fail("view:x", { id: "a" }, "no"))).toBeNull();
    expect(guard.record(fail("view:x", { id: "b" }, "no"))).toBeNull();
  });

  it("leaves a with-changes hint on the ordinary identical path", () => {
    const guard = createLoopGuard();
    const call = fail("view:x", { a: 1 }, "with-changes");

    expect(guard.record(call)).toBeNull();
    expect(guard.record(call)).toBeNull();
    expect(guard.record(call)?.message).toContain("failed identically");
  });
});

describe("stopping a turn · history stays well-formed", () => {
  const pending = [
    { toolCallId: "call_1", wireName: "view_a", canonicalId: "view:a", input: {} },
    { toolCallId: "call_2", wireName: "view_b", canonicalId: "view:b", input: {} },
    { toolCallId: "call_3", wireName: "view_c", canonicalId: "view:c", input: {} },
  ];

  it("answers every call the turn will not run", () => {
    // A guard that trips on call 2 leaves calls 2..N unanswered unless this
    // fills them in. The next turn replays this history; an assistant
    // tool-call with no matching tool-result is rejected by the provider
    // before the model ever sees the new user message.
    const answered = unexecutedResults(pending.slice(1));

    expect(answered).toHaveLength(2);
    expect(answered.map((m) => m.role)).toEqual(["tool", "tool"]);
    expect(answered[0]!.content).toMatchObject([
      {
        type: "tool-result",
        toolCallId: "call_2",
        toolName: "view_b",
        output: { type: "json", value: { error: { code: "TOOL_NOT_EXECUTED", retry: "yes" } } },
      },
    ]);
  });

  it("pairs one result to one call, executed or not", () => {
    const executed = pending.slice(0, 1).map((call) => toolResultMessage(call, { done: true }));
    const rest = unexecutedResults(pending.slice(1));

    const ids = [...executed, ...rest].flatMap((message) =>
      (message.content as Array<{ toolCallId: string }>).map((part) => part.toolCallId),
    );
    expect(ids).toEqual(pending.map((call) => call.toolCallId));
  });

  it("never reports an unrun call as done", () => {
    const value = (unexecutedResults(pending)[0]!.content as Array<{ output: { value: unknown } }>)[0]!
      .output.value;
    expect(value).not.toMatchObject({ done: true });
    expect(value).toMatchObject({ error: { code: "TOOL_NOT_EXECUTED" } });
  });
});
