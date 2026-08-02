import type { ApprovalRecord, ExecutionResult } from "@orpc-agent/core";

import { formatEur } from "../capabilities/model";

/**
 * What the conversation says after a human decides an approval.
 *
 * An approval is resolved OUT OF BAND — the user clicks Approve on a card, and
 * the model that asked is not in the room. So the decision has to re-enter the
 * thread as a message, or the next turn reasons over a history in which it
 * asked for something and nothing ever answered.
 *
 * The receipt is written from the RECORD and the RESULT, never from the
 * request: what the user approved and what actually happened are different
 * facts, and a run that was approved and then failed must say so.
 */

export interface ApprovalReceipt {
  /** The line appended to the conversation as an assistant message. */
  text: string;
  /** Whether the operation ultimately succeeded — drives the card's colour. */
  ok: boolean;
}

/** Human-readable rendering of the arguments an approval was minted for. */
function describeInput(capabilityId: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.id === "number") parts.push(`invoice ${record.id}`);
  if (typeof record.amount === "number") parts.push(formatEur(record.amount));
  return parts.length ? ` (${parts.join(", ")})` : `${capabilityId ? "" : ""}`;
}

export function approvalReceiptMessage(
  record: Pick<ApprovalRecord, "id" | "capabilityId" | "input">,
  decision: "approved" | "denied",
  result?: ExecutionResult<unknown>,
): ApprovalReceipt {
  const what = `${record.capabilityId}${describeInput(record.capabilityId, record.input)}`;

  if (decision === "denied") {
    return { text: `You denied ${what}. Nothing was changed.`, ok: false };
  }
  if (!result) {
    return { text: `You approved ${what}. It is running.`, ok: true };
  }
  switch (result.status) {
    case "completed":
      return { text: `You approved ${what}, and it completed.`, ok: true };
    case "failed":
      // The approval succeeded and the operation did not. Saying only
      // "approved" here would leave the model believing the ledger moved.
      return {
        text: `You approved ${what}, but it failed: ${result.error.publicMessage}`,
        ok: false,
      };
    case "cancelled":
      return { text: `You approved ${what}, but the run was cancelled.`, ok: false };
    default:
      return { text: `You approved ${what}.`, ok: true };
  }
}
