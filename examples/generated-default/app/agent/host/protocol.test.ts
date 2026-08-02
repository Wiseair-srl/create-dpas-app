import { describe, expect, it } from "vitest";

import { mutatesData } from "./protocol";

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
