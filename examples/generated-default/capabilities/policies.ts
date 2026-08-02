import { allow, definePolicy, hide, requireApproval } from "@orpc-agent/core";

import type { AppContext } from "./base";

/**
 * The two runtime-level policies, and the difference between them is the whole
 * DPAS security story in one file.
 *
 * `gateModelWrites` answers "may this happen without a human saying yes?" —
 * it suspends a model-initiated call on a consequential capability into a
 * server-side approval record. `analystHidesWrites` answers "does this exist
 * for you at all?" — it removes a capability from an actor's catalog entirely.
 *
 * Authority hides; state discloses. An analyst is not told "you may not issue
 * invoices": for them `issue-invoice` never existed, which is exactly what a
 * probing model should learn (nothing).
 */

/**
 * Consequential operations: irreversible, or visible to someone outside this
 * app. A human clicking the button in their own session has already expressed
 * intent, so these are gated only when a MODEL loop is the caller.
 */
export const GATED_CAPABILITIES = new Set(["issue-invoice", "delete-invoice"]);

export const gateModelWrites = definePolicy("gate-model-writes", ({ surface, capability }) => {
  const modelDriven = surface === "aiSdk" || surface === "mcp";
  if (modelDriven && GATED_CAPABILITIES.has(capability.id)) {
    return requireApproval({
      reason: `${capability.id} was initiated from a model loop`,
      approvalType: "human-confirmation",
    });
  }
  return allow();
});

/**
 * Role authority. Reads are open to everyone with a session; anything that
 * changes the ledger is absent for an analyst — at DISCOVERY as well as at
 * invocation, so a hidden capability and one that never existed are
 * indistinguishable from outside.
 */
export const analystHidesWrites = definePolicy(
  "analyst-hides-writes",
  (request) => {
    const { sideEffect } = request.capability.meta;
    if (sideEffect === "read" || sideEffect === "none") return allow();
    const session = (request.context as AppContext).session;
    if (session?.role !== "controller") return hide();
    return allow();
  },
  { phases: ["discovery", "invocation"] },
);
