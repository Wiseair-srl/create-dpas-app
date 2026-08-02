import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { daysBetween, formatEur, todayISO } from "../model";
import { markPaidInput } from "../schemas";
import { getInvoiceRow, markInvoicePaid as markPaid } from "../../server/db";

export const markInvoicePaid = agentBase
  .meta({
    agent: {
      description:
        "Record payment against an issued invoice, settling it. Returns how many days it took " +
        "to pay, measured from the issue date.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "write",
      risk: "medium",
      tags: ["invoices"],
    },
  })
  .use(
    auditFields<{ id: number }, { daysToPay: number; amount: number }>({
      target: (input) => ({ type: "invoice", id: String(input.id) }),
      summary: (input, output) =>
        output
          ? `Invoice ${input.id} settled — ${formatEur(output.amount)} after ${output.daysToPay} days`
          : `Invoice ${input.id} settled`,
    }),
  )
  .input(markPaidInput)
  .handler(({ input }) => {
    const row = getInvoiceRow(input.id);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `No invoice with id ${input.id}.` });
    if (row.status !== "sent") {
      throw new ORPCError("CONFLICT", {
        message: `${row.reference} is ${row.status}; only an issued invoice can be settled.`,
      });
    }
    const paidDate = input.paidDate ?? todayISO();
    const updated = markPaid(input.id, paidDate);
    return {
      ...updated!,
      daysToPay: daysBetween(row.issue_date, paidDate),
    };
  });
