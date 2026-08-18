import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { isEmptyPayload, PayloadView } from "@/features/copilot/payload";
import type { ApprovalCardData, ApprovalStatus } from "@/features/copilot/tool-ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The approver surface an approval deep link lands on.
 *
 * An approval raised in the copilot is decided in the copilot — the card sits
 * in the thread that asked. An approval raised over MCP has no such place: the
 * requester is a chat window somewhere else entirely, so the suspension
 * envelope carries a link here (server/mcp.ts, `approvals.url`) and a HUMAN
 * decides on this page, authenticated by the same session as every other
 * route. The link is a locator, never an authority: opening it grants nothing,
 * and the decision POST below is scoped to the record's requester exactly like
 * the copilot's own card.
 *
 * Deciding and executing stay split for MCP records: approving here does NOT
 * run the operation. The requesting session executes it through the adapter's
 * `approvals_resume` tool — once, bound to its actor and surface — which is
 * why an approved record on this page reads "awaiting the requesting session"
 * rather than showing a result.
 */

const json = (r: Response) => {
  if (!r.ok) throw new Error(r.status === 404 ? "not-found" : `${r.status} ${r.statusText}`);
  return r.json();
};

/** Statuses this page keeps polling through: a decision or a resume is due. */
const LIVE: ReadonlySet<ApprovalStatus> = new Set(["pending", "approved"]);

const HEADLINE: Record<ApprovalStatus, string> = {
  pending: "Awaiting your decision",
  approved: "Approved — awaiting the requesting session",
  consumed: "Approved and executed",
  rejected: "Denied — nothing was changed",
  expired: "Expired before a decision",
  cancelled: "Cancelled",
};

const BAND: Record<"pending" | "positive" | "muted", string> = {
  pending: "border-pending/25 bg-pending-bg/70 text-pending",
  positive: "border-positive/25 bg-positive-bg/70 text-positive",
  muted: "border-border bg-surface-alt text-muted-foreground",
};

function bandTone(status: ApprovalStatus): keyof typeof BAND {
  if (status === "pending") return "pending";
  if (status === "approved" || status === "consumed") return "positive";
  return "muted";
}

export default function Approval() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<ApprovalCardData | null>(null);
  const [missing, setMissing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/approvals/${id}`, { credentials: "include" })
      .then(json)
      .then((r: ApprovalCardData) => {
        setRecord(r);
        setMissing(false);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.message === "not-found") setMissing(true);
      });
  }, [id]);

  // Poll while the record can still change: pending awaits the decision made
  // here, approved awaits the requesting session's resume. Terminal states
  // stop the timer — nothing further can happen to them.
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (!record || !LIVE.has(record.status ?? "pending")) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [record, reload]);

  const decide = async (approved: boolean) => {
    setDeciding(true);
    setError(null);
    try {
      const response = (await fetch(`/api/approvals/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved }),
      }).then(json)) as { receipt?: { text?: string } };
      setReceipt(response.receipt?.text ?? null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(false);
    }
  };

  if (missing) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Approval" />
        <p className="text-sm text-muted-foreground">
          No approval with this id is visible to your session. Records are scoped to the person who
          requested them, and a pending one expires on its own.
        </p>
      </div>
    );
  }
  if (!record) return null;

  const status = record.status ?? "pending";
  const overMcp = record.surface === "mcp";

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Approval"
        description={
          overMcp
            ? "Requested from an MCP session. Approving lets that session execute it — once."
            : "Requested from the in-app copilot."
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:shadow-none">
        <div
          className={cn(
            "flex items-center gap-1.5 border-b px-4 py-2 text-[11px] font-semibold uppercase tracking-wide",
            BAND[bandTone(status)],
          )}
        >
          <ShieldAlert size={13} /> {HEADLINE[status]}
          {record.risk && (
            <span className="ms-auto rounded-full bg-current/10 px-2 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal">
              {record.risk} risk
            </span>
          )}
        </div>

        <div className="space-y-3 p-4">
          <div>
            <div className="font-mono text-sm font-semibold text-foreground">
              {record.capabilityId}
            </div>
            {record.reasons.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{record.reasons.join(" · ")}</p>
            )}
          </div>

          {!isEmptyPayload(record.input) && (
            <div className="rounded-lg bg-surface-alt px-3 py-2.5">
              <PayloadView value={record.input} />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {record.requestedAt && <>Requested {formatDateTime(record.requestedAt)}</>}
            {status === "pending" && record.expiresAt && (
              <> · expires {formatDateTime(record.expiresAt)}</>
            )}
          </p>

          {status === "pending" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="rounded-full px-4"
                disabled={deciding}
                onClick={() => void decide(true)}
              >
                Approve
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
              {deciding && <span className="text-xs text-muted-foreground">Deciding…</span>}
            </div>
          )}

          {record.decision && (
            <p className="text-[11px] text-muted-foreground">
              {record.decision.status === "approved" ? "Approved" : "Denied"} by{" "}
              {record.decision.approver} · {formatDateTime(record.decision.decidedAt)}
            </p>
          )}

          {receipt && <p className="text-xs text-foreground">{receipt}</p>}
          {error && <p className="break-words text-xs text-negative">{error}</p>}
        </div>
      </div>
    </div>
  );
}
