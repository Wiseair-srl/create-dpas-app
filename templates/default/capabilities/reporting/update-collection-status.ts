import { ORPCError } from "@orpc/server";

import { agentBase } from "../base";
import { auditFields } from "../audit";
import { collectionStatusInput } from "../schemas";
import { getInvoiceRow, upsertCollectionStatus } from "../../server/db";

/**
 * The contextual one: `expose.aiSdk: false`.
 *
 * A model never sees this as a server tool. Its only model-visible path is the
 * Agent Surface reference the chase dialog binds (app/agent/domain/manifest.ts),
 * where `invoiceId` comes from the invoice the user actually has open and is
 * LOCKED — the model is not asked to leave it alone, it is given no field in
 * which to name a different one.
 *
 * It stays on `mcp` and `direct`, so the MCP server and the UI are unaffected.
 * Only the in-app agent is required to come through the live screen.
 *
 * This is the right shape for an operation whose correctness depends on
 * pointing at what the user is looking at, and the wrong shape for one whose
 * risk is its consequence — see issue-invoice.ts for the other half.
 */
export const updateCollectionStatus = agentBase
  .meta({
    agent: {
      description:
        "Upsert the chase status of the invoice whose dialog is open: last reminder date, " +
        "reminders sent, expected payment date, note. Patch semantics — only the fields you " +
        "pass are written, and an explicit null clears one.",
      expose: { aiSdk: false, mcp: true, direct: true, test: true },
      sideEffect: "write",
      risk: "low",
      tags: ["invoices", "collections"],
    },
  })
  .use(
    auditFields<{ invoiceId: number }>({
      target: (input) => ({ type: "invoice", id: String(input.invoiceId) }),
      summary: (input) => `Updated chase status on invoice ${input.invoiceId}`,
    }),
  )
  .input(collectionStatusInput)
  .handler(({ input }) => {
    if (!getInvoiceRow(input.invoiceId)) {
      throw new ORPCError("NOT_FOUND", { message: `No invoice with id ${input.invoiceId}.` });
    }
    return upsertCollectionStatus(input);
  });
