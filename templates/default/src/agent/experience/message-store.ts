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

interface MessageStoreState {
  conversationId: string;
  entries: ChatEntry[];
  /** Canonical model-message history for the host protocol (live mode). */
  modelMessages: WireModelMessage[];
  running: AssistantMode;
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
  reset: () => void;
}

let entryCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++entryCounter}`;

export const useMessageStore = create<MessageStoreState>((set) => ({
  conversationId: newConversationId(),
  entries: [],
  modelMessages: [],
  running: "idle",
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
  reset: () =>
    set({
      conversationId: newConversationId(),
      entries: [],
      modelMessages: [],
      running: "idle",
    }),
}));
