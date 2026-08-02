import { beforeEach, describe, expect, it } from "vitest";

import { useMessageStore, type ChatEntry, type TokenUsage } from "./message-store";
import { entriesFromModelMessages } from "./rehydrate";

/**
 * A reasoning block has three states and the UI reads all three off the same
 * two fields, so they are worth pinning down:
 *
 *   streaming  — startedAt set, durationMs absent      → "Thinking…"
 *   sealed     — both set                              → "Thought for Ns"
 *   restored   — neither set (came back from storage)  → "Thought about this"
 *
 * The failure this guards is a restored block being mistaken for a live one,
 * which pulses "Thinking…" forever on every reloaded thread.
 */

const reasoning = (entries: ChatEntry[]) =>
  entries.filter((e): e is Extract<ChatEntry, { kind: "reasoning" }> => e.kind === "reasoning");

describe("reasoning blocks", () => {
  beforeEach(() => useMessageStore.getState().newThread());

  it("stays open while deltas arrive, merging them into one block", () => {
    const store = useMessageStore.getState();
    store.appendReasoning("Let me check ");
    store.appendReasoning("the filters.");

    const blocks = reasoning(useMessageStore.getState().entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("Let me check the filters.");
    expect(blocks[0]!.startedAt).toBeTypeOf("number");
    expect(blocks[0]!.durationMs).toBeUndefined();
  });

  it("seals when the answer starts", () => {
    const store = useMessageStore.getState();
    store.appendReasoning("The user wants outflows only.");
    store.appendAssistantText("Here is the answer.");

    expect(reasoning(useMessageStore.getState().entries)[0]!.durationMs).toBeTypeOf("number");
  });

  it("seals when a tool call starts", () => {
    const store = useMessageStore.getState();
    store.appendReasoning("The user wants outflows only.");
    store.upsertToolCall({
      toolCallId: "t1",
      wireName: "view_x__read",
      canonicalId: "view:x.read",
      plane: "view",
      executor: "browser",
      input: {},
    });

    expect(reasoning(useMessageStore.getState().entries)[0]!.durationMs).toBeTypeOf("number");
  });

  it("seals a turn that ends mid-thought", () => {
    const store = useMessageStore.getState();
    store.setRunning("live");
    store.appendReasoning("The user wants outflows only.");
    store.setRunning("idle");

    expect(reasoning(useMessageStore.getState().entries)[0]!.durationMs).toBeTypeOf("number");
  });

  it("does not reopen a sealed block", () => {
    const store = useMessageStore.getState();
    store.appendReasoning("First I should read the filters.");
    store.appendAssistantText("partial answer");
    store.appendReasoning("Now I should sort by amount.");

    const blocks = reasoning(useMessageStore.getState().entries);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe("First I should read the filters.");
    expect(blocks[1]!.text).toBe("Now I should sort by amount.");
    expect(blocks[1]!.durationMs).toBeUndefined();
  });

  /**
   * The important one: a thread reloaded from storage has reasoning that
   * genuinely happened but was never timed. It must read as finished.
   */
  it("restores reasoning as finished, not as still running", () => {
    const entries = entriesFromModelMessages([
      { role: "user", content: "why?" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "because of the filters" },
          { type: "text", text: "Because of the filters." },
        ],
      },
    ]);

    const block = reasoning(entries)[0]!;
    expect(block.text).toBe("because of the filters");
    expect(block.startedAt).toBeUndefined();
    expect(block.durationMs).toBeUndefined();
    // The UI reads "streaming" as startedAt set AND durationMs absent, so a
    // restored block is not streaming.
    expect(block.startedAt !== undefined && block.durationMs === undefined).toBe(false);
  });
});

/**
 * Edit-and-resend and regenerate both rewind here first. The failure this
 * guards is the silent one: the visible thread rewinds but the canonical
 * history does not, so the model answers the re-asked question already knowing
 * the answer the user just deleted.
 */
describe("rewinding to a question", () => {
  beforeEach(() => useMessageStore.getState().newThread());

  /** Two complete turns, entries and wire history in step. */
  const twoTurns = () => {
    const store = useMessageStore.getState();
    store.appendUser("first question");
    store.appendReasoning("thinking about the first");
    store.appendAssistantText("first answer");
    store.appendUser("second question");
    store.appendAssistantText("second answer");
    store.setModelMessages([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "second answer" },
    ]);
  };

  it("drops the question, everything it produced, and its history", () => {
    twoTurns();
    const second = useMessageStore.getState().entries.find((e) => e.kind === "user" && e.text === "second question")!;

    expect(useMessageStore.getState().rewindToUserEntry(second.id)).toBe("second question");

    const { entries, modelMessages } = useMessageStore.getState();
    expect(entries.map((e) => e.kind)).toEqual(["user", "reasoning", "assistant"]);
    expect(modelMessages).toHaveLength(2);
    expect(modelMessages.at(-1)).toEqual({ role: "assistant", content: "first answer" });
  });

  it("rewinds to the first question, back to an empty thread", () => {
    twoTurns();
    const first = useMessageStore.getState().entries[0]!;

    expect(useMessageStore.getState().rewindToUserEntry(first.id)).toBe("first question");
    expect(useMessageStore.getState().entries).toEqual([]);
    expect(useMessageStore.getState().modelMessages).toEqual([]);
  });

  it("refuses anything that isn't a question, leaving the thread alone", () => {
    twoTurns();
    const answer = useMessageStore.getState().entries.find((e) => e.kind === "assistant")!;
    const before = useMessageStore.getState().entries;

    expect(useMessageStore.getState().rewindToUserEntry(answer.id)).toBeNull();
    expect(useMessageStore.getState().rewindToUserEntry("nope")).toBeNull();
    expect(useMessageStore.getState().entries).toBe(before);
  });
});

/**
 * The counter is the only thing in a thread that cannot be re-derived from its
 * transcript, so losing it loses it for good. What this pins down is the split:
 * the CONVERSATION total belongs to the thread and comes back with it, the
 * TURN total belongs to a run this browser watched and does not.
 */
describe("token usage", () => {
  beforeEach(() => useMessageStore.getState().newThread());

  const spend = (usage: Partial<TokenUsage>): TokenUsage => ({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reportedSteps: 1,
    ...usage,
  });

  it("sums a step-request into both scopes", () => {
    useMessageStore.getState().beginTurnUsage();
    useMessageStore.getState().addUsage(spend({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }));
    useMessageStore.getState().addUsage(spend({ inputTokens: 300, outputTokens: 40, totalTokens: 340 }));

    const { usage, turnUsage } = useMessageStore.getState();
    expect(usage.totalTokens).toBe(460);
    expect(turnUsage.totalTokens).toBe(460);
    expect(usage.reportedSteps).toBe(2);
  });

  it("zeroes only the turn when the next one begins", () => {
    useMessageStore.getState().addUsage(spend({ totalTokens: 120 }));
    useMessageStore.getState().beginTurnUsage();
    useMessageStore.getState().addUsage(spend({ totalTokens: 80 }));

    expect(useMessageStore.getState().usage.totalTokens).toBe(200);
    expect(useMessageStore.getState().turnUsage.totalTokens).toBe(80);
  });

  it("keeps an unreported subset absent rather than folding it in as zero", () => {
    useMessageStore.getState().addUsage(spend({ inputTokens: 100, cachedInputTokens: 40 }));
    // A provider that says nothing about caching on the second step must not
    // turn the reported 40 into a 40-out-of-a-larger-input claim it never made
    // — but it must not erase it either.
    useMessageStore.getState().addUsage(spend({ inputTokens: 100 }));
    expect(useMessageStore.getState().usage.cachedInputTokens).toBe(40);

    useMessageStore.getState().newThread();
    useMessageStore.getState().addUsage(spend({ inputTokens: 100 }));
    expect(useMessageStore.getState().usage).not.toHaveProperty("cachedInputTokens");
  });

  it("restores the conversation total when a thread is reopened", () => {
    useMessageStore.getState().loadThread({
      conversationId: "thread_1",
      entries: [],
      modelMessages: [],
      usage: spend({ inputTokens: 900, outputTokens: 100, totalTokens: 1000, reportedSteps: 3 }),
    });

    expect(useMessageStore.getState().usage.totalTokens).toBe(1000);
    expect(useMessageStore.getState().usage.reportedSteps).toBe(3);
    // No turn ran in this browser, so there is no last turn to show.
    expect(useMessageStore.getState().turnUsage.reportedSteps).toBe(0);
  });

  it("keeps accumulating onto a restored total", () => {
    useMessageStore.getState().loadThread({
      conversationId: "thread_1",
      entries: [],
      modelMessages: [],
      usage: spend({ totalTokens: 1000, reportedSteps: 3 }),
    });
    useMessageStore.getState().beginTurnUsage();
    useMessageStore.getState().addUsage(spend({ totalTokens: 250 }));

    expect(useMessageStore.getState().usage.totalTokens).toBe(1250);
    expect(useMessageStore.getState().turnUsage.totalTokens).toBe(250);
  });

  it("shows nothing for a thread that never measured anything", () => {
    useMessageStore.getState().addUsage(spend({ totalTokens: 999 }));
    useMessageStore.getState().loadThread({
      conversationId: "thread_2",
      entries: [],
      modelMessages: [],
    });

    // The previous thread's figure must not follow the user across the rail.
    expect(useMessageStore.getState().usage.reportedSteps).toBe(0);
    expect(useMessageStore.getState().usage.totalTokens).toBe(0);
  });
});
