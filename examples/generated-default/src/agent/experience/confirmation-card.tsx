"use client";

import { usePendingConfirmations } from "@agent-surface/react";
import { ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDevicesQuery } from "@/features/devices/queries/use-devices";
import { useSession } from "@/lib/session";

/**
 * The agent-path confirmation. Rendered from the Agent Surface confirmation
 * controller — the experience layer only DISPLAYS a decision owned by the
 * capability provider. The evidence produced on approval is single-use and
 * bound to the exact effective input shown here; if the selection changed
 * after approval, the runtime rejects it (CONFIRMATION_INVALID: mismatch).
 */
export function ConfirmationCard() {
  const pending = usePendingConfirmations();
  const current = pending[0];
  const { session } = useSession();
  const devicesQuery = useDevicesQuery();
  const regionRef = useRef<HTMLDivElement>(null);

  const confirmationId = current?.confirmationId;
  useEffect(() => {
    if (confirmationId) {
      // Focus the region (not the approve button): approval must be a
      // deliberate act, never a stray Enter keypress.
      regionRef.current?.focus();
    }
  }, [confirmationId]);

  if (!current) return null;

  const input = current.input as { deviceIds?: string[]; reason?: string } | null;
  const deviceIds = input?.deviceIds ?? [];
  const namesById = new Map(
    (devicesQuery.data?.devices ?? []).map((device) => [device.id, device.name]),
  );

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      role="alertdialog"
      aria-label="Confirmation required"
      aria-describedby="dpas-confirmation-desc"
      data-testid="confirmation-card"
      className="rounded-lg border-2 border-danger/60 bg-danger-soft/50 p-3 outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") current.deny("user-declined");
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <ShieldAlert aria-hidden className="h-4 w-4" />
        Confirmation required
      </p>
      <p id="dpas-confirmation-desc" className="mt-1 text-[13px] leading-5">
        The assistant wants to <strong>disable {deviceIds.length} device
        {deviceIds.length === 1 ? "" : "s"}</strong>. They stop reporting data until an operator
        re-enables them (reversible from the table).
      </p>
      <ul className="mt-2 max-h-28 overflow-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs">
        {deviceIds.map((id) => (
          <li key={id}>
            {namesById.get(id) ?? id} <span className="text-faint-foreground">({id})</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Acting as <strong>{session?.name ?? "…"}</strong> · single-use approval ·{" "}
          <Countdown expiresAt={current.expiresAt} />
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => current.deny("user-declined")}>
            Deny
          </Button>
          <Button size="sm" variant="danger" onClick={() => current.approve()}>
            Approve — disable {deviceIds.length}
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
