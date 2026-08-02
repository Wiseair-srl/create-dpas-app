import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AgingBucket, InvoiceRow, ReceivablesSummary } from "../../../capabilities/model";
import { client, orpc } from "@/lib/rpc";

/**
 * The data layer, as ordinary React Query over the typed oRPC client.
 *
 * There is nothing agent-specific here, and that is the point: a mutation the
 * copilot performs settles through `invalidateQueries` in
 * agent/surface/wiring.tsx — the same invalidation these hooks do — so the
 * screen refreshes identically whether a person or the agent moved the ledger.
 * A second, agent-only state path is the thing this architecture exists to
 * avoid.
 */

type ListKind = "pending" | "all" | "draft";

export function useInvoices(kind: ListKind) {
  return useQuery({
    ...orpc["list-invoices"].queryOptions({ input: { kind } }),
    select: (rows) => rows as InvoiceRow[],
  });
}

export function useReceivablesSummary() {
  return useQuery({
    ...orpc["receivables-summary"].queryOptions({ input: {} }),
    select: (data) => data as ReceivablesSummary,
  });
}

export function useAging() {
  return useQuery({
    ...orpc["collections-aging"].queryOptions({ input: {} }),
    select: (data) => data as AgingBucket[],
  });
}

export function useClients() {
  return useQuery(orpc["list-clients"].queryOptions({ input: {} }));
}

/**
 * Every mutation invalidates EVERYTHING and reports failure as a toast.
 *
 * Blanket invalidation is deliberate. Narrowing it per mutation is a
 * micro-optimisation that goes wrong quietly — issuing an invoice moves the
 * summary, the ageing ladder, the client's position and two tables, and the
 * screen that forgets one of them shows a stale number next to a fresh one.
 */
function useAppMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  options: { success?: (output: TOutput, input: TInput) => string } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (output, input) => {
      const message = options.success?.(output, input);
      if (message) toast.success(message);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useIssueInvoice() {
  return useAppMutation(
    (input: { id: number }) => client["issue-invoice"](input),
    { success: (output) => `Issued ${(output as { reference: string }).reference}` },
  );
}

export function useDeleteInvoice() {
  return useAppMutation(
    (input: { id: number }) => client["delete-invoice"](input),
    { success: (output) => `Deleted ${(output as { reference: string }).reference}` },
  );
}

export function useMarkInvoicePaid() {
  return useAppMutation((input: { id: number }) => client["mark-invoice-paid"](input), {
    success: () => "Payment recorded",
  });
}

export function useUpdateCollectionStatus() {
  return useAppMutation(
    (input: {
      invoiceId: number;
      lastReminderDate?: string | null;
      remindersSent?: number;
      expectedPaymentDate?: string | null;
      note?: string | null;
    }) => client["update-collection-status"](input),
    { success: () => "Chase recorded" },
  );
}
