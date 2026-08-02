import * as z from "zod";

import { agentBase } from "../base";
import { isOutstanding, sumAmounts, todayISO } from "../model";
import { listClients, listInvoiceRows } from "../../server/db";

export const listClientsCapability = agentBase
  .meta({
    agent: {
      description:
        "List clients with their segment, agreed payment terms, billing email, and their current " +
        "position: number of open invoices and the total outstanding and overdue in CENTS.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "read",
      risk: "low",
      tags: ["clients"],
    },
  })
  .input(z.object({}).optional())
  .handler(() => {
    const asOf = todayISO();
    const rows = listInvoiceRows(asOf);
    return listClients().map((client) => {
      const theirs = rows.filter((row) => row.client_id === client.id);
      const open = theirs.filter(isOutstanding);
      return {
        ...client,
        open_invoices: open.length,
        outstanding: sumAmounts(open),
        overdue: sumAmounts(open.filter((row) => row.days_overdue > 0)),
      };
    });
  });
