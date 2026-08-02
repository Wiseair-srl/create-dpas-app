import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { invoiceId } from "../schemas";
import { deleteInvoice as deleteInvoiceRow, getInvoiceRow } from "../../server/db";

/** Gated (capabilities/policies.ts): a model asking for this waits for a human. */
export const deleteInvoice = agentBase
  .meta({
    agent: {
      description:
        "Permanently delete an invoice and its chase history. Only a draft can be deleted — an " +
        "issued invoice is part of the ledger. Requires the user's approval when a model asks for it.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "destructive",
      risk: "high",
      tags: ["invoices"],
    },
  })
  .use(
    auditFields<{ id: number }>({
      target: (input) => ({ type: "invoice", id: String(input.id) }),
      summary: (input) => `Deleted invoice ${input.id}`,
    }),
  )
  .input(invoiceId)
  .handler(({ input }) => {
    const row = getInvoiceRow(input.id);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `No invoice with id ${input.id}.` });
    if (row.status !== "draft") {
      throw new ORPCError("CONFLICT", {
        message: `${row.reference} has been ${row.status}; issued invoices stay in the ledger.`,
      });
    }
    deleteInvoiceRow(input.id);
    return { ok: true, reference: row.reference };
  });
