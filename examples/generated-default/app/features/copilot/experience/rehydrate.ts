import { decodeWireName } from "@agent-surface/core";
import type { WireModelMessage } from "@/agent/host/protocol";

import type { ChatEntry } from "./message-store";

/**
 * Turn a stored conversation back into the two halves the experience layer
 * needs: the canonical model history the protocol re-posts, and the entries
 * the thread renders.
 *
 * Both are derived from the SAME model messages
 * (`GET /api/threads/:id/model-messages`). Fetching the rendered transcript
 * and the model history separately is how a reloaded thread ends up showing
 * one conversation and reasoning over another.
 *
 * Tool calls and their results arrive as separate messages — the call on an
 * assistant message, the result on a following `tool` message — so calls are
 * indexed by id and settled as the results come past.
 */

interface TextPart {
  type: "text";
  text: string;
}
interface ReasoningPart {
  type: "reasoning";
  text: string;
}
interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  args?: unknown;
}
interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output?: unknown;
  result?: unknown;
}
type Part = TextPart | ReasoningPart | ToolCallPart | ToolResultPart | { type: string };

function partsOf(content: WireModelMessage["content"]): Part[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content as Part[];
}

function textOf(content: WireModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return partsOf(content)
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * `ok` is not stored: a persisted tool result records what came back, not
 * whether the host judged it a success. The host's own envelope carries that
 * (`{ ok, value }` — app/agent/host/errors.ts), so it is read back out when
 * present and assumed successful otherwise. Guessing "error" from a shape we
 * do not recognise would paint red pills on a healthy transcript.
 */
function resultStatus(output: unknown): { status: "ok" | "error"; result: unknown } {
  if (output && typeof output === "object" && "ok" in output) {
    const envelope = output as { ok: unknown; value?: unknown };
    return {
      status: envelope.ok === false ? "error" : "ok",
      result: "value" in envelope ? envelope.value : output,
    };
  }
  return { status: "ok", result: output };
}

export function entriesFromModelMessages(messages: readonly WireModelMessage[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  const toolEntryByCallId = new Map<string, Extract<ChatEntry, { kind: "tool" }>>();
  let counter = 0;
  const id = (prefix: string) => `${prefix}_rh_${++counter}`;

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) entries.push({ kind: "user", id: id("u"), text });
      continue;
    }

    if (message.role === "assistant") {
      for (const part of partsOf(message.content)) {
        if (part.type === "text" && (part as TextPart).text) {
          entries.push({ kind: "assistant", id: id("a"), text: (part as TextPart).text });
        } else if (part.type === "reasoning" && (part as ReasoningPart).text) {
          entries.push({ kind: "reasoning", id: id("r"), text: (part as ReasoningPart).text });
        } else if (part.type === "tool-call") {
          const call = part as ToolCallPart;
          // The history stores the WIRE name — that is what went to the
          // provider. The pill keys on the canonical id, so decode it back.
          //
          // `decodeWireName` refuses a name it cannot reverse (a shortened or
          // instance-suffixed one) rather than returning a plausible wrong id,
          // and falling back to the wire name is the honest answer in that
          // case: a restored thread has no catalog to look the mapping up in,
          // and a guessed identity in a transcript is worse than a raw one.
          const canonicalId = decodeWireName(call.toolName) ?? call.toolName;
          const entry: Extract<ChatEntry, { kind: "tool" }> = {
            kind: "tool",
            id: id("t"),
            toolCallId: call.toolCallId,
            wireName: call.toolName,
            canonicalId,
            plane: canonicalId.startsWith("domain") ? "domain" : "view",
            // A reloaded thread cannot know where a call ran; the wire-name
            // prefix is the only honest signal, and it is what the pill shows.
            executor: canonicalId.startsWith("domain") ? "server" : "browser",
            input: call.input ?? call.args ?? {},
            // Anything still unsettled after the whole history is replayed was
            // genuinely never answered — see the sweep below.
            status: "running",
          };
          entries.push(entry);
          toolEntryByCallId.set(call.toolCallId, entry);
        }
      }
      continue;
    }

    if (message.role === "tool") {
      for (const part of partsOf(message.content)) {
        if (part.type !== "tool-result") continue;
        const toolResult = part as ToolResultPart;
        const entry = toolEntryByCallId.get(toolResult.toolCallId);
        if (!entry) continue;
        const { status, result } = resultStatus(toolResult.output ?? toolResult.result);
        entry.status = status;
        entry.result = result;
      }
    }
  }

  // A call left running is one whose turn was interrupted — a reload, a closed
  // tab, a dropped connection. Say so rather than rendering a spinner that
  // will never resolve.
  for (const entry of toolEntryByCallId.values()) {
    if (entry.status !== "running") continue;
    entry.status = "error";
    entry.result = { error: { code: "TOOL_NOT_EXECUTED", message: "Interrupted before it finished." } };
  }

  return entries;
}
