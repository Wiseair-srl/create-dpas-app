import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import { toAISDKTools } from "@orpc-agent/ai-sdk";
import { runtime as agentRuntime, actorFor } from "../runtime";
import { contextFor } from "../../capabilities/base";
import { registry } from "../../capabilities/registry";
import { getAuditLog, type AuditEntry } from "./audit-tap";
import type { SessionUser } from "../auth";
import { buildCopilotAgent, RUN_LIMITS } from "../mastra";
import { persistStep } from "./thread-store";
import {
  CATALOG_LIMITS,
  catalogTooLargeMessage,
  ChatStepRequestSchema,
  encodeFrame,
  normalizeChatStep,
  renderCapabilityState,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ChatStepFrame,
  type DomainToolInfo,
  type StepUsage,
  type WireModelMessage,
} from "../../app/agent/host/protocol";
import { findCatalogCollisions } from "../../app/agent/host/catalog";
import { resolveScope } from "../../app/agent/host/scope";
import { canonicalIdOfCall, domainToolName } from "../../app/agent/host/wire-names";
import { newStepId } from "../../app/agent/host/identity";

/**
 * The server half of the Agent Host: per-request catalog
 * composition, duplicate-path rejection, Mastra invocation, and the mapping
 * from Mastra's chunk stream to versioned protocol frames.
 *
 * Composition boundary: domain tools are built PER REQUEST against
 * the authenticated actor — never cached across users. Frontend declarations
 * grant model visibility only; their executors stay in the browser.
 */

export async function handleChatStep(request: Request, user: SessionUser): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = ChatStepRequestSchema.safeParse(body);
  if (!parsed.success) {
    // A request that NAMES an unsupported version is a version mismatch; one
    // that omits the field entirely is simply malformed. Conflating them would
    // tell a browser to reload when the payload is the problem.
    const declaresVersion =
      body !== null && typeof body === "object" && "protocolVersion" in body;
    const claimed = declaresVersion
      ? (body as { protocolVersion?: unknown }).protocolVersion
      : undefined;
    const isVersionIssue =
      declaresVersion &&
      (typeof claimed !== "number" ||
        !(SUPPORTED_PROTOCOL_VERSIONS as readonly number[]).includes(claimed));
    return errorResponse(
      isVersionIssue ? 409 : 400,
      isVersionIssue ? "PROTOCOL_VERSION_MISMATCH" : "PROTOCOL_DECODE_ERROR",
      isVersionIssue
        ? "The browser and server speak different host protocol versions. Reload the page."
        : "Malformed chat step request.",
    );
  }
  const step = normalizeChatStep(parsed.data);

  // Identity is re-derived server-side by the auth middleware and handed in;
  // nothing about it is read from the request body.
  const session = { userId: user.email };
  const context = contextFor(user);
  // Allocated before composition so every host-sourced audit record can name
  // the step it belongs to — which is what lets the inspector subscription
  // below recognise its own entries.
  const stepId = newStepId();

  // The projection the browser asked for shapes the INSTRUCTIONS, not just the
  // tool block: under `meta` the model sees three verbs and must discover its
  // way to a capability, which a direct-mode prompt actively misdescribes.
  const agent = buildCopilotAgent(step.modelId);
  if (!agent) {
    return errorResponse(
      503,
      "MODEL_NOT_CONFIGURED",
      "No model provider is configured. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env and restart.",
    );
  }

  // Domain half of the catalog: governed, per-actor, deny-by-default.
  //
  // Wire names are captured as they are assigned. Reversing them afterwards is
  // not possible — a shortened name decodes to nothing (D30) — and the
  // canonical id is the audit identity, so it is recorded at the only point it
  // is known for certain.
  // Scope is a REQUEST from the browser, intersected with the route's floor
  // on this side. It never widens, and it is discovery shaping only — an
  // out-of-scope capability stays fully invocable by an authorized actor.
  const scope = resolveScope(step.pathname, step.requestedScope);

  const domainCanonicalByWire = new Map<string, string>();
  /**
   * Wire name → declared side effect, read from the registry rather than
   * guessed from the name. Captured HERE for the same reason the canonical id
   * is: this is the one moment where the wire name and the capability it was
   * minted from are both known for certain.
   *
   * A capability the registry cannot resolve defaults to `"write"`, which is
   * the direction the browser's reconciliation wants the doubt to fall in
   * (protocol.ts `mutatesData`).
   */
  const domainSideEffectByWire = new Map<string, string>();
  const domainTools = await toAISDKTools(agentRuntime, {
    actor: actorFor(user),
    context,
    // Forwarded to `describe`, so the discovery policies of everything
    // outside the scope never run — not merely filtered afterwards.
    ...(scope.length > 0 ? { scope: { tags: [...scope] } } : {}),
    toolNaming: (capabilityId) => {
      const wireName = domainToolName(capabilityId);
      domainCanonicalByWire.set(wireName, `domain:${capabilityId}`);
      domainSideEffectByWire.set(wireName, registry.get(capabilityId)?.meta.sideEffect ?? "write");
      return wireName;
    },
  });

  // A capability may override its own tool name through
  // `meta.adapters.aiSdk.toolName`, which the adapter honours ahead of
  // `toolNaming` — so the capture above can miss one. Anything unmapped is
  // withheld rather than offered under a guessed identity — a capability that cannot be audited under its canonical id is not
  // offered at all.
  const undecodableDomain = Object.keys(domainTools).filter(
    (wireName) => !domainCanonicalByWire.has(wireName),
  );
  for (const wireName of undecodableDomain) delete domainTools[wireName];
  if (undecodableDomain.length > 0) {
    getAuditLog().record({
      source: "host",
      type: "catalog.undecodable",
      actorId: session.userId,
      stepId,
      data: { wireNames: undecodableDomain },
    });
  }

  const domainInfo: DomainToolInfo[] = Object.entries(domainTools).flatMap(([wireName, t]) => {
    const canonicalId = domainCanonicalByWire.get(wireName);
    if (!canonicalId) return [];
    return [
      {
        wireName,
        canonicalId,
        description: (t as { description?: string }).description ?? "",
        requiresApproval: false,
        sideEffect: domainSideEffectByWire.get(wireName) ?? "write",
      },
    ];
  });

  // One lookup for both planes. Frontend descriptors already carry their
  // canonical id on the wire, so nothing is reversed here either.
  const frontendCanonicalByWire = new Map(
    step.frontendTools.map((d) => [d.wireName, d.canonicalId] as const),
  );
  const canonicalIdOf = (wireName: string): string =>
    domainCanonicalByWire.get(wireName) ?? frontendCanonicalByWire.get(wireName) ?? wireName;

  /**
   * The audit identity of a CALL. Identical to `canonicalIdOf` in direct mode;
   * in meta mode the model calls `surface_act` and names its target in the
   * arguments, so the tool name would collapse every action in the application
   * into one identity — one operation, one audit identity.
   */
  const canonicalIdOfToolCall = (wireName: string, input: unknown): string =>
    canonicalIdOfCall(wireName, input, canonicalIdOf(wireName)) ?? wireName;

  /** tool-call id → the operation it named, so call and result agree. */
  const canonicalByToolCallId = new Map<string, string>();

  // Duplicate-path validation: one domain operation, one model-visible path.
  //
  // v1 aborted the whole turn on a collision. v2 drops the duplicate FRONTEND
  // declaration and keeps the governed server tool: across a large codebase a
  // double-exposure is a matter of when, and taking down the assistant is a
  // wildly disproportionate blast radius for one misconfigured capability.
  // The surface snapshot check catches it earlier, at build time.
  const collisions = findCatalogCollisions(
    step.frontendTools,
    domainInfo.map((info) => info.canonicalId),
  );
  if (collisions.length > 0) {
    getAuditLog().record({
      source: "host",
      type: "catalog.collision",
      actorId: session.userId,
      stepId,
      data: { capabilityIds: collisions },
    });
    if (step.protocolVersion === 1) {
      return errorResponse(
        409,
        "CATALOG_COLLISION",
        `Domain operation(s) exposed through two paths: ${collisions.join(", ")}. ` +
          "A capability must be either a direct server tool or a contextual surface reference, never both.",
      );
    }
  }
  const collided = new Set(collisions);
  const frontendTools =
    collided.size > 0
      ? step.frontendTools.filter((descriptor) => !collided.has(descriptor.canonicalId))
      : step.frontendTools;

  // Server-side limit enforcement. The browser checks before posting; this is
  // the authority, and it names plane, count and limit rather than reporting
  // a legal-but-large catalog as malformed.
  const totalTools = frontendTools.length + domainInfo.length;
  const overLimit: { plane: "frontend" | "domain" | "total"; count: number; limit: number } | undefined =
    frontendTools.length > CATALOG_LIMITS.maxFrontendTools
      ? {
          plane: "frontend",
          count: frontendTools.length,
          limit: CATALOG_LIMITS.maxFrontendTools,
        }
      : domainInfo.length > CATALOG_LIMITS.maxDomainTools
        ? { plane: "domain", count: domainInfo.length, limit: CATALOG_LIMITS.maxDomainTools }
        : totalTools > CATALOG_LIMITS.maxTotalTools
          ? { plane: "total", count: totalTools, limit: CATALOG_LIMITS.maxTotalTools }
          : undefined;
  if (overLimit) {
    return errorResponse(
      413,
      "CATALOG_TOO_LARGE",
      catalogTooLargeMessage(overLimit.plane, overLimit.count, overLimit.limit),
    );
  }

  // Frontend declarations become execute-less AI SDK tools: the model can
  // call them; execution suspends back to the browser.
  const clientTools: ToolSet = Object.fromEntries(
    frontendTools.map((descriptor) => [
      descriptor.wireName,
      tool({
        description: descriptor.description,
        inputSchema: jsonSchema(descriptor.inputSchema as Parameters<typeof jsonSchema>[0]),
      }),
    ]),
  );

  // Record every domain result as it is produced. When one assistant message
  // calls a server tool AND a client tool, the run suspends for the browser
  // and Mastra drops the server tool's result — it never reaches `fullStream`
  // or `stream.toolResults`, even though the procedure ran. Capturing here
  // lets the host answer that call itself (see settleOrphanedServerCalls);
  // without it the tool-call would go unanswered, which strands the UI card
  // and leaves the model a malformed history.
  const domainResults = new Map<string, ToolExecutionRecord>();
  const recordedDomainTools = withResultCapture(domainTools, domainResults);

  /**
   * Which half of the catalog a wire name belongs to — and `undefined` for a
   * name in NEITHER, which is a tool the model invented. The catalog composed
   * for this step is the whole truth about what exists, so an unrecognised name
   * needs no guess: it has no executor because it has no capability.
   */
  const executorFor = (wireName: string): "server" | "browser" | undefined =>
    wireName in clientTools ? "browser" : wireName in recordedDomainTools ? "server" : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A browser that reloaded or closed mid-step leaves a controller that
      // throws on every enqueue. That throw must not escape: the `finally`
      // below still has to settle orphaned calls, count the tokens and — above
      // all — persist the step, and a write that throws on the way there
      // abandons all three. Losing the answer the user just watched stream in,
      // precisely because they navigated away from it, is the one outcome the
      // persistence is there to prevent. Past the first failure there is
      // nobody left to tell, so the rest of the turn writes into the void.
      let clientGone = false;
      const write = (frame: ChatStepFrame) => {
        if (clientGone) return;
        // Encoded outside the guard: a frame that cannot be encoded is a bug
        // here, not a departed reader, and must not be swallowed as one.
        const bytes = encoder.encode(encodeFrame(frame));
        try {
          controller.enqueue(bytes);
        } catch {
          clientGone = true;
        }
      };

      // Forward server-side audit activity (orpc-agent governance + domain
      // records) to THIS actor's inspector while this step runs.
      //
      // The log is process-wide: concurrent users write to it simultaneously.
      // Forwarding it unfiltered would stream every other user's domain
      // activity into this browser, so an entry is disclosed only when it is
      // positively attributable to this session. An entry carrying no
      // `actorId` is dropped rather than broadcast — the cost is that
      // genuinely actor-less runtime events no longer reach the Inspector,
      // which is the right trade against disclosing another tenant's.
      const isThisActors = (entry: AuditEntry): boolean => {
        if (entry.source === "host") return entry.stepId === stepId;
        return entry.actorId !== undefined && entry.actorId === session.userId;
      };

      const subscription = getAuditLog().subscribe((entry: AuditEntry) => {
        if (!isThisActors(entry)) return;
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
      const usage = createUsageAccumulator();
      let finishReason = "unknown";

      try {
        write({
          type: "step-start",
          stepId,
          turnId: step.turnId,
          conversationId: step.conversationId,
          domainTools: domainInfo,
          scope: [...scope],
        });

        // Everything the host reduced, said out loud.
        if (collisions.length > 0) {
          write({
            type: "inspector",
            lane: "host",
            eventType: "catalog.collision",
            summary: `${collisions.length} duplicate path(s) dropped — kept the governed server tool`,
            correlation: { conversationId: step.conversationId, turnId: step.turnId, stepId },
            data: { capabilityIds: collisions },
          });
        }
        if (step.truncated) {
          write({
            type: "inspector",
            lane: "host",
            eventType: "catalog.truncated",
            summary: `browser dropped ${step.truncated.dropped} tool(s) — ${step.truncated.reason}`,
            correlation: { conversationId: step.conversationId, turnId: step.turnId, stepId },
            data: step.truncated,
          });
        }

        // The volatile half goes AFTER the conversation, never in the tool
        // block. Tool definitions sit at the front of the provider prompt, so
        // folding live state into them would invalidate the cached prefix
        // behind the whole conversation on every step; here it costs a few
        // hundred tokens and invalidates nothing.
        const stateBlock = renderCapabilityState(step.frontendState, frontendTools);
        const modelMessages = (
          stateBlock
            ? [...step.messages, { role: "system", content: stateBlock }]
            : step.messages
        ) as ModelMessage[];

        const run = await agent.stream(modelMessages, {
          toolsets: { domain: recordedDomainTools },
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
            case "reasoning-delta": {
              // Reasoning is shown separately and never fed back to the
              // model, so it stays out of the reconstructed history.
              const text = String(chunk.payload?.text ?? "");
              if (text) write({ type: "reasoning-delta", text });
              break;
            }
            case "tool-call": {
              const toolCallId = String(chunk.payload?.toolCallId ?? "");
              const wireName = String(chunk.payload?.toolName ?? "");
              const input = chunk.payload?.args ?? {};
              const executor = executorFor(wireName);
              // A name in neither plane never existed. It is answered HERE
              // rather than left to the orphan settler, whose answer is "call
              // it again" — right for a real tool the run cut short, and
              // precisely wrong for an invented one, which it invites the
              // model to invent a second time.
              //
              // No `tool-call` frame goes out either: the browser would render
              // a capability card for a capability that does not exist, and
              // `canonicalIdOf` would fall back to the wire name, putting a
              // fabricated id in the audit trail — one operation, one audit identity. The call and
              // its refusal still enter the history, which is what lets the
              // model correct itself instead of repeating the guess.
              if (!executor) {
                const result = noSuchToolResult(wireName);
                accumulator.toolCall(toolCallId, wireName, input, "server");
                accumulator.toolResult(toolCallId, wireName, result);
                write({
                  type: "inspector",
                  lane: "host",
                  eventType: "tool.unknown",
                  summary: `model called "${wireName}" — in neither plane; answered NO_SUCH_TOOL`,
                  correlation: {
                    conversationId: step.conversationId,
                    turnId: step.turnId,
                    stepId,
                  },
                  data: { wireName },
                });
                break;
              }
              accumulator.toolCall(toolCallId, wireName, input, executor);
              // Resolved once, from the arguments, and remembered — the result
              // frame has no input to re-derive it from, and the two frames
              // must name the same operation.
              const canonicalId = canonicalIdOfToolCall(wireName, input);
              canonicalByToolCallId.set(toolCallId, canonicalId);
              write({
                type: "tool-call",
                toolCallId,
                wireName,
                canonicalId,
                executor,
                input,
              });
              break;
            }
            case "tool-result": {
              const toolCallId = String(chunk.payload?.toolCallId ?? "");
              const wireName = String(chunk.payload?.toolName ?? "");
              const result = chunk.payload?.result;
              // A call the host already answered — an invented name, or a
              // `tool-error` that arrived first — must not be answered twice:
              // two tool messages for one call is a history most providers
              // reject outright.
              if (accumulator.isResolved(toolCallId)) break;
              accumulator.toolResult(toolCallId, wireName, result);
              write({
                type: "tool-result",
                toolCallId,
                wireName,
                canonicalId: canonicalByToolCallId.get(toolCallId) ?? canonicalIdOf(wireName),
                ok: !isErrorShaped(result),
                result,
              });
              break;
            }
            // The runtime failed the call itself: a name it rejected before the
            // host saw it, arguments that did not fit the schema, an executor
            // that threw. Previously unhandled, which left the browser card
            // spinning and let the orphan settler report a call that DID run as
            // one that never did.
            case "tool-error": {
              const toolCallId = String(chunk.payload?.toolCallId ?? "");
              const wireName = String(chunk.payload?.toolName ?? "");
              // Nothing to answer when the call never reached the accumulator:
              // the rebuilt assistant message will not contain it either, and a
              // tool result answering no call is the same malformed history in
              // the other direction.
              if (!accumulator.hasCall(toolCallId) || accumulator.isResolved(toolCallId)) break;
              const result = executorFor(wireName)
                ? {
                    error: {
                      code: "TOOL_FAILED",
                      message: sanitizeModelError(chunk.payload?.error),
                    },
                  }
                : noSuchToolResult(wireName);
              accumulator.toolResult(toolCallId, wireName, result);
              write({
                type: "tool-result",
                toolCallId,
                wireName,
                canonicalId: canonicalByToolCallId.get(toolCallId) ?? canonicalIdOf(wireName),
                ok: false,
                result,
              });
              break;
            }
            case "step-finish":
            case "finish": {
              const stepResult = chunk.payload?.stepResult as { reason?: string } | undefined;
              if (stepResult?.reason) finishReason = stepResult.reason;
              if (chunk.type === "finish") usage.finish(chunk.payload);
              else usage.step(chunk.payload);
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
        // Answer any server tool call Mastra left unresolved, so the model
        // never sees a tool-call without a tool-result and the browser card
        // never hangs on "running".
        for (const settled of settleOrphanedServerCalls(accumulator, domainResults)) {
          write({
            type: "tool-result",
            toolCallId: settled.toolCallId,
            wireName: settled.wireName,
            canonicalId:
              canonicalByToolCallId.get(settled.toolCallId) ?? canonicalIdOf(settled.wireName),
            ok: settled.ok,
            result: settled.result,
          });
        }
        // What the request cost. Reported even when it ended at a timeout or
        // an error: those tokens were spent too, and a counter that silently
        // skips the expensive failures is worse than none — everything the host reduced, said out loud.
        const spent = usage.value();
        if (spent) {
          write({
            type: "inspector",
            lane: "runtime",
            eventType: "model.usage",
            summary:
              `${spent.inputTokens} in · ${spent.outputTokens} out` +
              (spent.reasoningTokens !== undefined
                ? ` (${spent.reasoningTokens} reasoning)`
                : "") +
              ` · ${spent.reportedSteps} model step${spent.reportedSteps === 1 ? "" : "s"}`,
            correlation: { conversationId: step.conversationId, turnId: step.turnId, stepId },
            data: spent,
          });
        }
        // Persist BEFORE the frame goes out, so a browser that reloads the
        // thread the instant the turn ends sees what it just watched happen.
        // Never fatal (see thread-store).
        const responseMessages = accumulator.messages();
        persistStep({
          threadId: step.conversationId,
          resourceId: session.userId,
          stepIndex: step.stepIndex,
          inputMessages: step.messages as ModelMessage[],
          responseMessages: responseMessages as ModelMessage[],
          // The same figure the frame below carries. Written here because the
          // browser's copy dies with the tab, and tokens are the one thing in
          // a thread that cannot be re-derived from its transcript.
          ...(spent ? { usage: spent } : {}),
        });

        write({
          type: "step-finish",
          stepId,
          finishReason,
          responseMessages,
          pendingToolCalls: accumulator.pendingBrowserCalls().map((call) => ({
            toolCallId: call.toolCallId,
            wireName: call.wireName,
            canonicalId: canonicalIdOfToolCall(call.wireName, call.input),
            input: call.input,
          })),
          ...(spent ? { usage: spent } : {}),
        });
        // A reader that fell behind had entries dropped rather than buffered.
        // Say so: a gap the Inspector does not know about reads as "nothing
        // happened" — everything the host reduced, said out loud.
        const dropped = subscription.dropped();
        if (dropped > 0) {
          write({
            type: "inspector",
            lane: "host",
            eventType: "inspector.dropped",
            summary: `${dropped} audit entr${dropped === 1 ? "y" : "ies"} dropped — reader fell behind`,
            correlation: { conversationId: step.conversationId, turnId: step.turnId, stepId },
            data: { dropped },
          });
        }
        subscription.close();
        // Same reason as `write`: a controller the disconnect already tore down
        // throws on close, and this is the last statement of the step.
        try {
          controller.close();
        } catch {
          // Already closed by the departing client. Nothing left to close.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Echoes the version this exchange actually used, not the newest the
      // server knows — v1 and v2 are served side by side.
      "x-dpas-protocol-version": String(step.protocolVersion),
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

export type ToolExecutionRecord =
  | { ok: true; result: unknown }
  | { ok: false; result: unknown };

/**
 * Wrap each domain tool so the host keeps the result it produced, keyed by
 * tool-call id. Purely observational: execution, authorization and audit all
 * still happen inside the orpc-agent runtime that `toAISDKTools` built.
 */
export function withResultCapture(
  tools: ToolSet,
  into: Map<string, ToolExecutionRecord>,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (typeof execute !== "function") return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (input: never, options: never) => {
            const toolCallId = (options as { toolCallId?: string } | undefined)?.toolCallId;
            try {
              const result = await execute(input, options);
              if (toolCallId) into.set(toolCallId, { ok: true, result });
              return result;
            } catch (error) {
              if (toolCallId) {
                into.set(toolCallId, {
                  ok: false,
                  result: { error: { code: "EXECUTION_FAILED", message: sanitizeModelError(error) } },
                });
              }
              throw error;
            }
          },
        },
      ];
    }),
  ) as ToolSet;
}

/**
 * The answer to a call naming a tool that does not exist.
 *
 * `retry: "no"` is the load-bearing part. The orphan answer this replaces says
 * "Call it again", which is sound advice about a real tool the run cut short
 * and an instruction to hallucinate twice about one the model made up. The
 * message names the tool list as the authority rather than listing names here:
 * the list is already in the request, and repeating it invites the model to
 * treat the prose as the catalog.
 */
export function noSuchToolResult(wireName: string): {
  error: { code: "NO_SUCH_TOOL"; message: string; retry: "no" };
} {
  return {
    error: {
      code: "NO_SUCH_TOOL",
      message:
        `There is no tool named "${wireName}". The tools defined for this step are the complete ` +
        "set that exists right now — do not guess a name and do not retry this one. If none of " +
        "them does what the user asked, say so plainly.",
      retry: "no",
    },
  };
}

export interface SettledServerCall {
  toolCallId: string;
  wireName: string;
  ok: boolean;
  result: unknown;
}

/**
 * Give every unresolved SERVER tool call an answer, recording it in the
 * message history too. A call with no captured result never ran, which the
 * model is told plainly so it can retry rather than assume success.
 */
export function settleOrphanedServerCalls(
  accumulator: ResponseAccumulator,
  recorded: ReadonlyMap<string, ToolExecutionRecord>,
): SettledServerCall[] {
  const settled: SettledServerCall[] = [];
  for (const call of accumulator.unresolvedServerCalls()) {
    const record = recorded.get(call.toolCallId);
    const outcome: SettledServerCall = record
      ? { toolCallId: call.toolCallId, wireName: call.wireName, ok: record.ok, result: record.result }
      : {
          toolCallId: call.toolCallId,
          wireName: call.wireName,
          ok: false,
          result: {
            error: {
              code: "TOOL_NOT_EXECUTED",
              message: "The run ended before this tool produced a result. Call it again.",
              retry: "yes",
            },
          },
        };
    accumulator.toolResult(outcome.toolCallId, outcome.wireName, outcome.result);
    settled.push(outcome);
  }
  return settled;
}

/**
 * Token usage for one step-request.
 *
 * The runtime reports it twice over: every `step-finish` carries that model
 * step's own tokens, and the closing `finish` carries the run total already
 * summed. Adding both would double every number, so the run total wins when it
 * arrives — and the running sum is what is left to report when it does not,
 * which is exactly the timeout, error and abort cases where the tokens were
 * spent anyway.
 */
export function createUsageAccumulator() {
  const summed: Omit<StepUsage, "reportedSteps"> = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let reportedSteps = 0;
  let runTotal: Omit<StepUsage, "reportedSteps"> | undefined;

  return {
    /** One model step finished; add what it reported. */
    step(payload: unknown) {
      const usage = readUsage(payload);
      if (!usage) return;
      reportedSteps += 1;
      summed.inputTokens += usage.inputTokens;
      summed.outputTokens += usage.outputTokens;
      summed.totalTokens += usage.totalTokens;
      // Optional subsets: a step that reported none must not turn an
      // otherwise-reported figure into a zero, so absent stays absent. Only
      // assigned when there is something to assign — writing `undefined`
      // would create the key, and a present-but-undefined field is a third
      // state nothing downstream is expecting.
      const cached = addOptional(summed.cachedInputTokens, usage.cachedInputTokens);
      if (cached !== undefined) summed.cachedInputTokens = cached;
      const reasoning = addOptional(summed.reasoningTokens, usage.reasoningTokens);
      if (reasoning !== undefined) summed.reasoningTokens = reasoning;
    },
    /** The run finished; its own total supersedes the running sum. */
    finish(payload: unknown) {
      const usage = readUsage(payload);
      if (usage) runTotal = usage;
    },
    /**
     * Undefined when nothing was reported. A provider that stays silent about
     * tokens leaves the counter saying so, rather than showing a zero it never
     * measured — everything the host reduced, said out loud.
     */
    value(): StepUsage | undefined {
      if (runTotal) return { ...runTotal, reportedSteps: Math.max(reportedSteps, 1) };
      return reportedSteps > 0 ? { ...summed, reportedSteps } : undefined;
    },
  };
}

/**
 * Reads token counts out of a finish payload. They live under `output.usage`;
 * `totalUsage` and a bare `usage` are accepted too, so a runtime that fills a
 * different one still counts. A field left undefined reads as 0, but a payload
 * carrying no usable field at all reads as undefined — the distinction between
 * "zero tokens" and "not reported" is the whole point.
 */
function readUsage(payload: unknown): Omit<StepUsage, "reportedSteps"> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = payload as {
    output?: { usage?: unknown };
    totalUsage?: unknown;
    usage?: unknown;
  };
  const usage = source.output?.usage ?? source.totalUsage ?? source.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const fields = usage as Record<string, unknown>;
  const inputTokens = count(fields.inputTokens);
  const outputTokens = count(fields.outputTokens);
  const totalTokens = count(fields.totalTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  // Both are SUBSETS of the figures above, never additions — reasoning is
  // billed as output and already inside it, and cached input is already
  // inside the input. They are carried for disclosure, not arithmetic.
  const cachedInputTokens = count(fields.cachedInputTokens);
  const reasoningTokens = count(fields.reasoningTokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    // Providers that omit the total are simply reporting the sum in parts.
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

/** A token count is a finite, non-negative number or it is not a count. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Adds two counts that may each be "not reported", which is not zero. */
export function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + b;
}

export type ResponseAccumulator = ReturnType<typeof createResponseAccumulator>;

/**
 * Rebuilds the ModelMessages a run produced so the stateless browser can
 * carry the full conversation into the next step.
 */
export function createResponseAccumulator() {
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
    /** Whether this run has seen a call with that id at all. */
    hasCall(toolCallId: string) {
      return calls.some((call) => call.toolCallId === toolCallId);
    },
    /** Whether that call already has an answer in the history. */
    isResolved(toolCallId: string) {
      return calls.some((call) => call.toolCallId === toolCallId && call.resolved);
    },
    messages() {
      return messages;
    },
    pendingBrowserCalls() {
      return calls.filter((call) => call.executor === "browser" && !call.resolved);
    },
    unresolvedServerCalls() {
      return calls.filter((call) => call.executor === "server" && !call.resolved);
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
