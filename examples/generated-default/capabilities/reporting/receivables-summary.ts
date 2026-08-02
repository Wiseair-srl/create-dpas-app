import * as z from "zod";

import { agentBase } from "../base";
import { receivablesSummary, todayISO } from "../model";
import { listInvoiceRows } from "../../server/db";

/**
 * The KPI row, computed server-side. The screen and the model read the same
 * numbers from the same function (capabilities/model.ts) — a dashboard whose
 * figures the assistant cannot reproduce is a dashboard nobody trusts.
 */
export const receivablesSummaryCapability = agentBase
  .meta({
    agent: {
      description:
        "Receivables headline figures, all amounts in CENTS: outstanding, overdue, draft value, " +
        "collected in the last 30 days, invoice and overdue counts, and the average days-to-pay " +
        "over settled invoices (null when nothing has been paid).",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "read",
      risk: "low",
      tags: ["invoices", "reporting"],
    },
  })
  .input(z.object({}).optional())
  .handler(() => receivablesSummary(listInvoiceRows(), todayISO()));
