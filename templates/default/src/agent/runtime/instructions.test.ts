import { describe, expect, it } from "vitest";
import { assistantInstructions } from "./instructions";

/**
 * The prompt is not enforcement, but it IS the only thing that tells the model
 * which of the two projections it is looking at. A direct-mode prompt served
 * under meta describes a `view_` namespace that does not exist, and the model
 * follows it into `surface_discover({scope:["view_"]})` — a disjoint scope,
 * which returns an empty surface (AS-META-002) and reads as "this page has no
 * capabilities". `domain:devices.disable` has no other path to the model, so
 * that mistake takes the operation off the table entirely.
 */

describe("assistant instructions · mode-aware", () => {
  it("describes the direct catalog under direct mode", () => {
    const text = assistantInstructions("direct");

    expect(text).toContain('"view_"');
    expect(text).toContain('"domain_"');
    expect(text).not.toContain("surface_discover");
  });

  it("describes the three meta verbs under meta mode", () => {
    const text = assistantInstructions("meta");

    expect(text).toContain("surface_discover");
    expect(text).toContain("surface_read");
    expect(text).toContain("surface_act");
  });

  it("tells the model to discover with no arguments and never invent a scope", () => {
    const text = assistantInstructions("meta");

    expect(text).toContain("with NO arguments");
    expect(text).toContain("Never invent a token");
    // The specific failure to pre-empt: empty is a wrong scope, not an empty
    // application. Without this the model stops and reports nothing exists.
    expect(text).toContain("EMPTY surface");
    expect(text).toMatch(/Empty means your scope was wrong/);
  });

  it("keeps the staleness echo the library's tool description asks for", () => {
    expect(assistantInstructions("meta")).toContain("surfaceVersion");
  });

  it("shows where a capability's own arguments go", () => {
    // The second failure mode, after the scope one: the model names the right
    // capability and then flattens its arguments next to `capabilityId`.
    // `input` is then undefined, so the capability rejects an empty payload
    // and the model reads INVALID_INPUT as "wrong capability".
    const text = assistantInstructions("meta");

    expect(text).toContain('always go inside "input"');
    expect(text).toContain('surface_act({ capabilityId: "view:devices.filters.set"');
    expect(text).toContain("INVALID_INPUT");
  });

  it("keeps the shared guidelines in both modes", () => {
    for (const mode of ["direct", "meta"] as const) {
      const text = assistantInstructions(mode);
      expect(text).toContain("You are the assistant embedded in a device operations dashboard.");
      expect(text).toContain("Guidelines:");
      expect(text).toContain("Never claim an action succeeded without a result.");
    }
  });

  it("does not describe the projection it is not serving", () => {
    // The regression in one line: whatever else changes, meta must never ship
    // the `view_`/`domain_` naming that sent the model looking for it.
    expect(assistantInstructions("meta")).not.toContain('Tools prefixed "view_"');
  });
});
