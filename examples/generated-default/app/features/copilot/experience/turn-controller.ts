import { getSurfaceRegistry } from "@/agent/surface/registry";
import { currentPathname, getHostToolset } from "@/agent/host/toolset";
import { newTurnId } from "@/agent/host/identity";
import { mutatesData } from "@/agent/host/protocol";
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

/**
 * Refresh whatever the tab is displaying, because a server-plane write landed.
 *
 * Passed in rather than resolved here: this module is glue with no React
 * context, and the query client lives in one. The caller supplies the SAME
 * invalidation the buttons use (`runtime-adapter.tsx`) — if the agent's
 * refresh were finer-grained than a human click's, the two paths would drift
 * and the same operation would end up refreshing different screens.
 */
export type Reconcile = () => void;

export async function startLiveTurn(text: string, reconcile: Reconcile): Promise<void> {
  const store = useMessageStore.getState();
  if (store.running !== "idle") return;

  const abort = new AbortController();
  activeAbort = abort;
  const turnId = newTurnId();
  // Where the turn STARTS. From here on the route is the run's own business:
  // it follows navigation the agent itself performs and ignores navigation the
  // user performs, so the catalog tracks the plan without shifting because
  // somebody clicked the sidebar mid-turn.
  const pathname = currentPathname();
  // Captured with the route: switching model mid-turn would hand the rest of
  // the run to a different model than the one that planned it.
  const modelId = store.modelId;

  store.appendUser(text);
  store.setRunning("live");
  store.beginTurnUsage();

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
      toolsetFor: getHostToolset,
      pathname,
      ...(modelId ? { modelId } : {}),
      signal: abort.signal,
      events: {
        onTextDelta: (delta) => useMessageStore.getState().appendAssistantText(delta),
        onReasoningDelta: (delta) => useMessageStore.getState().appendReasoning(delta),
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
                // Translated from the capability's own `sideEffect` into the
                // surface's effect vocabulary, so the two planes read the same
                // way in one catalog. This used to be `"server-query"` for
                // every row, which labelled every write a read.
                effect: mutatesData(tool.sideEffect) ? "server-mutation" : "server-query",
                executor: "server",
                available: true,
                confirmation: tool.requiresApproval ? "required" : "never",
              }),
            ),
          );
        },
        // The write happened on the server, inside the model loop; the tab was
        // never told. See `TurnEvents.onDomainMutation` for why this is one of
        // THREE triggers for a single convention, and why none is redundant.
        //
        // Not awaited on purpose: invalidation is asynchronous and the turn has
        // no reason to wait for a refetch before continuing.
        onDomainMutation: reconcile,
        onUsage: (usage) => useMessageStore.getState().addUsage(usage),
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
