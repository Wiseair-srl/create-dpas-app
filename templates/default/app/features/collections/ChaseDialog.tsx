import { useAgentProcedure } from "@agent-surface/orpc/react";
import { useState } from "react";

import { formatEur, type InvoiceRow } from "../../../capabilities/model";
import { updateCollectionStatusContract } from "@/agent/surface/contracts";
import { getDomainRefs } from "@/agent/surface/registry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { useUpdateCollectionStatus } from "../invoices/hooks";

/**
 * The chase dialog — and the app's one CONTEXTUAL domain reference.
 *
 * `domain:update-collection-status` is `expose.aiSdk: false` on the server, so
 * the model never sees it as a tool it can aim. It reaches the model only from
 * here, while this dialog is open, with `invoiceId` BOUND to the invoice on
 * screen and locked: the advertised input schema has no such field, so the
 * model is not asked to leave it alone — it is given nothing to say it with.
 *
 * That is the shape for an operation whose correctness depends on pointing at
 * what the user is looking at. The opposite shape — a direct governed tool with
 * a server-side approval — is right for one whose risk is its consequence; see
 * capabilities/invoices/issue-invoice.ts.
 *
 * The human path below calls the same procedure through the same client with no
 * agent evidence attached: a person typing in their own dialog has already
 * expressed intent. The server authorizes both identically.
 */
export function ChaseDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceRow | null;
  onClose: () => void;
}) {
  useAgentProcedure(updateCollectionStatusContract, getDomainRefs()["update-collection-status"], {
    // Availability IS the dialog. Closed, the capability sits in the catalog
    // unavailable with a reason the model can act on; open, it is bound.
    when: () => invoice !== null,
    unavailableReason: "Open an invoice's chase dialog first",
    bind: () => ({ invoiceId: invoice?.id ?? 0 }),
    // No confirmation: recording a chase is reversible, and the input is
    // already pinned to the invoice on screen. Confirmation is for the calls
    // whose blast radius a person needs to read first.
    describe: () =>
      invoice
        ? `Bound to ${invoice.reference} (${invoice.client_name}, ${formatEur(invoice.amount)}, ` +
          `${invoice.days_overdue} days overdue).`
        : "",
  });

  return (
    <Dialog open={invoice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed by invoice: opening a different row remounts the form, which
            is what "reset the fields" actually means. Syncing them in an effect
            instead renders the previous invoice's note for one frame. */}
        {invoice ? <ChaseForm key={invoice.id} invoice={invoice} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ChaseForm({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const update = useUpdateCollectionStatus();
  const [note, setNote] = useState(invoice.collection?.note ?? "");
  const [expected, setExpected] = useState(invoice.collection?.expected_payment_date ?? "");
  const reminders = invoice.collection?.reminders_sent ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Chase {invoice.reference}</DialogTitle>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Client</dt>
          <dd>{invoice.client_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular-nums">{formatEur(invoice.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Due</dt>
          <dd>{formatDate(invoice.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reminders sent</dt>
          <dd className="tabular-nums">{reminders}</dd>
        </div>
      </dl>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="chase-expected">Expected payment date</Label>
          <Input
            id="chase-expected"
            type="date"
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chase-note">Note</Label>
          <Textarea
            id="chase-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did they say?"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                invoiceId: invoice.id,
                remindersSent: reminders + 1,
                lastReminderDate: new Date().toISOString().slice(0, 10),
                expectedPaymentDate: expected || null,
                note: note || null,
              },
              { onSuccess: onClose },
            )
          }
        >
          Record reminder
        </Button>
      </DialogFooter>
    </>
  );
}
