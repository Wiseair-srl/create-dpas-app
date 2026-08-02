import { create } from "zustand";
import {
  NO_STEP_USAGE,
  sumStepUsage,
  type StepUsage,
  type WireModelMessage,
} from "@/agent/host/protocol";
import { newConversationId } from "@/agent/host/identity";
import { sanitizeModelText } from "./sanitize";

/**
 * The chat's message model, shared by live mode and the guided demo. This is
 * UI state for the experience layer — it is NOT application state (device
 * data lives in React Query) and NOT the model's context (the transport keeps
 * canonical ModelMessages separately in `modelMessages`).
 */

export type ChatEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "reasoning";
      id: string;
      text: string;
      /**
       * Wall-clock start. Absent on a block restored from storage — that one
       * was never observed live, so its duration is unknowable rather than
       * zero, and it is certainly not still running.
       */
      startedAt?: number;
      /** Set once the block is closed; absent while it is still streaming. */
      durationMs?: number;
    }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      wireName: string;
      canonicalId: string;
      plane: "view" | "domain";
      executor: "browser" | "server";
      input: unknown;
      status: "running" | "ok" | "error";
      result?: unknown;
    }
  | { kind: "note"; id: string; tone: "demo" | "info" | "error"; text: string };

export type AssistantMode = "idle" | "live" | "demo";

/**
 * Tokens spent, as reported by the provider. `reportedSteps` is 0 until
 * something is actually measured — the counter stays hidden rather than
 * showing a zero nobody measured, which is what the guided demo (no model at
 * all) and a provider that omits usage would otherwise look like.
 *
 * The protocol's shape, not a copy of it: these figures arrive on the wire,
 * get summed by the same function the server sums them with, and go back to
 * the server to be persisted. A parallel definition here is a place for the
 * browser's counter and the stored one to quietly disagree.
 */
export type TokenUsage = StepUsage;

const NO_USAGE: TokenUsage = NO_STEP_USAGE;

interface MessageStoreState {
  /** Doubles as the Mastra thread id — the rail and the protocol agree on it. */
  conversationId: string;
  entries: ChatEntry[];
  /** Canonical model-message history for the host protocol (live mode). */
  modelMessages: WireModelMessage[];
  /** The model the user picked in the composer; a preference, not authority. */
  modelId: string;
  running: AssistantMode;
  /** Tokens across every turn of this conversation. */
  usage: TokenUsage;
  /** Tokens for the turn in progress, or the last one to run. */
  turnUsage: TokenUsage;
  appendUser: (text: string) => void;
  appendAssistantText: (delta: string) => void;
  appendReasoning: (delta: string) => void;
  /** Close the current assistant text bubble so the next delta starts a new one. */
  sealAssistantText: () => void;
  appendNote: (tone: "demo" | "info" | "error", text: string) => void;
  upsertToolCall: (entry: {
    toolCallId: string;
    wireName: string;
    canonicalId: string;
    plane: "view" | "domain";
    executor: "browser" | "server";
    input: unknown;
  }) => void;
  settleToolCall: (toolCallId: string, ok: boolean, result: unknown) => void;
  setRunning: (mode: AssistantMode) => void;
  setModelMessages: (messages: WireModelMessage[]) => void;
  setModelId: (modelId: string) => void;
  /**
   * Switch to an existing thread from the rail. Both halves are replaced
   * together — the rendered entries AND the canonical history the protocol
   * re-posts — because a mismatch between them is how a reloaded thread ends
   * up answering with context the user cannot see.
   */
  loadThread: (thread: {
    conversationId: string;
    entries: ChatEntry[];
    modelMessages: WireModelMessage[];
    /**
     * What the thread has cost, as persisted server-side. Absent when it never
     * measured anything, which is not the same as zero — see `TokenUsage`.
     */
    usage?: TokenUsage;
  }) => void;
  /**
   * Drop everything from `entryId` onward, that entry included, and cut the
   * canonical history to match — a re-sent question must not carry context the
   * user can no longer see. Returns the dropped question's text, or null when
   * `entryId` isn't a user entry: the wire history is only alignable at user
   * turns, where one user entry is exactly one `role: "user"` message.
   *
   * Backs edit-and-resend and regenerate (experience/runtime-adapter.tsx).
   */
  rewindToUserEntry: (entryId: string) => string | null;
  /** Start an empty thread on a fresh conversation id. */
  newThread: () => void;
  /** Zero the per-turn counter. The conversation total keeps accumulating. */
  beginTurnUsage: () => void;
  /** Add one step-request's usage to the turn and the conversation. */
  addUsage: (usage: TokenUsage) => void;
  reset: () => void;
}

let entryCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++entryCounter}`;

/** Where the nth (0-based) user turn starts on the wire; the end when there
 *  are fewer than n+1 of them. */
function nthUserMessage(messages: WireModelMessage[], n: number): number {
  let seen = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== "user") continue;
    if (seen === n) return i;
    seen++;
  }
  return messages.length;
}

/**
 * Close an open reasoning block. A thinking block ends when ANYTHING else
 * arrives — the first token of the answer, a tool call, a note — or when the
 * turn stops. Stamping the duration here is what lets the UI collapse it from
 * "Thinking…" to "Thought for 8s"; an unstamped block is still running.
 */
function sealReasoning(entries: ChatEntry[]): ChatEntry[] {
  const last = entries.at(-1);
  if (last?.kind !== "reasoning" || last.startedAt === undefined) return entries;
  if (last.durationMs !== undefined) return entries;
  return [
    ...entries.slice(0, -1),
    { ...last, durationMs: Math.max(0, Date.now() - last.startedAt) },
  ];
}

export const useMessageStore = create<MessageStoreState>((set, get) => ({
  conversationId: newConversationId(),
  entries: [],
  modelMessages: [],
  modelId: "",
  running: "idle",
  usage: NO_USAGE,
  turnUsage: NO_USAGE,
  appendUser: (text) =>
    set((s) => ({ entries: [...s.entries, { kind: "user", id: nextId("u"), text }] })),
  appendAssistantText: (delta) =>
    set((s) => {
      // Models sometimes leak their channel markers into visible text; strip
      // them here so the transcript shows the answer, not the plumbing.
      const clean = sanitizeModelText(delta);
      if (clean.length === 0) return s;
      const last = s.entries.at(-1);
      if (last?.kind === "assistant") {
        return {
          entries: [...s.entries.slice(0, -1), { ...last, text: last.text + clean }],
        };
      }
      return {
        entries: [
          ...sealReasoning(s.entries),
          { kind: "assistant", id: nextId("a"), text: clean.trimStart() },
        ],
      };
    }),
  appendReasoning: (delta) =>
    set((s) => {
      const clean = sanitizeModelText(delta);
      if (clean.length === 0) return s;
      const last = s.entries.at(-1);
      // Only an OPEN block absorbs the delta; a sealed one belongs to an
      // earlier thinking pass and must not be reopened.
      if (last?.kind === "reasoning" && last.startedAt !== undefined && last.durationMs === undefined) {
        return {
          entries: [...s.entries.slice(0, -1), { ...last, text: last.text + clean }],
        };
      }
      return {
        entries: [
          ...s.entries,
          { kind: "reasoning", id: nextId("r"), text: clean.trimStart(), startedAt: Date.now() },
        ],
      };
    }),
  sealAssistantText: () =>
    set((s) => {
      // Appending a zero-width boundary entry is unnecessary — text bubbles
      // only merge into a trailing assistant entry, so any non-assistant
      // entry (tool call, note) already seals it. This is a no-op kept for
      // call-site clarity in the transport.
      return s;
    }),
  appendNote: (tone, text) =>
    set((s) => ({
      entries: [...sealReasoning(s.entries), { kind: "note", id: nextId("n"), tone, text }],
    })),
  upsertToolCall: (call) =>
    set((s) => {
      const existing = s.entries.find(
        (e) => e.kind === "tool" && e.toolCallId === call.toolCallId,
      );
      if (existing) return s;
      return {
        entries: [
          ...sealReasoning(s.entries),
          { kind: "tool", id: nextId("t"), status: "running", ...call },
        ],
      };
    }),
  settleToolCall: (toolCallId, ok, result) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.kind === "tool" && entry.toolCallId === toolCallId
          ? { ...entry, status: ok ? "ok" : "error", result }
          : entry,
      ),
    })),
  setRunning: (mode) =>
    // A turn that ends mid-thought still closes the block, or it would sit on
    // "Thinking…" for the life of the conversation.
    set((s) => (mode === "idle" ? { running: mode, entries: sealReasoning(s.entries) } : { running: mode })),
  setModelMessages: (messages) => set({ modelMessages: messages }),
  setModelId: (modelId) => set({ modelId }),
  loadThread: ({ conversationId, entries, modelMessages, usage }) =>
    set({
      conversationId,
      entries,
      modelMessages,
      running: "idle",
      // Usage counters are per-conversation, so the previous thread's total
      // must not carry over — but this thread's own does. It comes back from
      // storage rather than resetting: those tokens were spent on THIS
      // conversation, and a total that empties every time the rail is touched
      // is as wrong as one that inherits a number nobody spent here.
      usage: usage ?? NO_USAGE,
      // The per-turn scope does NOT come back. A restored thread has no turn
      // in progress and no last turn this browser watched run, so the meter
      // shows only the conversation rather than inventing a turn for it.
      turnUsage: NO_USAGE,
    }),
  rewindToUserEntry: (entryId) => {
    const { entries, modelMessages } = get();
    const index = entries.findIndex((entry) => entry.id === entryId);
    const target = entries[index];
    if (!target || target.kind !== "user") return null;
    const turn = entries.slice(0, index).filter((entry) => entry.kind === "user").length;
    set({
      entries: entries.slice(0, index),
      modelMessages: modelMessages.slice(0, nthUserMessage(modelMessages, turn)),
    });
    return target.text;
  },
  newThread: () =>
    set({
      conversationId: newConversationId(),
      entries: [],
      modelMessages: [],
      running: "idle",
      usage: NO_USAGE,
      turnUsage: NO_USAGE,
    }),
  beginTurnUsage: () => set({ turnUsage: NO_USAGE }),
  addUsage: (usage) =>
    set((s) => ({
      usage: sumStepUsage(s.usage, usage),
      turnUsage: sumStepUsage(s.turnUsage, usage),
    })),
  reset: () =>
    set({
      conversationId: newConversationId(),
      entries: [],
      modelMessages: [],
      running: "idle",
      usage: NO_USAGE,
      turnUsage: NO_USAGE,
    }),
}));
