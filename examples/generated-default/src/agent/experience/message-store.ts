"use client";

import { create } from "zustand";
import type { WireModelMessage } from "@/agent/host/protocol";
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
  | { kind: "reasoning"; id: string; text: string }
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
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Subset of `inputTokens` — served from the provider's prompt cache. */
  cachedInputTokens?: number;
  /** Subset of `outputTokens` — spent thinking rather than answering. */
  reasoningTokens?: number;
  reportedSteps: number;
}

const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reportedSteps: 0,
};

interface MessageStoreState {
  conversationId: string;
  entries: ChatEntry[];
  /** Canonical model-message history for the host protocol (live mode). */
  modelMessages: WireModelMessage[];
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
  /** Zero the per-turn counter. The conversation total keeps accumulating. */
  beginTurnUsage: () => void;
  /** Add one step-request's usage to the turn and the conversation. */
  addUsage: (usage: TokenUsage) => void;
  reset: () => void;
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    // The optional subsets stay absent unless a step reported them; a silent
    // step must not turn a reported figure into a zero.
    ...spread("cachedInputTokens", addOptional(a.cachedInputTokens, b.cachedInputTokens)),
    ...spread("reasoningTokens", addOptional(a.reasoningTokens, b.reasoningTokens)),
    reportedSteps: a.reportedSteps + b.reportedSteps,
  };
}

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + b;
}

function spread(key: string, value: number | undefined) {
  return value === undefined ? {} : { [key]: value };
}

let entryCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++entryCounter}`;

export const useMessageStore = create<MessageStoreState>((set) => ({
  conversationId: newConversationId(),
  entries: [],
  modelMessages: [],
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
        entries: [...s.entries, { kind: "assistant", id: nextId("a"), text: clean.trimStart() }],
      };
    }),
  appendReasoning: (delta) =>
    set((s) => {
      const clean = sanitizeModelText(delta);
      if (clean.length === 0) return s;
      const last = s.entries.at(-1);
      if (last?.kind === "reasoning") {
        return {
          entries: [...s.entries.slice(0, -1), { ...last, text: last.text + clean }],
        };
      }
      return {
        entries: [...s.entries, { kind: "reasoning", id: nextId("r"), text: clean.trimStart() }],
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
    set((s) => ({ entries: [...s.entries, { kind: "note", id: nextId("n"), tone, text }] })),
  upsertToolCall: (call) =>
    set((s) => {
      const existing = s.entries.find(
        (e) => e.kind === "tool" && e.toolCallId === call.toolCallId,
      );
      if (existing) return s;
      return {
        entries: [
          ...s.entries,
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
  setRunning: (mode) => set({ running: mode }),
  setModelMessages: (messages) => set({ modelMessages: messages }),
  beginTurnUsage: () => set({ turnUsage: NO_USAGE }),
  addUsage: (usage) =>
    set((s) => ({
      usage: sumUsage(s.usage, usage),
      turnUsage: sumUsage(s.turnUsage, usage),
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
