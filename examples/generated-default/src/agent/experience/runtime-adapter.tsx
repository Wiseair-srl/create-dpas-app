"use client";

import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useMessageStore, type ChatEntry } from "./message-store";
import { cancelActiveTurn, startLiveTurn } from "./turn-controller";

/**
 * assistant-ui adapter. The experience layer consumes a plain message store —
 * swapping assistant-ui for another shell means rewriting THIS file and the
 * thread components, and nothing else (capability providers, host, runtime
 * and demo are untouched).
 */

export function convertEntry(entry: ChatEntry): ThreadMessageLike {
  switch (entry.kind) {
    case "user":
      return { id: entry.id, role: "user", content: [{ type: "text", text: entry.text }] };
    case "assistant":
      return { id: entry.id, role: "assistant", content: [{ type: "text", text: entry.text }] };
    case "note":
      return {
        id: entry.id,
        role: "assistant",
        content: [{ type: "text", text: entry.text }],
        metadata: { custom: { entry } },
      };
    case "tool":
      return {
        id: entry.id,
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: entry.toolCallId,
            toolName: entry.wireName,
            args: (entry.input ?? {}) as Record<string, never>,
            argsText: JSON.stringify(entry.input ?? {}),
            ...(entry.status === "running" ? {} : { result: entry.result ?? null }),
            ...(entry.status === "error" ? { isError: true } : {}),
          },
        ],
        metadata: { custom: { entry } },
      };
  }
}

export function useDpasAssistantRuntime(options: { liveEnabled: boolean }) {
  const entries = useMessageStore((state) => state.entries);
  const running = useMessageStore((state) => state.running);

  return useExternalStoreRuntime({
    isRunning: running !== "idle",
    messages: entries,
    convertMessage: convertEntry,
    onNew: async (message: AppendMessage) => {
      if (!options.liveEnabled) return;
      const part = message.content[0];
      if (part?.type !== "text" || part.text.trim().length === 0) return;
      await startLiveTurn(part.text);
    },
    onCancel: async () => {
      cancelActiveTurn();
    },
  });
}
