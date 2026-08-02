import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { formatEur, todayISO } from "../model";
import { invoiceInput } from "../schemas";
import { getClient, insertInvoice } from "../../server/db";

/**
 * Creates a DRAFT. Nothing leaves the building here — that is `issue-invoice`,
 * which is gated. Splitting the two is what lets creation stay ungated: a
 * draft is a note to yourself.
 */
export const createInvoice = agentBase
  .meta({
    agent: {
      description:
        "Create a draft invoice for a client. Amount is in CENTS. The due date defaults to the " +
        "client's agreed payment terms after the issue date. Creates a draft only — issuing it " +
        "is a separate, confirmed step.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "write",
      risk: "medium",
      tags: ["invoices"],
    },
  })
  .use(
    auditFields<{ clientId: number; amount: number }, { id: number; reference: string }>({
      target: (_input, output) => ({ type: "invoice", id: String(output?.id ?? "?") }),
      summary: (input, output) =>
        `Created draft ${output?.reference ?? "invoice"} for ${formatEur(input.amount)}`,
    }),
  )
  .input(invoiceInput)
  .handler(({ input }) => {
    const client = getClient(input.clientId);
    if (!client) {
      throw new ORPCError("NOT_FOUND", { message: `No client with id ${input.clientId}.` });
    }
    const issueDate = input.issueDate ?? todayISO();
    const dueDate =
      input.dueDate ??
      new Date(Date.parse(`${issueDate}T00:00:00Z`) + client.payment_terms_days * 86_400_000)
        .toISOString()
        .slice(0, 10);
    return insertInvoice({
      clientId: input.clientId,
      amount: input.amount,
      issueDate,
      dueDate,
      notes: input.notes ?? null,
    });
  });
