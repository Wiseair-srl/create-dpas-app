import { z } from "zod";

/**
 * DPAS host protocol v1 (ADR-0002): the versioned browser↔server transport.
 *
 * One POST = one model step-run. The server streams NDJSON frames; when a run
 * ends at frontend tool-calls, the browser executes them through Agent
 * Surface and POSTs the next step with the tool results appended. Nothing is
 * held open across human decisions, and the server keeps no run state.
 *
 * A frontend tool declaration grants model VISIBILITY only. Execution stays
 * in the browser; domain authority stays on the server.
 */

export const PROTOCOL_VERSION = 2 as const;
/** Served alongside v2 for one minor so a stale tab survives a deploy (§10). */
export const SUPPORTED_PROTOCOL_VERSIONS = [1, 2] as const;

/**
 * Named limits, enforced in the browser before posting and again on the
 * server. A catalog that exceeds one is a legal request that is too large —
 * it reports as `CATALOG_TOO_LARGE` naming plane, count and limit, never as a
 * decode failure.
 */
export const CATALOG_LIMITS = {
  maxFrontendTools: 128,
  maxDomainTools: 128,
  maxTotalTools: 192,
  maxMessages: 400,
} as const;

// ---------------------------------------------------------------------------
// Browser → server

/**
 * The STABLE half of a capability — everything that goes in the provider tool
 * block. It contains no live state, so it changes only when code or the mount
 * set changes, and the block stays byte-identical across the steps of a turn.
 *
 * `available` / `unavailableReason` remain here as optional fields purely for
 * protocol v1, which had no separate state channel. v2 leaves them unset and
 * sends `WireToolState` instead.
 */
export const WireToolDescriptorSchema = z.object({
  wireName: z.string().min(1).max(64),
  canonicalId: z.string().min(1).max(128),
  plane: z.enum(["view", "domain"]),
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
  effect: z.string().max(64),
  confirmation: z.enum(["never", "optional", "required"]),
  available: z.boolean().optional(),
  unavailableReason: z.string().max(300).optional(),
});
export type WireToolDescriptor = z.infer<typeof WireToolDescriptorSchema>;

/**
 * The VOLATILE half — never in the tool block. Rendered into a single compact
 * system message appended after the conversation, where it costs a few hundred
 * tokens and invalidates nothing behind it.
 */
export const WireToolStateSchema = z.object({
  wireName: z.string().min(1).max(64),
  available: z.boolean(),
  unavailableReason: z.string().max(300).optional(),
  /** Live text from a contextual binding's `describe()`. */
  note: z.string().max(300).optional(),
});
export type WireToolState = z.infer<typeof WireToolStateSchema>;

/** AI SDK v5 ModelMessage, validated loosely — Mastra re-validates deeply. */
export const WireModelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});
export type WireModelMessage = z.infer<typeof WireModelMessageSchema>;

/** v1 — kept verbatim so an in-flight tab keeps working through a deploy. */
export const ChatStepRequestV1Schema = z.object({
  protocolVersion: z.literal(1),
  conversationId: z.string().min(1).max(64),
  turnId: z.string().min(1).max(64),
  stepIndex: z.number().int().min(0).max(64),
  messages: z.array(WireModelMessageSchema).min(1).max(200),
  frontendTools: z.array(WireToolDescriptorSchema).max(64),
});
export type ChatStepRequestV1 = z.infer<typeof ChatStepRequestV1Schema>;

export const ChatStepRequestV2Schema = z.object({
  protocolVersion: z.literal(2),
  conversationId: z.string().min(1).max(64),
  turnId: z.string().min(1).max(64),
  stepIndex: z.number().int().min(0).max(64),
  /** The route the surface is mounted on; the server derives the scope floor. */
  pathname: z.string().min(1).max(512),
  /**
   * Preferred model id. A REQUEST, never an instruction: the server checks it
   * against its own allowlist (server/mastra.ts `allowedModels`) and falls
   * back to the default when it does not match. Identity and authority never
   * come from here.
   */
  modelId: z.string().max(128).optional(),
  messages: z.array(WireModelMessageSchema).min(1).max(CATALOG_LIMITS.maxMessages),
  catalog: z.object({
    mode: z.enum(["direct", "meta"]).default("direct"),
    /** Discovery shaping only — a request, intersected with a server floor. */
    scope: z.array(z.string().max(64)).max(32).optional(),
    frontendTools: z.array(WireToolDescriptorSchema).max(CATALOG_LIMITS.maxFrontendTools),
    /** Volatile half, keyed by wire name. Rendered outside the tool block. */
    frontendState: z.array(WireToolStateSchema).max(CATALOG_LIMITS.maxFrontendTools).default([]),
    /** Set when the browser reduced the catalog to fit. Never silent. */
    truncated: z
      .object({
        dropped: z.number().int().min(0),
        reason: z.enum(["budget", "limit", "undecodable"]),
      })
      .optional(),
  }),
});
export type ChatStepRequestV2 = z.infer<typeof ChatStepRequestV2Schema>;

/** Accepts either version; the server branches on what it got. */
export const ChatStepRequestSchema = z.discriminatedUnion("protocolVersion", [
  ChatStepRequestV1Schema,
  ChatStepRequestV2Schema,
]);
export type ChatStepRequest = z.infer<typeof ChatStepRequestSchema>;

/** Normalised view of either version, so the handler has one shape to read. */
export interface NormalizedChatStep {
  protocolVersion: 1 | 2;
  conversationId: string;
  turnId: string;
  stepIndex: number;
  pathname: string;
  /** Model preference from the browser, unvalidated. */
  modelId: string | undefined;
  messages: WireModelMessage[];
  catalogMode: "direct" | "meta";
  requestedScope: string[] | undefined;
  frontendTools: WireToolDescriptor[];
  frontendState: WireToolState[];
  truncated: { dropped: number; reason: string } | undefined;
}

/**
 * Renders the volatile half as one compact block. Returns undefined when there
 * is nothing to say, so a fully-available catalog adds no tokens at all.
 *
 * This goes AFTER the conversation, never in the tool definitions — that
 * placement is the whole point: availability stays honest without any of it
 * invalidating the cached prompt prefix.
 */
export function renderCapabilityState(
  state: readonly WireToolState[],
  descriptors: readonly WireToolDescriptor[],
): string | undefined {
  const canonicalByWire = new Map(descriptors.map((d) => [d.wireName, d.canonicalId] as const));
  const lines: string[] = [];
  for (const entry of state) {
    const id = canonicalByWire.get(entry.wireName) ?? entry.wireName;
    if (!entry.available) {
      lines.push(`- ${id} — unavailable: ${entry.unavailableReason ?? "not available right now"}`);
    } else if (entry.note) {
      lines.push(`- ${id} — available; ${entry.note}`);
    }
  }
  if (lines.length === 0) return undefined;
  return `Capability state (this step):\n${lines.join("\n")}`;
}

export function normalizeChatStep(step: ChatStepRequest): NormalizedChatStep {
  if (step.protocolVersion === 1) {
    return {
      protocolVersion: 1,
      conversationId: step.conversationId,
      turnId: step.turnId,
      stepIndex: step.stepIndex,
      // v1 predates scoping: no route, so the catalog stays unscoped.
      pathname: "",
      modelId: undefined,
      messages: step.messages,
      catalogMode: "direct",
      requestedScope: undefined,
      frontendTools: step.frontendTools,
      // v1 carried availability inside the descriptor; lift it into the same
      // state channel v2 uses so the handler has one shape to render.
      frontendState: step.frontendTools.map((d) => ({
        wireName: d.wireName,
        available: d.available ?? true,
        ...(d.unavailableReason ? { unavailableReason: d.unavailableReason } : {}),
      })),
      truncated: undefined,
    };
  }
  return {
    protocolVersion: 2,
    conversationId: step.conversationId,
    turnId: step.turnId,
    stepIndex: step.stepIndex,
    pathname: step.pathname,
    modelId: step.modelId,
    messages: step.messages,
    catalogMode: step.catalog.mode,
    requestedScope: step.catalog.scope ? [...step.catalog.scope] : undefined,
    frontendTools: step.catalog.frontendTools,
    frontendState: step.catalog.frontendState,
    truncated: step.catalog.truncated,
  };
}

// ---------------------------------------------------------------------------
// Server → browser (NDJSON frames)

export interface DomainToolInfo {
  canonicalId: string;
  wireName: string;
  description: string;
  requiresApproval: boolean;
}

/**
 * What one step-request cost, in tokens.
 *
 * A step-request is not a model call: the runtime may take several model steps
 * inside one (`RUN_LIMITS.maxStepsPerRequest`), and a turn may take several
 * step-requests. These are the totals for THIS request, so a client that wants
 * the turn or the conversation adds them up — which is also what the provider
 * bills, since every step resends the conversation so far.
 */
export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * As reported by the provider where it reports one; it can exceed
   * input + output (reasoning and other overhead), so it is carried rather
   * than recomputed.
   */
  totalTokens: number;
  /**
   * SUBSET of `inputTokens` — the part served from the provider's prompt
   * cache. Adding it to the input would double-count. It is worth surfacing
   * because it is billed at a fraction of the normal rate, so a large cached
   * share means the input figure overstates the bill.
   *
   * Undefined when the provider said nothing about caching, which is not the
   * same as a cache miss.
   */
  cachedInputTokens?: number;
  /**
   * SUBSET of `outputTokens` — the part the model spent thinking. Reasoning
   * is billed AS output by the providers that report it, so it is already
   * inside `outputTokens`; this only says how much of that output was
   * thinking rather than answer. Adding it would double-count.
   *
   * Undefined when the provider reported none, which is not the same as a
   * model that did no reasoning.
   */
  reasoningTokens?: number;
  /**
   * How many model steps actually reported usage. The field is absent
   * altogether when that count would be zero — a provider that reports
   * nothing must not read as a measured zero.
   */
  reportedSteps: number;
}

/**
 * Nothing measured yet. `reportedSteps: 0` is what keeps the counter hidden,
 * so this is not "zero tokens" — it is "no provider has said anything".
 */
export const NO_STEP_USAGE: StepUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reportedSteps: 0,
};

/**
 * Adds one step-request's usage to a running total.
 *
 * Lives on the protocol because three scopes sum the same shape — the
 * browser's per-turn and per-conversation counters, and the thread store's
 * per-thread one — and two implementations of this are two counters that
 * disagree after a reload.
 *
 * The optional subsets stay ABSENT unless a side reported them: `undefined`
 * means the provider said nothing about caching or reasoning, and folding that
 * in as a zero would turn "not reported" into a measured claim.
 */
export function sumStepUsage(a: StepUsage, b: StepUsage): StepUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ...optionalSum("cachedInputTokens", a.cachedInputTokens, b.cachedInputTokens),
    ...optionalSum("reasoningTokens", a.reasoningTokens, b.reasoningTokens),
    reportedSteps: a.reportedSteps + b.reportedSteps,
  };
}

/** Absent + absent is absent; absent + a figure is that figure. Never a key
 *  set to `undefined`, which is a third state nothing downstream expects. */
function optionalSum(key: string, a: number | undefined, b: number | undefined) {
  const total = a === undefined ? b : b === undefined ? a : a + b;
  return total === undefined ? {} : { [key]: total };
}

export type ChatStepFrame =
  | {
      type: "step-start";
      stepId: string;
      turnId: string;
      conversationId: string;
      /** The domain half of this turn's catalog, for the inspector. */
      domainTools: DomainToolInfo[];
      /** What the model was actually offered, so the Inspector can show it. */
      catalogMode?: "direct" | "meta";
      /** The scope after intersection with the server floor. */
      scope?: string[];
    }
  | { type: "text-delta"; text: string }
  /** Model reasoning, kept separate from the answer so the UI can fold it. */
  | { type: "reasoning-delta"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      wireName: string;
      canonicalId: string;
      executor: "server" | "browser";
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      wireName: string;
      canonicalId: string;
      ok: boolean;
      result: unknown;
    }
  | {
      type: "inspector";
      lane: "runtime" | "domain" | "host";
      eventType: string;
      summary: string;
      correlation?: Record<string, string>;
      data?: unknown;
    }
  | {
      type: "step-finish";
      stepId: string;
      finishReason: string;
      /**
       * The model messages this run produced (assistant text/tool-calls and
       * server tool results), reconstructed server-side. The browser appends
       * them to its history — the server holds no run state.
       */
      responseMessages: WireModelMessage[];
      /** Frontend tool calls the browser must execute before the next step. */
      pendingToolCalls: Array<{
        toolCallId: string;
        wireName: string;
        canonicalId: string;
        input: unknown;
      }>;
      /** Absent when the provider reported no usage for this request. */
      usage?: StepUsage;
    }
  | {
      type: "error";
      error: { code: string; message: string };
    };

export function encodeFrame(frame: ChatStepFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/** Incremental NDJSON decoder for the browser side of the transport. */
export function createFrameDecoder(onFrame: (frame: ChatStepFrame) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            onFrame(JSON.parse(line) as ChatStepFrame);
          } catch {
            // A malformed frame is a transport bug; surface it as an error frame.
            onFrame({
              type: "error",
              error: { code: "PROTOCOL_DECODE_ERROR", message: "Malformed frame received." },
            });
          }
        }
        newline = buffer.indexOf("\n");
      }
    },
  };
}

/** Typed transport error codes the host can emit (distinct from capability errors). */
export const HOST_ERROR_CODES = [
  "PROTOCOL_VERSION_MISMATCH",
  "PROTOCOL_DECODE_ERROR",
  /**
   * A named limit was exceeded. Distinct from a decode failure on purpose: a
   * legal catalog that is merely too large must not report as malformed.
   */
  "CATALOG_TOO_LARGE",
  /** Retained for v1. Under v2 a collision degrades to a dropped duplicate. */
  "CATALOG_COLLISION",
  "MODEL_NOT_CONFIGURED",
  "MODEL_TIMEOUT",
  "MODEL_ERROR",
  "RUN_LIMIT_EXCEEDED",
  "TRANSPORT_FAILED",
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

/** Builds the message for a `CATALOG_TOO_LARGE` response. */
export function catalogTooLargeMessage(
  plane: "frontend" | "domain" | "total" | "messages",
  count: number,
  limit: number,
): string {
  return (
    `The ${plane} catalog has ${count} entries, over the limit of ${limit}. ` +
    "Scope the route to fewer capabilities, or switch the catalog to meta mode."
  );
}
