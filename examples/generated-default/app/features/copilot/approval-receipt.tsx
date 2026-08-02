import { useState, type ReactNode } from "react";
import { Check, ChevronRight, CircleCheck, Copy, ShieldX, TriangleAlert } from "lucide-react";

import { CHAT_RENDERERS } from "@/chat-renderers";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FieldList, JsonBlock } from "./payload";
import { scalarFields, truncatedPreview, type ApprovalReceipt } from "./receipt";

/**
 * What the thread shows AFTER the user approved (or denied) a consequential
 * action: the outcome as a result card rather than a sentence with a JSON tail.
 *
 * It renders a persisted message (see receipt.ts), so it is history, not state —
 * it survives a reload, a thread switch, and tomorrow morning.
 *
 * The status colour is carried by one tinted disc, in the system's badge
 * recipe, rather than by a coloured edge on the card: a 2px rule down a 10px
 * radius is the detail that made this read as a banner instead of a receipt.
 */

/** Denial is a correct outcome, not a failure — it reads neutral, not red. */
const TONES = {
  completed: {
    label: "Executed",
    icon: CircleCheck,
    chip: "bg-positive-bg text-positive",
  },
  rejected: {
    label: "Denied",
    icon: ShieldX,
    // The neutral disc has to sit off the card in BOTH themes, and no single
    // token does: light needs the darker grey, dark needs the lighter one.
    chip: "bg-hover dark:bg-muted text-muted-foreground",
  },
  failed: {
    label: "Failed",
    icon: TriangleAlert,
    chip: "bg-negative-bg text-negative",
  },
} as const;

function toneFor(status: string) {
  if (status === "completed") return TONES.completed;
  if (status === "rejected") return TONES.rejected;
  return TONES.failed;
}

export function ApprovalReceiptCard({ receipt }: { receipt: ApprovalReceipt }) {
  const tone = toneFor(receipt.status);
  const Icon = tone.icon;
  const denied = receipt.status === "rejected";

  return (
    <div className="group/receipt my-3 max-w-[34rem] overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:shadow-none">
      <div className="flex items-start gap-3 p-4">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone.chip)}>
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold leading-none">{tone.label}</span>
            {receipt.capabilityId && (
              <span className="truncate rounded-md bg-hover px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground dark:bg-muted">
                {receipt.capabilityId}
              </span>
            )}
          </div>
          {/* "Denied / by …" — the headline already carries the verb in that case. */}
          <p className="mt-2 text-xs text-muted-foreground">
            {denied ? "" : "Approved "}by {receipt.approver} · {formatDateTime(receipt.decidedAt)}
          </p>
        </div>
        {receipt.status === "completed" && receipt.output != null && (
          <CopyOutput output={receipt.output} />
        )}
      </div>

      {receipt.error && (
        <p className="border-t px-4 py-3 text-xs text-negative">
          {receipt.error.message}{" "}
          <span className="font-mono text-[11px] opacity-70">({receipt.error.code})</span>
        </p>
      )}

      {receipt.status === "completed" && (
        <ResultBody capabilityId={receipt.capabilityId} output={receipt.output} />
      )}
    </div>
  );
}

/**
 * The result, in descending order of legibility: the capability's own chart
 * card when it has one, then a field list for a flat payload, then raw JSON
 * behind a disclosure. `{ ok: true }` carries nothing to show — the header
 * already said it ran — so it renders nothing at all.
 */
function ResultBody({ capabilityId, output }: { capabilityId: string | null; output: unknown }) {
  const native = capabilityId ? (CHAT_RENDERERS[capabilityId]?.(output) ?? null) : null;
  if (native) return <div className="border-t px-4 pb-2 pt-1">{native}</div>;

  const truncated = truncatedPreview(output);
  if (truncated) {
    return (
      <Disclosure summary="Result (truncated)">
        <JsonBlock value={truncated} />
      </Disclosure>
    );
  }

  const fields = scalarFields(output);
  if (fields) {
    if (fields.length === 0) return null;
    return <FieldList fields={fields} className="border-t px-4 py-3" />;
  }

  return (
    <Disclosure summary="Result">
      <JsonBlock value={output} />
    </Disclosure>
  );
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-t">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="px-4 pb-3.5">{children}</div>
    </details>
  );
}

/**
 * Hover-revealed: a copy affordance is not worth a permanent glyph on a
 * receipt. Below `md` there is no hover to reveal it with, so it stays put.
 */
function CopyOutput({ output }: { output: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy result"
      title="Copy result"
      onClick={() => {
        void navigator.clipboard.writeText(JSON.stringify(output, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "-me-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-[color,background-color,opacity] hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden group-hover/receipt:opacity-100",
        copied ? "text-positive opacity-100" : "opacity-0 max-md:opacity-100",
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
