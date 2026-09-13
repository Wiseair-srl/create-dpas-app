import { randomUUID } from "node:crypto";

export interface TrustedTurnIdentity {
  /** Derived from authentication and authorized thread lookup, never a request body. */
  resourceId: string;
  threadId: string;
  runId: string;
  /** Persist a server-generated ID for request deduplication; never reuse the browser ID. */
  messageId?: string;
}

export interface LatestUserMessage {
  id: string;
  role: "user";
  parts: Array<{ type: "text"; text: string }>;
}

/**
 * AI SDK 5/6 UI-message boundary for Mastra-owned memory. Accept one new user
 * message only. Tool receipts and system messages enter through trusted host
 * execution. Authentication/thread ownership must run before this function.
 */
export function prepareMastraTurn(body: unknown, identity: TrustedTurnIdentity) {
  if (!body || typeof body !== "object") throw new TypeError("Expected one new user message.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "message"))
    throw new TypeError("Only message is accepted; history and identity are server-owned.");
  const message = input.message as Partial<LatestUserMessage> | undefined;
  if (
    !message ||
    message.role !== "user" ||
    typeof message.id !== "string" ||
    !message.id ||
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    Object.keys(message).some((key) => !["id", "role", "parts"].includes(key))
  ) {
    throw new TypeError("Expected one identified user message with text parts.");
  }
  let text = "";
  for (const part of message.parts) {
    if (
      !part ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      Object.keys(part).some((key) => !["type", "text"].includes(key))
    ) {
      throw new TypeError(
        "Only user text is accepted; tools and system instructions are host-owned.",
      );
    }
    text += part.text;
  }
  if (!text.trim() || text.length > 100_000)
    throw new TypeError("User text must contain 1–100000 characters.");
  if (
    ![identity.resourceId, identity.threadId, identity.runId].every(
      (id) => typeof id === "string" && id,
    )
  ) {
    throw new TypeError("Missing trusted turn identity.");
  }
  if (
    identity.messageId !== undefined &&
    (typeof identity.messageId !== "string" || !identity.messageId)
  ) {
    throw new TypeError("Invalid trusted message ID.");
  }
  return {
    // Mastra receives only this delta and reconstructs history from its Memory.
    messages: [{ id: identity.messageId ?? randomUUID(), role: "user" as const, content: text }],
    options: {
      memory: { thread: identity.threadId, resource: identity.resourceId },
      runId: identity.runId,
    },
  };
}
