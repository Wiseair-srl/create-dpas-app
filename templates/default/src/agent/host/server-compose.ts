import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import { toAISDKTools } from "@orpc-agent/ai-sdk";
import { getAgentRuntime } from "@/server/agent/runtime";
import { createContextForSession } from "@/server/orpc/context";
import { getAuditLog, type AuditEntry } from "@/server/audit/log";
import { resolveSession } from "@/server/auth/session";
import { buildAssistantAgent, RUN_LIMITS } from "@/agent/runtime/mastra";
import {
  ChatStepRequestSchema,
  encodeFrame,
  type ChatStepFrame,
  type DomainToolInfo,
  type WireModelMessage,
} from "./protocol";
import { findCatalogCollisions } from "./catalog";
import { canonicalIdFromWireName, domainToolName } from "./wire-names";
import { newStepId } from "./identity";

/**
 * The server half of the Agent Host (ADR-0002): per-request catalog
 * composition, duplicate-path rejection, Mastra invocation, and the mapping
 * from Mastra's chunk stream to versioned protocol frames.
 *
 * Composition boundary (DPAS §13): domain tools are built PER REQUEST against
 * the authenticated actor — never cached across users. Frontend declarations
 * grant model visibility only; their executors stay in the browser.
 */

export async function handleChatStep(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = ChatStepRequestSchema.safeParse(body);
  if (!parsed.success) {
    const isVersionIssue =
      body && typeof body === "object" && "protocolVersion" in body
        ? (body as { protocolVersion?: unknown }).protocolVersion !== 1
        : false;
    return errorResponse(
      isVersionIssue ? 409 : 400,
      isVersionIssue ? "PROTOCOL_VERSION_MISMATCH" : "PROTOCOL_DECODE_ERROR",
      isVersionIssue
        ? "The browser and server speak different host protocol versions. Reload the page."
        : "Malformed chat step request.",
    );
  }
  const step = parsed.data;

  const session = resolveSession(request.headers.get("cookie"));
  const context = createContextForSession(session);

  const agent = buildAssistantAgent();
  if (!agent) {
    return errorResponse(
      503,
      "MODEL_NOT_CONFIGURED",
      "No model provider is configured. Run the guided demo, or set MODEL_PROVIDER and an API key in .env.",
    );
  }

  // Domain half of the catalog: governed, per-actor, deny-by-default.
  const domainTools = await toAISDKTools(getAgentRuntime(), {
    actor: { id: session.userId, kind: "user" },
    context,
    toolNaming: domainToolName,
  });
  const domainInfo: DomainToolInfo[] = Object.entries(domainTools).map(([wireName, t]) => ({
    wireName,
    canonicalId: canonicalIdFromWireName(wireName) ?? wireName,
    description: (t as { description?: string }).description ?? "",
    requiresApproval: false,
  }));

  // Duplicate-path validation: one domain operation, one model-visible path.
  const collisions = findCatalogCollisions(
    step.frontendTools,
    domainInfo.map((info) => info.canonicalId),
  );
  if (collisions.length > 0) {
    getAuditLog().record({
      source: "host",
      type: "catalog.collision",
      actorId: session.userId,
      data: { capabilityIds: collisions },
    });
    return errorResponse(
      409,
      "CATALOG_COLLISION",
      `Domain operation(s) exposed through two paths: ${collisions.join(", ")}. ` +
        "A capability must be either a direct server tool or a contextual surface reference, never both.",
    );
  }

  // Frontend declarations become execute-less AI SDK tools: the model can
  // call them; execution suspends back to the browser.
  const clientTools: ToolSet = Object.fromEntries(
    step.frontendTools.map((descriptor) => [
      descriptor.wireName,
      tool({
        description: descriptor.description,
        inputSchema: jsonSchema(descriptor.inputSchema as Parameters<typeof jsonSchema>[0]),
      }),
    ]),
  );

  const stepId = newStepId();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (frame: ChatStepFrame) => {
        controller.enqueue(encoder.encode(encodeFrame(frame)));
      };

      // Forward server-side audit activity (orpc-agent governance + domain
      // records) to the browser inspector while this step runs. Single-user
      // demo scope: a shared log, filtered by time of subscription.
      const unsubscribe = getAuditLog().subscribe((entry: AuditEntry) => {
        write({
          type: "inspector",
          lane: entry.source === "domain" ? "domain" : "runtime",
          eventType: entry.type,
          summary: entry.capabilityId ? `${entry.type} · ${entry.capabilityId}` : entry.type,
          correlation: {
            conversationId: step.conversationId,
            turnId: step.turnId,
            stepId,
            ...(entry.correlationId ? { invocationId: entry.correlationId } : {}),
            ...(entry.capabilityId ? { capabilityId: entry.capabilityId } : {}),
          },
          data: entry.data,
        });
      });

      const accumulator = createResponseAccumulator();
      let finishReason = "unknown";

      try {
        write({
          type: "step-start",
          stepId,
          turnId: step.turnId,
          conversationId: step.conversationId,
          domainTools: domainInfo,
        });

        const run = await agent.stream(step.messages as ModelMessage[], {
          toolsets: { domain: domainTools },
          clientTools,
          maxSteps: RUN_LIMITS.maxStepsPerRequest,
        });

        const iterator = run.fullStream[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([
            iterator.next(),
            inactivityTimeout(RUN_LIMITS.modelTimeoutMs),
          ]);
          if (next === "timeout") {
            write({
              type: "error",
              error: {
                code: "MODEL_TIMEOUT",
                message: `The model produced no output for ${RUN_LIMITS.modelTimeoutMs / 1000}s; the run was stopped.`,
              },
            });
            finishReason = "timeout";
            break;
          }
          if (next.done) break;
          const chunk = next.value as { type: string; payload?: Record<string, unknown> };

          switch (chunk.type) {
            case "text-delta": {
              const text = String(chunk.payload?.text ?? "");
              if (text) {
                accumulator.text(text);
                write({ type: "text-delta", text });
              }
              break;
            }
            case "tool-call": {
              const toolCallId = String(chunk.payload?.toolCallId ?? "");
              const wireName = String(chunk.payload?.toolName ?? "");
              const input = chunk.payload?.args ?? {};
              const executor = wireName in clientTools ? "browser" : "server";
              accumulator.toolCall(toolCallId, wireName, input, executor);
              write({
                type: "tool-call",
                toolCallId,
                wireName,
                canonicalId: canonicalIdFromWireName(wireName) ?? wireName,
                executor,
                input,
              });
              break;
            }
            case "tool-result": {
              const toolCallId = String(chunk.payload?.toolCallId ?? "");
              const wireName = String(chunk.payload?.toolName ?? "");
              const result = chunk.payload?.result;
              accumulator.toolResult(toolCallId, wireName, result);
              write({
                type: "tool-result",
                toolCallId,
                wireName,
                canonicalId: canonicalIdFromWireName(wireName) ?? wireName,
                ok: !isErrorShaped(result),
                result,
              });
              break;
            }
            case "step-finish":
            case "finish": {
              const stepResult = chunk.payload?.stepResult as { reason?: string } | undefined;
              if (stepResult?.reason) finishReason = stepResult.reason;
              accumulator.flush();
              break;
            }
            case "error": {
              const payload = chunk.payload as { error?: unknown } | undefined;
              write({
                type: "error",
                error: {
                  code: "MODEL_ERROR",
                  message: sanitizeModelError(payload?.error),
                },
              });
              finishReason = "error";
              break;
            }
            default:
              break;
          }
          if (finishReason === "timeout" || finishReason === "error") break;
        }
      } catch (error) {
        write({
          type: "error",
          error: {
            code: "MODEL_ERROR",
            message: sanitizeModelError(error),
          },
        });
      } finally {
        accumulator.flush();
        write({
          type: "step-finish",
          stepId,
          finishReason,
          responseMessages: accumulator.messages(),
          pendingToolCalls: accumulator.pendingBrowserCalls().map((call) => ({
            toolCallId: call.toolCallId,
            wireName: call.wireName,
            canonicalId: canonicalIdFromWireName(call.wireName) ?? call.wireName,
            input: call.input,
          })),
        });
        unsubscribe();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-dpas-protocol-version": "1",
    },
  });
}

// ---------------------------------------------------------------------------

interface AccumulatedToolCall {
  toolCallId: string;
  wireName: string;
  input: unknown;
  executor: "server" | "browser";
  resolved: boolean;
}

/**
 * Rebuilds the ModelMessages a run produced so the stateless browser can
 * carry the full conversation into the next step.
 */
function createResponseAccumulator() {
  const messages: WireModelMessage[] = [];
  const calls: AccumulatedToolCall[] = [];
  let currentText = "";
  let currentCalls: AccumulatedToolCall[] = [];

  const flush = () => {
    if (currentText.length === 0 && currentCalls.length === 0) return;
    messages.push({
      role: "assistant",
      content: [
        ...(currentText.length > 0 ? [{ type: "text", text: currentText }] : []),
        ...currentCalls.map((call) => ({
          type: "tool-call",
          toolCallId: call.toolCallId,
          toolName: call.wireName,
          input: call.input,
        })),
      ],
    });
    currentText = "";
    currentCalls = [];
  };

  return {
    text(delta: string) {
      currentText += delta;
    },
    toolCall(toolCallId: string, wireName: string, input: unknown, executor: "server" | "browser") {
      const call: AccumulatedToolCall = { toolCallId, wireName, input, executor, resolved: false };
      calls.push(call);
      currentCalls.push(call);
    },
    toolResult(toolCallId: string, wireName: string, result: unknown) {
      flush();
      const call = calls.find((c) => c.toolCallId === toolCallId);
      if (call) call.resolved = true;
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: wireName,
            output: { type: "json", value: result ?? null },
          },
        ],
      });
    },
    flush,
    messages() {
      return messages;
    },
    pendingBrowserCalls() {
      return calls.filter((call) => call.executor === "browser" && !call.resolved);
    },
  };
}

function inactivityTimeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

function isErrorShaped(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  if ("status" in result && (result as { status?: unknown }).status === "error") return true;
  return "error" in result && (result as { error?: unknown }).error !== undefined;
}

/** Models and providers can leak internals in errors; keep the public face terse. */
function sanitizeModelError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  if (typeof error === "string") return error.slice(0, 300);
  return "The model call failed.";
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
