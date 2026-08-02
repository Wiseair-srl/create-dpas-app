/**
 * The client half of the approval receipt — the fenced block the server
 * appends to the thread when an approval is decided (server/approval-receipt.ts
 * writes it; approval-receipt.test.ts pins the two together).
 *
 * Parsing a persisted message rather than holding client state is what keeps
 * the history: reopen the thread a week later and the executed action still
 * reads as a result card. Anything that fails to parse is ordinary prose and
 * falls through to markdown, so old threads keep rendering.
 */

const FENCE = "```approval-outcome";

export type ApprovalReceipt = {
  v: number;
  approvalId: string | null;
  capabilityId: string | null;
  /** The execution's status, plus "rejected" for a denial. */
  status: string;
  approver: string;
  decidedAt: string;
  output?: unknown;
  error?: { code: string; message: string };
};

export function parseApprovalReceipt(text: string): ApprovalReceipt | null {
  const open = text.indexOf(FENCE);
  if (open === -1) return null;
  const body = text.slice(open + FENCE.length);
  const close = body.indexOf("```");
  if (close === -1) return null;
  try {
    const parsed: unknown = JSON.parse(body.slice(0, close));
    if (!parsed || typeof parsed !== "object") return null;
    const receipt = parsed as ApprovalReceipt;
    return typeof receipt.status === "string" && typeof receipt.decidedAt === "string"
      ? receipt
      : null;
  } catch {
    return null;
  }
}

/** The server caps oversized payloads; the preview is already-serialized JSON. */
export function truncatedPreview(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const value = output as { truncated?: unknown; preview?: unknown };
  return value.truncated === true && typeof value.preview === "string" ? value.preview : null;
}

/** A flat object of scalars reads as a field list; anything nested does not. */
export function scalarFields(output: unknown): [string, unknown][] | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const entries = Object.entries(output);
  if (!entries.every(([, v]) => v === null || v === undefined || typeof v !== "object")) return null;
  // `ok: true` is the envelope saying "it ran" — the card's header already says that.
  return entries.filter(([key, value]) => !(key === "ok" && value === true));
}
