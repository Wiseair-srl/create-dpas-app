import { describe, expect, it } from "vitest";

import { awaitingApproval, mutatesData } from "./protocol";

/**
 * The server plane executes inside the model loop, so a write it performs
 * reaches the tab only as a `tool-result` frame. `mutatesData` is the whole
 * decision about whether that frame refreshes the screen — and the interesting
 * half of it is which way the doubt falls, which is the half a later
 * "simplification" to `sideEffect === "write"` would silently invert.
 */
describe("mutatesData", () => {
  it("leaves declared reads alone", () => {
    expect(mutatesData("read")).toBe(false);
    expect(mutatesData("none")).toBe(false);
  });

  it("reconciles for every declared write", () => {
    expect(mutatesData("write")).toBe(true);
    expect(mutatesData("destructive")).toBe(true);
    expect(mutatesData("external")).toBe(true);
  });

  it("treats a value it has never heard of as a write", () => {
    // A newer server naming an effect this build predates. One refetch too
    // many costs a request; one missed leaves the user reading stale numbers.
    expect(mutatesData("quantum")).toBe(true);
  });

  it("treats an absent value as a write", () => {
    // A server too old to send the field at all — same asymmetry, same answer.
    expect(mutatesData(undefined)).toBe(true);
  });
});

/**
 * The other half of the reconcile decision. `mutatesData` says whether the
 * TOOL writes; this says whether this particular `ok` result actually ran or
 * suspended at the approval gate — a suspension wrote nothing, and the write
 * it defers reconciles later, from the decision itself (tool-ui.tsx).
 */
describe("awaitingApproval", () => {
  it("recognises the governed suspension envelope", () => {
    expect(
      awaitingApproval({ status: "approval-required", approvalId: "apr_1", message: "Awaiting." }),
    ).toBe(true);
  });

  it("lets every executed result through", () => {
    expect(awaitingApproval({ status: "ok", data: { id: 1 } })).toBe(false);
    expect(awaitingApproval({ status: "error", error: { code: "X", message: "no" } })).toBe(false);
  });

  it("does not read a shape it cannot recognise as a suspension", () => {
    // The doubt falls the same way as mutatesData's: anything not POSITIVELY a
    // suspension reconciles. Misreading an unknown envelope as "did not run
    // yet" is how a landed write stays on screen stale.
    expect(awaitingApproval({ status: "suspended" })).toBe(false);
    expect(awaitingApproval({ approvalId: "apr_1" })).toBe(false);
    expect(awaitingApproval("approval-required")).toBe(false);
    expect(awaitingApproval(null)).toBe(false);
    expect(awaitingApproval(undefined)).toBe(false);
  });
});
