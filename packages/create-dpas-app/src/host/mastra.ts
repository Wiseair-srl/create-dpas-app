import { jsonSchema, tool, type ToolSet } from "ai";
import {
  createDomainHost,
  type DomainOutcome,
  type HostCallStore,
  type RemoteDomainClient,
} from "./domain.js";

/** Portable @orpc-agent descriptor subset; discovery must be actor-scoped. */
export interface HostCapabilityDescriptor {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  contractDigest: string;
  discovery?: "discoverable" | "contextual";
  toolNames: { aiSdk: string };
}

/**
 * AI SDK 5/6 tools accepted by Mastra's agent.stream(..., { toolsets }).
 * Mastra owns model execution, memory and recovery; the host owns durable call
 * correlations and the backend remains the sole domain policy authority.
 * With Mastra1.53, reconstruct the Agent (same ID/shared storage) on resume:
 * same-instance resume can retain the original tool executor/auth closure.
 */
export function createMastraDomainTools<Outcome extends DomainOutcome>(options: {
  descriptors: readonly HostCapabilityDescriptor[];
  client: RemoteDomainClient<Outcome>;
  store: HostCallStore<Outcome>;
  sessionId: string;
  runId: string;
  /** Canonical IDs already presented contextually through a browser binding. */
  contextualCapabilityIds?: readonly string[];
  /** Best-effort receipt observer. Failures cannot change an outcome or bypass suspension. */
  onOutcome?: (event: {
    capabilityId: string;
    toolCallId: string;
    outcome: DomainOutcome;
  }) => void | Promise<void>;
}): ToolSet {
  const host = createDomainHost(options);
  const contextual = new Set(options.contextualCapabilityIds ?? []);
  const entries = options.descriptors.filter(
    (descriptor) => descriptor.discovery !== "contextual" && !contextual.has(descriptor.id),
  );
  const tools: ToolSet = Object.create(null) as ToolSet;
  const ids = new Set<string>();
  for (const descriptor of entries) {
    const name = descriptor.toolNames.aiSdk;
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(name) ||
      Object.hasOwn(tools, name) ||
      ids.has(descriptor.id)
    ) {
      throw new TypeError(
        "Capability tool names and canonical IDs must be unique and provider-compatible.",
      );
    }
    ids.add(descriptor.id);
    tools[name] = tool<unknown, DomainOutcome>({
      description: descriptor.description,
      inputSchema: jsonSchema<unknown>(descriptor.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input, execution) => {
        let outcome = await host.invoke({
          sessionId: options.sessionId,
          runId: options.runId,
          toolCallId: execution.toolCallId,
          capabilityId: descriptor.id,
          input,
          contractDigest: descriptor.contractDigest,
          ...(execution.abortSignal ? { signal: execution.abortSignal } : {}),
        });
        // Mastra passes these extensions to AI SDK-compatible executors (1.53).
        const context = execution as typeof execution & {
          suspend?: (payload: unknown) => Promise<unknown>;
          resumeData?: unknown;
        };
        if (context.resumeData !== undefined && outcome.status === "approval-required") {
          outcome =
            (await host.resumeApproval(
              {
                sessionId: options.sessionId,
                runId: options.runId,
                toolCallId: execution.toolCallId,
              },
              execution.abortSignal,
            )) ?? outcome;
        }
        try {
          await options.onOutcome?.({
            capabilityId: descriptor.id,
            toolCallId: execution.toolCallId,
            outcome,
          });
        } catch {
          // The backend receipt remains authoritative. An observer failure must
          // not invite a duplicate effect or skip a required native suspension.
        }
        if (
          (outcome.status === "approval-required" || outcome.status === "outcome-unknown") &&
          context.suspend
        ) {
          await context.suspend({
            type: "dpas-domain-wait",
            toolCallId: execution.toolCallId,
            capabilityId: descriptor.id,
            outcome,
          });
        }
        return outcome;
      },
    });
  }
  return tools;
}

/** AI SDK-only consumers must pass this as stopWhen; Mastra uses native suspend. */
export function stopOnHostSuspension({
  steps,
}: {
  steps: readonly { toolResults: readonly { output: unknown }[] }[];
}): boolean {
  return steps.some((step) =>
    step.toolResults.some(({ output }) => {
      if (!output || typeof output !== "object" || !("status" in output)) return false;
      return output.status === "approval-required" || output.status === "outcome-unknown";
    }),
  );
}

export { createMastraClientTools, type HostClientToolDescriptor } from "./client-tools.js";
