import { usePendingConfirmations } from "@agent-surface/react";
import { ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { isEmptyPayload, PayloadView } from "../payload";

/**
 * The agent-path confirmation — the browser-side gate for a contextually bound
 * domain action (`bulk-categorize-transactions` on the selected transactions,
 * `update-collection-status` on the open chase dialog).
 *
 * The experience layer only DISPLAYS a decision owned by the capability
 * provider. The evidence produced on approval is single-use and bound to the
 * exact effective input shown here, so if the selection changes after
 * approval the runtime rejects it (CONFIRMATION_INVALID: mismatch) — what you
 * approved is what runs, or nothing does.
 *
 * This is distinct from the server-side approval card (tool-ui.tsx): that one
 * gates DIRECT model calls to gated capabilities and is persisted by the
 * governed pipeline. Different planes, different gates.
 */
export function ConfirmationCard() {
  const pending = usePendingConfirmations();
  const current = pending[0];
  const regionRef = useRef<HTMLDivElement>(null);

  const confirmationId = current?.confirmationId;
  useEffect(() => {
    if (confirmationId) {
      // Focus the region, not the approve button: approval must be a
      // deliberate act, never a stray Enter keypress.
      regionRef.current?.focus();
    }
  }, [confirmationId]);

  if (!current) return null;

  const capabilityId = current.capabilityId ?? "this action";

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      role="alertdialog"
      aria-label="Confirmation required"
      aria-describedby="agent-confirmation-desc"
      data-testid="confirmation-card"
      className="rounded-lg border-2 border-destructive/60 bg-destructive/5 p-3 outline-hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape") current.deny("user-declined");
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <ShieldAlert aria-hidden className="h-4 w-4" />
        Confirmation required
      </p>
      <p id="agent-confirmation-desc" className="mt-1 text-[13px] leading-5">
        The copilot wants to run <strong className="font-mono text-xs">{capabilityId}</strong> with
        the exact input below. Approving is single-use and bound to it.
      </p>
      {!isEmptyPayload(current.input) && (
        <div className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-card px-3 py-2">
          <PayloadView value={current.input} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          single-use approval · <Countdown expiresAt={current.expiresAt} />
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => current.deny("user-declined")}>
            Deny
          </Button>
          <Button size="sm" variant="destructive" onClick={() => current.approve()}>
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return <span>expires in {seconds}s</span>;
}
