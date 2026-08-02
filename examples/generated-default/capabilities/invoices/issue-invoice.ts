import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { formatEur, todayISO } from "../model";
import { invoiceId } from "../schemas";
import { getClient, getInvoiceRow, issueInvoice as issueInvoiceRow } from "../../server/db";

/**
 * The consequential one. Issuing sends the invoice to the client and moves it
 * into the receivables ledger; it is the operation this app most wants a human
 * to have looked at.
 *
 * It is a DIRECT governed tool, not a contextual surface binding, and that is
 * deliberate. A contextual binding reaches the server as `surface: "direct"`,
 * which `gateModelWrites` lets through ungated by design — so binding it would
 * trade a persisted, server-side approval record for a browser-side dialog.
 * Weaker authority, on exactly the operation that least wants it. Contextual
 * binding is right for shaping input from the screen; server approval is right
 * for consequence. See app/agent/domain/manifest.ts.
 */
export const issueInvoice = agentBase
  .meta({
    agent: {
      description:
        "Issue a draft invoice: send it to the client and enter it in the receivables ledger. " +
        "Irreversible. Requires the user's approval when a model asks for it.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "destructive",
      risk: "high",
      tags: ["invoices"],
    },
  })
  .use(
    auditFields<{ id: number }>({
      target: (input) => ({ type: "invoice", id: String(input.id) }),
      summary: (input) => `Issued invoice ${input.id} to the client`,
    }),
  )
  .input(invoiceId)
  .handler(({ input }) => {
    const row = getInvoiceRow(input.id);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `No invoice with id ${input.id}.` });
    if (row.status !== "draft") {
      throw new ORPCError("CONFLICT", {
        message: `Invoice ${row.reference} is already ${row.status}; only a draft can be issued.`,
      });
    }
    const client = getClient(row.client_id);
    const issueDate = todayISO();
    const dueDate = new Date(
      Date.parse(`${issueDate}T00:00:00Z`) + (client?.payment_terms_days ?? 30) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    const issued = issueInvoiceRow(input.id, issueDate, dueDate);
    if (!issued) {
      throw new ORPCError("CONFLICT", { message: "The invoice changed while it was being issued." });
    }
    return {
      ...issued,
      summary: `${issued.reference} · ${formatEur(issued.amount)} · due ${dueDate}`,
    };
  });
