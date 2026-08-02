import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StepUsage } from "../../app/agent/host/protocol";

/**
 * Token counts are the one thing in a thread that cannot be re-derived from
 * its transcript: reopen a thread whose usage was never written and the number
 * is gone for good. So what matters here is that the store accumulates the
 * same way the browser's counter does — one step-request at a time — and that
 * "nothing was reported" survives as absence rather than becoming a zero
 * somebody could mistake for a measurement.
 */

const USER = "demo@example.com";

const spend = (usage: Partial<StepUsage>): StepUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reportedSteps: 1,
  ...usage,
});

let dir: string;
let store: typeof import("./thread-store");

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "dpas-threads-"));
  process.env.DPAS_DATA_DIR = dir;
  // The file is cached on globalThis, so a fresh directory is not enough to
  // isolate one test from the next.
  delete (globalThis as Record<string, unknown>).__dpasThreads;
  store = await import("./thread-store");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DPAS_DATA_DIR;
  delete (globalThis as Record<string, unknown>).__dpasThreads;
});

function openThread(usage?: StepUsage) {
  store.persistStep({
    threadId: "t1",
    resourceId: USER,
    stepIndex: 0,
    inputMessages: [{ role: "user", content: "what did we spend?" }],
    responseMessages: [{ role: "assistant", content: "checking" }],
    ...(usage ? { usage } : {}),
  });
}

describe("thread usage", () => {
  it("accumulates across the step-requests of a thread", () => {
    openThread(spend({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }));
    store.persistStep({
      threadId: "t1",
      resourceId: USER,
      stepIndex: 1,
      inputMessages: [],
      responseMessages: [{ role: "assistant", content: "done" }],
      usage: spend({ inputTokens: 300, outputTokens: 40, totalTokens: 340 }),
    });

    const thread = store.getThread(USER, "t1");
    expect(thread?.usage?.totalTokens).toBe(460);
    expect(thread?.usage?.reportedSteps).toBe(2);
  });

  it("leaves usage absent when the provider reported none", () => {
    openThread();
    expect(store.getThread(USER, "t1")).toBeDefined();
    expect(store.getThread(USER, "t1")?.usage).toBeUndefined();
  });

  it("keeps an unreported subset absent instead of zeroing it", () => {
    openThread(spend({ inputTokens: 100, cachedInputTokens: 40 }));
    store.persistStep({
      threadId: "t1",
      resourceId: USER,
      stepIndex: 1,
      inputMessages: [],
      responseMessages: [],
      usage: spend({ inputTokens: 100 }),
    });

    const usage = store.getThread(USER, "t1")?.usage;
    expect(usage?.cachedInputTokens).toBe(40);
    expect(usage).not.toHaveProperty("reasoningTokens");
  });

  it("records what a step-request cost even when it produced no messages", () => {
    openThread(spend({ totalTokens: 120 }));
    // A run that timed out or errored spent those tokens too, and a total that
    // skips the expensive failures is worse than no total.
    store.persistStep({
      threadId: "t1",
      resourceId: USER,
      stepIndex: 1,
      inputMessages: [],
      responseMessages: [],
      usage: spend({ totalTokens: 500 }),
    });

    expect(store.getThread(USER, "t1")?.usage?.totalTokens).toBe(620);
  });

  it("survives a reload from disk", async () => {
    openThread(spend({ totalTokens: 777, reportedSteps: 2 }));

    delete (globalThis as Record<string, unknown>).__dpasThreads;
    const reloaded = await import("./thread-store");

    expect(reloaded.getThread(USER, "t1")?.usage?.totalTokens).toBe(777);
    expect(reloaded.listThreads(USER)[0]?.usage?.reportedSteps).toBe(2);
  });

  it("does not hand a thread's total to another user", () => {
    openThread(spend({ totalTokens: 777 }));
    expect(store.getThread("someone@else.com", "t1")).toBeUndefined();
    expect(store.listThreads("someone@else.com")).toEqual([]);
  });
});
