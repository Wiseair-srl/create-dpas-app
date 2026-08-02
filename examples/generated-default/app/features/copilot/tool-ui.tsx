import { createContext, useContext, useEffect, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ChevronDown, ShieldAlert } from "lucide-react";

import { CHAT_RENDERERS } from "@/chat-renderers";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { isEmptyPayload, PayloadSummary, PayloadView } from "./payload";

/**
 * The copilot's tool surface. Every server capability answers with the SAME
 * governed envelope — `{ status, data, approvalId, message }` — so one
 * assistant-ui `tools.Fallback` renders them all: a status pill, the native
 * Recharts renderer when the capability has one, and the inline approval card
 * when the run stopped at the gate.
 *
 * Approvals are OUR gate, not assistant-ui's `respondToApproval`: the decision
 * POSTs to /api/approvals/:id and the server resumes the run and persists the
 * outcome in the same thread.
 *
 * A decided approval keeps its place in the thread. The envelope is frozen at
 * "approval-required" forever — it was written before the user answered — so
 * the pill reads the approval's CURRENT state from /api/approvals/:id. Without
 * that, a reloaded thread showed a stuck amber "approval-required" pill over a
 * card that had silently removed itself.
 *
 * A decided approval writes its own receipt message into the thread
 * (approval-receipt.tsx), so this file deliberately does NOT restate the
 * outcome: the pill turns green, the input and the "approved by … " line move
 * inside its disclosure, and the receipt card below is the one place the
 * decision is spelled out.
 */

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed";

export type ApprovalCardData = {
  id: string;
  capabilityId: string;
  reasons: string[];
  input: unknown;
  risk?: string;
  sideEffect?: string;
  status?: ApprovalStatus;
  requestedAt?: string;
  expiresAt?: string;
  decision?: { status: "approved" | "rejected"; approver: string; decidedAt: string };
};

type GovernedEnvelope = {
  status?: string;
  approvalId?: string;
  message?: string;
  data?: unknown;
};

type CopilotContextValue = {
  approvals: ApprovalCardData[];
  threadId: string;
  /** Re-poll approvals + reload the thread after a decision. */
  onDecided: () => void;
};

const CopilotContext = createContext<CopilotContextValue>({
  approvals: [],
  threadId: "",
  onDecided: () => {},
});

export const CopilotProvider = CopilotContext.Provider;

const json = (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

/**
 * Decided approvals never change again, so one fetch per id serves every
 * remount of the thread. Pending ones are deliberately NOT cached — the poll
 * in Chat.tsx owns those, so a card left open still notices an expiry.
 */
const settled = new Map<string, ApprovalCardData>();

function useApprovalRecord(approvalId: string | null): ApprovalCardData | null {
  const { approvals } = useContext(CopilotContext);
  const polled = approvalId ? (approvals.find((a) => a.id === approvalId) ?? null) : null;
  const [fetched, setFetched] = useState<ApprovalCardData | null>(null);

  useEffect(() => {
    if (!approvalId || polled || settled.has(approvalId)) return;
    let alive = true;
    fetch(`/api/approvals/${approvalId}`, { credentials: "include" })
      .then(json)
      .then((record: ApprovalCardData) => {
        if (record.status && record.status !== "pending") settled.set(approvalId, record);
        if (alive) setFetched(record);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [approvalId, polled]);

  if (!approvalId) return null;
  return polled ?? settled.get(approvalId) ?? fetched;
}

/**
 * `toolName` is the CANONICAL id under the host protocol — `domain:sync-fic`,
 * `view:cashflow.transactions.setFilters`. The pill shows it whole, because
 * which plane a call ran on is worth seeing; the result renderers are keyed by
 * bare capability id, which is also the only plane that has any.
 */
function rendererKey(toolName: string): string {
  return toolName.startsWith("domain:") ? toolName.slice("domain:".length) : toolName;
}

/**
 * View-plane results come back in the host's own envelope — `{ ok, value }`
 * (app/agent/host/errors.ts) — rather than the governed `{ status, data }`.
 * Normalising here keeps ONE status vocabulary in the thread, so a failed
 * browser capability reads as an error rather than silently as a success.
 */
function normalizeEnvelope(result: unknown): GovernedEnvelope | undefined {
  if (!result || typeof result !== "object") return undefined;
  if ("status" in result) return result as GovernedEnvelope;
  if ("ok" in result) {
    const { ok, value } = result as { ok: boolean; value: unknown };
    return { status: ok ? "ok" : "error", data: value } as GovernedEnvelope;
  }
  return undefined;
}

export const CapabilityToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  const envelope = normalizeEnvelope(result);
  const approvalId =
    envelope?.status === "approval-required" ? (envelope.approvalId ?? null) : null;
  const approval = useApprovalRecord(approvalId);

  const state =
    status.type === "running" || status.type === "requires-action"
      ? "running"
      : status.type === "incomplete"
        ? "error"
        : approvalId
          ? (GATE_STATE[approval?.status ?? "pending"] ?? "approval-required")
          : (envelope?.status ?? "ok");

  const renderer =
    envelope?.status === "ok" && CHAT_RENDERERS[rendererKey(toolName)]
      ? CHAT_RENDERERS[rendererKey(toolName)]!(envelope.data)
      : null;

  return (
    // Block flow, not a flex column: the native chart cards carry their own
    // margins and want the full column width, which `items-start` would take
    // away from them. Near-flush vertically — the thread's message gap owns the
    // rhythm between steps.
    <div className="my-0.5">
      <ToolCall
        name={toolName}
        args={args}
        state={state}
        approval={approval}
        // While the gate is open its card is already showing the same input
        // right below; a disclosure that repeats it is just a second copy.
        suppressDetail={state === "approval-required"}
      />
      {renderer}
      {approvalId && <ApprovalGate approvalId={approvalId} approval={approval} />}
    </div>
  );
};

/** Approval status → the word the tool line shows. "consumed" = ran. */
const GATE_STATE: Record<ApprovalStatus, string> = {
  pending: "approval-required",
  approved: "approved",
  consumed: "approved",
  rejected: "denied",
  expired: "expired",
  cancelled: "cancelled",
};

/**
 * A tool call is a pill, not a log row: it hugs its own width so a run of them
 * reads as a short list of steps rather than a stack of full-bleed slabs, and
 * it lifts off the grey page the way every other panel in the system does.
 *
 * `ok` shows no word at all — the green dot already says it, and the thread is
 * mostly ok. Only a state worth reading gets spelled out.
 */
const STATES: Record<string, { dot: string; label: string | null; tone: string }> = {
  ok: { dot: "bg-positive", label: null, tone: "text-positive" },
  approved: { dot: "bg-positive", label: "approved", tone: "text-positive" },
  error: { dot: "bg-negative", label: "failed", tone: "text-negative" },
  "approval-required": { dot: "bg-pending", label: "needs approval", tone: "text-pending" },
  denied: { dot: "bg-muted-foreground", label: "denied", tone: "text-muted-foreground" },
  expired: { dot: "bg-muted-foreground", label: "expired", tone: "text-muted-foreground" },
  cancelled: { dot: "bg-muted-foreground", label: "cancelled", tone: "text-muted-foreground" },
  running: {
    dot: "animate-pulse bg-muted-foreground",
    label: "running",
    tone: "text-muted-foreground",
  },
};

const PILL =
  "inline-flex max-w-full items-center gap-2 rounded-full border border-border/80 bg-card py-1 ps-2.5 pe-3 text-[11px] leading-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:shadow-none";

function ToolCall({
  name,
  args,
  state,
  approval,
  suppressDetail,
}: {
  name: string;
  args: unknown;
  state: string;
  approval: ApprovalCardData | null;
  suppressDetail?: boolean;
}) {
  const status = STATES[state] ?? {
    dot: "bg-muted-foreground",
    label: state,
    tone: "text-muted-foreground",
  };
  // The approval's stored input is the authoritative one — args on a gated
  // call are what the model proposed, before the gate normalised them.
  const input = approval?.input ?? args;
  const decision = approval?.decision;
  const detail = !suppressDetail && (!isEmptyPayload(input) || Boolean(decision));

  const body = (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
      <span className="shrink-0 font-mono font-medium text-foreground">{name}</span>
      {!isEmptyPayload(args) && (
        <span className="min-w-0 flex-1 truncate font-mono">
          <PayloadSummary value={args} />
        </span>
      )}
      {status.label && (
        <span className={cn("shrink-0 font-medium", status.tone)}>{status.label}</span>
      )}
      {detail && (
        <ChevronDown
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-180"
        />
      )}
    </>
  );

  if (!detail) return <div className={PILL}>{body}</div>;

  return (
    <details className="group">
      <summary
        className={cn(
          PILL,
          "cursor-pointer list-none transition-colors hover:border-border hover:bg-hover [&::-webkit-details-marker]:hidden",
        )}
      >
        {body}
      </summary>
      {/* A hairline rail, so the detail reads as subordinate to the pill
          instead of as a second card competing with it. */}
      <div className="ms-2 mt-2 space-y-2 border-s border-border ps-3.5">
        {!isEmptyPayload(input) && <PayloadView value={input} />}
        {decision && (
          <p className="text-[11px] text-muted-foreground">
            {decision.status === "approved" ? "Approved" : "Denied"} by {decision.approver} ·{" "}
            {formatDateTime(decision.decidedAt)}
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * The decision card, shown only while the approval is open. Once it closes the
 * card leaves entirely: the pill above carries the state, its disclosure keeps
 * the input, and the receipt message below is the record of what happened.
 */
function ApprovalGate({
  approvalId,
  approval,
}: {
  approvalId: string;
  approval: ApprovalCardData | null;
}) {
  const { threadId, onDecided } = useContext(CopilotContext);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approved: boolean) => {
    setDeciding(true);
    setError(null);
    try {
      await fetch(`/api/approvals/${approvalId}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved, threadId }),
      }).then(json);
      // The record just changed; the reload below must not read a stale copy.
      settled.delete(approvalId);
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeciding(false);
    }
  };

  // Nothing known yet (first paint, or a record this user may not read).
  if (!approval) return null;
  if (approval.status && approval.status !== "pending") return null;

  return (
    <div className="mt-2.5 max-w-[34rem] overflow-hidden rounded-xl border border-pending/40 bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:shadow-none">
      {/* The amber lives in one band, not across the whole card: enough to
          claim attention, quiet enough to read the payload underneath. */}
      <div className="flex items-center gap-1.5 border-b border-pending/25 bg-pending-bg/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-pending">
        <ShieldAlert size={13} /> Approval required
        {approval.risk && (
          <span className="ms-auto rounded-full bg-pending/15 px-2 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal">
            {approval.risk} risk · {approval.sideEffect}
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="font-mono text-sm font-semibold text-foreground">
            {approval.capabilityId}
          </div>
          {approval.reasons.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{approval.reasons.join(" · ")}</p>
          )}
        </div>

        {!isEmptyPayload(approval.input) && (
          <div className="rounded-lg bg-surface-alt px-3 py-2.5">
            <PayloadView value={approval.input} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="rounded-full px-4"
            disabled={deciding}
            onClick={() => void decide(true)}
          >
            Approve &amp; run
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-4"
            disabled={deciding}
            onClick={() => void decide(false)}
          >
            Deny
          </Button>
          {deciding && <span className="text-xs text-muted-foreground">Running…</span>}
        </div>

        {error && <p className="break-words text-xs text-negative">{error}</p>}
      </div>
    </div>
  );
}
