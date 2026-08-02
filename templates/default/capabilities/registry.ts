import { createCapabilityRegistry } from "@orpc-agent/core";

import { listClientsCapability } from "./clients/list-clients";
import { createInvoice } from "./invoices/create-invoice";
import { deleteInvoice } from "./invoices/delete-invoice";
import { issueInvoice } from "./invoices/issue-invoice";
import { listInvoices } from "./invoices/list-invoices";
import { markInvoicePaid } from "./invoices/mark-invoice-paid";
import { updateInvoice } from "./invoices/update-invoice";
import { collectionsAging } from "./reporting/collections-aging";
import { receivablesSummaryCapability } from "./reporting/receivables-summary";
import { updateCollectionStatus } from "./reporting/update-collection-status";

/**
 * One FLAT structure, two uses: the oRPC router served at /rpc (writes wrapped
 * by server/rpc.ts) and the governed capability registry.
 *
 * Flat on purpose. A capability id is the audit identity, the MCP tool name,
 * the manifest key and the string a policy matches on — nesting it would mean
 * four places agreeing about how to flatten `invoices.issue`, and they would
 * not. Files stay organised by vertical under `capabilities/<vertical>/`; only
 * the keys here are flat.
 */
export const router = {
  "list-invoices": listInvoices,
  "create-invoice": createInvoice,
  "update-invoice": updateInvoice,
  "issue-invoice": issueInvoice,
  "delete-invoice": deleteInvoice,
  "mark-invoice-paid": markInvoicePaid,
  "list-clients": listClientsCapability,
  "receivables-summary": receivablesSummaryCapability,
  "collections-aging": collectionsAging,
  "update-collection-status": updateCollectionStatus,
};

export type AppRouter = typeof router;

export const registry = createCapabilityRegistry(router);
