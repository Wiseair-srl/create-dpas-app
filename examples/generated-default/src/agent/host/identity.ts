import type { AgentConsumer } from "@agent-surface/core";

/**
 * Identity constants and generators for the Agent Host. One place defines who
 * consumes the surface and how correlation ids are minted, so every layer
 * (surface, transport, runtime, inspector, audit) agrees.
 *
 * Correlation vocabulary (DPAS §11.2):
 *   conversationId → one chat thread (browser-generated)
 *   turnId         → one user message and everything it causes
 *   stepId         → one protocol step: a single POST /api/chat model run
 *   toolCallId     → model/provider tool-call id; doubles as the surface
 *                    invocationId so retried transports never double-execute
 */

/** The stable consumer identity for the dashboard's embedded assistant. */
export const HOST_CONSUMER: AgentConsumer = { id: "dashboard-assistant", kind: "embedded" };

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export const newConversationId = () => `cnv_${randomSuffix(12)}`;
export const newTurnId = () => `trn_${randomSuffix(12)}`;
export const newStepId = () => `stp_${randomSuffix(12)}`;
export const newToolCallId = () => `tcl_${randomSuffix(12)}`;
