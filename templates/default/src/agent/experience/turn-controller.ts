"use client";

import { getSurfaceRegistry } from "@/agent/surface/registry";
import { getHostToolset } from "@/agent/host/toolset";
import { newTurnId } from "@/agent/host/identity";
import { runTurn } from "@/agent/host/transport-client";
import { inspector, type CatalogRow } from "@/agent/inspector/inspector-store";
import { useMessageStore } from "./message-store";

/**
 * Live mode glue: one user message → one host-protocol turn, with the
 * message store as the render target. Cancellation aborts the fetch; the
 * browser-side dispatch loop stops at the next boundary.
 */

let activeAbort: AbortController | null = null;

export function cancelActiveTurn() {
  activeAbort?.abort();
}

export async function startLiveTurn(text: string): Promise<void> {
  const store = useMessageStore.getState();
  if (store.running !== "idle") return;

  const abort = new AbortController();
  activeAbort = abort;
  const turnId = newTurnId();

  store.appendUser(text);
  store.setRunning("live");

  const history = [
    ...store.modelMessages,
    { role: "user" as const, content: text },
  ];

  inspector.push({
    lane: "experience",
    type: "turn-started",
    status: "info",
    summary: `turn started · live`,
    correlation: { conversationId: store.conversationId, turnId },
  });

  try {
    const outcome = await runTurn({
      conversationId: store.conversationId,
      turnId,
      messages: history,
      registry: getSurfaceRegistry(),
      toolset: getHostToolset(),
      signal: abort.signal,
      events: {
        onTextDelta: (delta) => useMessageStore.getState().appendAssistantText(delta),
        onToolCall: (call) =>
          useMessageStore.getState().upsertToolCall({
            toolCallId: call.toolCallId,
            wireName: call.wireName,
            canonicalId: call.canonicalId,
            plane: call.canonicalId.startsWith("domain:") ? "domain" : "view",
            executor: call.executor,
            input: call.input,
          }),
        onToolResult: (result) =>
          useMessageStore.getState().settleToolCall(result.toolCallId, result.ok, result.result),
        onDomainCatalog: (tools) => {
          inspector.setDomainCatalog(
            tools.map(
              (tool): CatalogRow => ({
                canonicalId: tool.canonicalId,
                plane: "domain",
                kind: "direct-tool",
                description: tool.description,
                effect: "server-query",
                executor: "server",
                available: true,
                confirmation: tool.requiresApproval ? "required" : "never",
              }),
            ),
          );
        },
        onAssistantMessageBoundary: () => useMessageStore.getState().sealAssistantText(),
        onError: (error) =>
          useMessageStore
            .getState()
            .appendNote("error", `${error.message} (${error.code})`),
      },
    });

    useMessageStore.getState().setModelMessages(outcome.messages);
    inspector.push({
      lane: "experience",
      type: "turn-finished",
      status: outcome.status === "completed" ? "ok" : outcome.status === "error" ? "error" : "info",
      summary: `turn ${outcome.status}`,
      correlation: { conversationId: store.conversationId, turnId },
    });
    if (outcome.status === "cancelled") {
      useMessageStore.getState().appendNote("info", "Run cancelled.");
    }
  } finally {
    if (activeAbort === abort) activeAbort = null;
    useMessageStore.getState().setRunning("idle");
  }
}
