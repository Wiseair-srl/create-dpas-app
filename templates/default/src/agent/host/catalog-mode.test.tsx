import { createAgentToolset } from "@agent-surface/core";
import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, FixturePage, FixtureProviders } from "@/test/devices-fixture";
import { buildFrontendToolDescriptors } from "./catalog";
import { HOST_CONSUMER } from "./identity";
import type { CatalogMode } from "./catalog-mode";
import { canonicalIdOfCall, isMetaToolName } from "./wire-names";

/**
 * W3 — the two projections, over the SAME registry and the same capabilities.
 *
 * The point of having both is that neither changes the application: direct
 * hands the model a catalog, meta hands it three tools and lets it discover
 * one. What must not differ is authority, availability, or the audit identity
 * of what actually ran.
 */

let fixture: ReturnType<typeof createFixture> | undefined;
let surface: RenderedAgentSurface | undefined;

afterEach(() => {
  surface?.dispose();
  surface = undefined;
  fixture?.cleanup();
  fixture = undefined;
});

async function mount() {
  fixture = createFixture();
  surface = await renderAgentSurface(<FixturePage />, {
    registry: fixture.registry,
    wrapper: ({ children }) => <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>,
  });
  return surface;
}

function project(rendered: RenderedAgentSurface, mode: CatalogMode) {
  const toolset = createAgentToolset(fixture!.registry, {
    consumer: HOST_CONSUMER,
    topology: "remote",
    confirmations: "wait",
    descriptionIncludesState: false,
    mode,
  });
  const projection = buildFrontendToolDescriptors(
    toolset,
    rendered.snapshot({ consumer: HOST_CONSUMER, includeUnavailable: true }),
    mode,
  );
  toolset.dispose();
  return projection;
}

describe("catalog mode · the same capabilities, two projections", () => {
  it("projects one tool per capability in direct mode", async () => {
    const { descriptors, undecodable } = project(await mount(), "direct");

    expect(undecodable).toEqual([]);
    expect(descriptors.length).toBeGreaterThan(3);
    expect(descriptors.map((d) => d.canonicalId)).toContain("view:devices.table.selectRows");
    expect(descriptors.map((d) => d.canonicalId)).toContain("domain:devices.disable");
  });

  it("projects exactly three tools in meta mode, whatever the surface holds", async () => {
    const { descriptors, undecodable } = project(await mount(), "meta");

    expect(undecodable).toEqual([]);
    expect(descriptors.map((d) => d.wireName).sort()).toEqual([
      "surface_act",
      "surface_discover",
      "surface_read",
    ]);
  });

  it("does not withhold the meta tools despite an empty wire-name map", async () => {
    // Regression: `wireNameMap()` is empty in meta mode because the three tool
    // names are not capability ids. The §4.4 withholding rule is about
    // capabilities whose identity could not be established — applying it here
    // would strip the entire catalog and leave the model with nothing.
    const { descriptors, undecodable } = project(await mount(), "meta");
    expect(descriptors).toHaveLength(3);
    expect(undecodable).toEqual([]);
  });

  it("keeps the tool block constant-size across a state change in meta mode", async () => {
    const rendered = await mount();
    const before = project(rendered, "meta");

    await rendered.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await rendered.invoke("view:devices.table.selectRows", {
      ids: ["d-mi-03", "d-mi-05", "d-mi-07"],
      mode: "replace",
    });
    const after = project(rendered, "meta");

    expect(JSON.stringify(after.descriptors)).toBe(JSON.stringify(before.descriptors));
    expect(after.descriptors).toHaveLength(3);
  });
});

describe("catalog mode · audit identity survives meta", () => {
  it("reads the operation from the call, not the tool name", () => {
    // Direct mode: the wire name IS the capability, so the map answers.
    expect(
      canonicalIdOfCall("view_devices__table__selectRows", {}, "view:devices.table.selectRows"),
    ).toBe("view:devices.table.selectRows");

    // Meta mode: recording `surface_act` would collapse every action in the
    // application into one audit identity (invariant 8).
    expect(
      canonicalIdOfCall("surface_act", { capabilityId: "domain:devices.disable" }, undefined),
    ).toBe("domain:devices.disable");
    expect(canonicalIdOfCall("surface_read", { capabilityId: "view:devices.table.readState" }, undefined)).toBe(
      "view:devices.table.readState",
    );
  });

  it("names the meta tool itself when a call carries no target", () => {
    // Such a call cannot reach a capability, so there is nothing else it could
    // honestly be attributed to.
    expect(canonicalIdOfCall("surface_discover", {}, undefined)).toBe("meta:surface_discover");
    expect(canonicalIdOfCall("surface_act", { capabilityId: 42 }, undefined)).toBe(
      "meta:surface_act",
    );
    expect(canonicalIdOfCall("surface_act", undefined, undefined)).toBe("meta:surface_act");
  });

  it("recognises exactly the three meta tools", () => {
    expect(isMetaToolName("surface_discover")).toBe(true);
    expect(isMetaToolName("surface_read")).toBe(true);
    expect(isMetaToolName("surface_act")).toBe(true);
    expect(isMetaToolName("view_devices__table__selectRows")).toBe(false);
    expect(isMetaToolName("domain_devices__list")).toBe(false);
  });
});
