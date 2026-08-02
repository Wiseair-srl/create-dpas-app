import { agentBase } from "../base";
import { isOutstanding, todayISO } from "../model";
import { capRows } from "../redact";
import { listInvoicesInput } from "../schemas";
import { listInvoiceRows } from "../../server/db";

/**
 * The one read every screen and every question starts from. `kind` collapses
 * what the UI splits across two routes, because the model choosing between
 * `list-pending-invoices` and `list-all-invoices` is a choice with no
 * information in it.
 */
export const listInvoices = agentBase
  .meta({
    agent: {
      description:
        "List invoices with their client, amount in cents, status, due date and days overdue. " +
        "kind=pending: issued and unpaid — the collections working set. kind=draft: not yet " +
        "issued. kind=all: the whole ledger. Read-only.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "read",
      risk: "low",
      tags: ["invoices"],
      // A ledger read is the classic way to spend six figures of input tokens
      // on a three-invoice question. The UI is unaffected — it reads /rpc.
      redact: { output: capRows(50) },
    },
  })
  .input(listInvoicesInput)
  .handler(({ input }) => {
    const asOf = todayISO();
    let rows = listInvoiceRows(asOf);
    if (input.kind === "pending") rows = rows.filter(isOutstanding);
    if (input.kind === "draft") rows = rows.filter((row) => row.status === "draft");
    if (input.clientId !== undefined) rows = rows.filter((row) => row.client_id === input.clientId);
    if (input.overdueOnly) rows = rows.filter((row) => row.days_overdue > 0);
    return rows;
  });
