import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
      return {
        id: entry.id,
        role: "assistant",
        content: [{ type: "text", text: entry.text }],
        metadata: { custom: { entry } },
      };
    case "reasoning":
      // A real `reasoning` part, not text: assistant-ui then routes it to the
      // Reasoning component instead of the prose renderer, which is what lets
      // the thread fold it away. The store already merges consecutive deltas
      // into one entry, so one message is exactly one thinking block.
      return {
        id: entry.id,
        role: "assistant",
        content: [{ type: "reasoning", text: entry.text }],
        metadata: { custom: { entry } },
      };
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
            // The CANONICAL id, not the wire name: that is the audit identity,
            // it is what the tool pill and the result renderers key on, and it
            // survives the shortening/hashing the wire encoding may apply.
            toolName: entry.canonicalId,
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

/** The entry right after `parentId` — the head of the thread when it's null. */
function entryAfter(entries: ChatEntry[], parentId: string | null): ChatEntry | undefined {
  if (parentId === null) return entries[0];
  const index = entries.findIndex((entry) => entry.id === parentId);
  return index === -1 ? undefined : entries[index + 1];
}

/**
 * The question that produced `parentId`, walking back past the thinking blocks
 * and tool pills that sit between a question and its answer — each of those is
 * its own message here, so an answer's parent is rarely the user's message.
 */
function questionBehind(entries: ChatEntry[], parentId: string | null): ChatEntry | undefined {
  const from = parentId === null ? entries.length - 1 : entries.findIndex((e) => e.id === parentId);
  for (let i = from; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.kind === "user") return entry;
  }
  return undefined;
}

export function useDpasAssistantRuntime(options: { liveEnabled: boolean }) {
  const entries = useMessageStore((state) => state.entries);
  const running = useMessageStore((state) => state.running);
  const queryClient = useQueryClient();

  /**
   * The reconciliation the turn calls after a server-plane write. One line, and
   * deliberately the SAME line the invoice mutations already run on settle
   * (`features/invoices/hooks.ts`), the surface subscription runs after a
   * browser-plane capability (`agent/surface/wiring.tsx`), and the approval
   * decision runs after a gated write executes (`tool-ui.tsx`): the agent
   * writes through the same data layer as every human path and gets no
   * narrower refresh than a button does.
   */
  const reconcile = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  return useExternalStoreRuntime({
    isRunning: running !== "idle",
    messages: entries,
    convertMessage: convertEntry,
    onNew: async (message: AppendMessage) => {
      if (!options.liveEnabled) return;
      const part = message.content[0];
      if (part?.type !== "text" || part.text.trim().length === 0) return;
      await startLiveTurn(part.text, reconcile);
    },
    // Both of these exist as much for their side effect as for their body:
    // assistant-ui derives `capabilities.edit` and `capabilities.reload` from
    // their presence, and without them the pencil and the regenerate button
    // render as controls that do nothing.
    //
    // Neither forks. Editing rewinds the thread to the question, drops the
    // answer it produced, and asks again — which is what the thread already
    // claims, having no branch picker to show a second version with.
    onEdit: async (message: AppendMessage) => {
      if (!options.liveEnabled) return;
      const part = message.content[0];
      if (part?.type !== "text" || part.text.trim().length === 0) return;
      // parentId is the message BEFORE the edited one, so the edited question
      // is the entry that follows it.
      const edited = entryAfter(useMessageStore.getState().entries, message.parentId);
      if (!edited || useMessageStore.getState().rewindToUserEntry(edited.id) === null) return;
      await startLiveTurn(part.text, reconcile);
    },
    onReload: async (parentId: string | null) => {
      if (!options.liveEnabled) return;
      const question = questionBehind(useMessageStore.getState().entries, parentId);
      if (!question) return;
      const text = useMessageStore.getState().rewindToUserEntry(question.id);
      if (text === null) return;
      await startLiveTurn(text, reconcile);
    },
    onCancel: async () => {
      cancelActiveTurn();
    },
  });
}
