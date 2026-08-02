import * as z from "zod";

import { agentBase } from "../base";
import { agingReport, todayISO } from "../model";
import { listInvoiceRows } from "../../server/db";

export const collectionsAging = agentBase
  .meta({
    agent: {
      description:
        "The receivables ageing ladder: outstanding invoices bucketed by how far past due they " +
        "are (not yet due, 1–30, 31–60, 61–90, over 90 days), with a count and a total in CENTS " +
        "per bucket. The right read for 'how bad is our collections position'.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "read",
      risk: "low",
      tags: ["invoices", "reporting"],
    },
  })
  .input(z.object({}).optional())
  .handler(() => agingReport(listInvoiceRows(todayISO())));
