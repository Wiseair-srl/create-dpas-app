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

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Browser → server

export const WireToolDescriptorSchema = z.object({
  wireName: z.string().min(1).max(64),
  canonicalId: z.string().min(1).max(128),
  plane: z.enum(["view", "domain"]),
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
  effect: z.string().max(64),
  confirmation: z.enum(["never", "optional", "required"]),
  available: z.boolean(),
  unavailableReason: z.string().max(300).optional(),
});
export type WireToolDescriptor = z.infer<typeof WireToolDescriptorSchema>;

/** AI SDK v5 ModelMessage, validated loosely — Mastra re-validates deeply. */
export const WireModelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});
export type WireModelMessage = z.infer<typeof WireModelMessageSchema>;

export const ChatStepRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  conversationId: z.string().min(1).max(64),
  turnId: z.string().min(1).max(64),
  stepIndex: z.number().int().min(0).max(64),
  messages: z.array(WireModelMessageSchema).min(1).max(200),
  frontendTools: z.array(WireToolDescriptorSchema).max(64),
});
export type ChatStepRequest = z.infer<typeof ChatStepRequestSchema>;

// ---------------------------------------------------------------------------
// Server → browser (NDJSON frames)

export interface DomainToolInfo {
  canonicalId: string;
  wireName: string;
  description: string;
  requiresApproval: boolean;
}

export type ChatStepFrame =
  | {
      type: "step-start";
      stepId: string;
      turnId: string;
      conversationId: string;
      /** The domain half of this turn's catalog, for the inspector. */
      domainTools: DomainToolInfo[];
    }
  | { type: "text-delta"; text: string }
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
      usage?: { inputTokens?: number; outputTokens?: number };
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
  "CATALOG_COLLISION",
  "MODEL_NOT_CONFIGURED",
  "MODEL_TIMEOUT",
  "MODEL_ERROR",
  "RUN_LIMIT_EXCEEDED",
  "TRANSPORT_FAILED",
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];
