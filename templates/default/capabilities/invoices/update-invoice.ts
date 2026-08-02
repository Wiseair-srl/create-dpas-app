import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { invoiceUpdate } from "../schemas";
import { getInvoiceRow, updateInvoice as updateInvoiceRow } from "../../server/db";

export const updateInvoice = agentBase
  .meta({
    agent: {
      description:
        "Change a draft invoice's amount (in cents), due date or notes. Issued invoices cannot " +
        "be edited — correct them with a credit note in a real ledger.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "write",
      risk: "medium",
      tags: ["invoices"],
    },
  })
  .use(
    auditFields<{ id: number }>({
      target: (input) => ({ type: "invoice", id: String(input.id) }),
      summary: (input) => `Updated invoice ${input.id}`,
    }),
  )
  .input(invoiceUpdate)
  .handler(({ input }) => {
    const row = getInvoiceRow(input.id);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `No invoice with id ${input.id}.` });
    if (row.status !== "draft") {
      throw new ORPCError("CONFLICT", {
        message: `${row.reference} is ${row.status}; only a draft can be edited.`,
      });
    }
    const updated = updateInvoiceRow(input.id, {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    return updated!;
  });
