import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { encodeWireName } from "@agent-surface/core";
import { afterEach, describe, expect, it } from "vitest";
import { capabilities } from "@/server/agent/runtime";
import { createFixture, FixturePage, FixtureProviders } from "@/test/devices-fixture";
import { findCatalogCollisions } from "./catalog";
import { CATALOG_LIMITS } from "./protocol";
import { scopeForRoute } from "./scope";
import { domainToolName } from "./wire-names";

/** Routes that mount the assistant. Keep in step with `scope.ts`. */
const ROUTES_WITH_SCOPE = ["/dashboard"] as const;

/**
 * W5 — static catalog guards, run against the SHIPPED configuration rather
 * than fixtures. These are the problems that are cheaper to catch at build
 * time than at runtime, and that get likelier as an application grows:
 *
 *   - a capability reaching the model through two paths at once, which today
 *     is a runtime 409 on a live turn;
 *   - a wire name that collides with another once encoded;
 *   - a catalog whose cost has quietly doubled.
 */

let fixture: ReturnType<typeof createFixture> | undefined;
let surface: RenderedAgentSurface | undefined;

afterEach(() => {
  surface?.dispose();
  surface = undefined;
  fixture?.cleanup();
  fixture = undefined;
});

async function mountSurface() {
  fixture = createFixture();
  surface = await renderAgentSurface(<FixturePage />, {
    registry: fixture.registry,
    wrapper: ({ children }) => <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>,
  });
  return surface;
}

/** Every domain capability this application exposes to the model surface. */
function domainCapabilityIds(): string[] {
  return capabilities
    .capabilities()
    .filter((capability) => capability.meta.expose?.aiSdk === true)
    .map((capability) => `domain:${capability.id}`);
}

/** Everything the mounted surface declares, both planes. */
function surfaceCapabilityIds(snapshot: ReturnType<RenderedAgentSurface["snapshot"]>): string[] {
  const ids: string[] = [];
  for (const component of snapshot.components) {
    for (const obs of component.observations) ids.push(obs.capabilityId);
    for (const act of component.actions) ids.push(act.capabilityId);
  }
  for (const proc of snapshot.procedures) ids.push(proc.procedureId);
  return ids;
}

describe("catalog guards · duplicate paths", () => {
  it("exposes no capability through both a direct server tool and the surface", async () => {
    const snapshot = (await mountSurface()).snapshot();

    // The real check the runtime performs per step (§4.3), hoisted to build
    // time so a double-exposure fails a PR instead of a user's turn.
    const collisions = findCatalogCollisions(
      surfaceCapabilityIds(snapshot).map((canonicalId) => ({ canonicalId })),
      domainCapabilityIds(),
    );

    expect(collisions).toEqual([]);
  });
});

describe("catalog guards · wire names", () => {
  it("encodes every shipped capability within the 64-character wire limit", async () => {
    const snapshot = (await mountSurface()).snapshot();
    const names = [
      ...surfaceCapabilityIds(snapshot).map((id) => encodeWireName(id)),
      ...domainCapabilityIds().map((id) => encodeWireName(id)),
    ];

    const tooLong = names.filter((name) => name.length > 64);
    expect(tooLong).toEqual([]);
  });

  it("assigns a distinct wire name to every shipped capability", async () => {
    const snapshot = (await mountSurface()).snapshot();
    // Domain names go through the host's own naming override, not the default.
    const names = [
      ...surfaceCapabilityIds(snapshot).map((id) => encodeWireName(id)),
      ...capabilities
        .capabilities()
        .filter((capability) => capability.meta.expose?.aiSdk === true)
        .map((capability) => domainToolName(capability.id)),
    ];

    const seen = new Map<string, number>();
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);

    expect(duplicates).toEqual([]);
  });
});

describe("catalog guards · route budget", () => {
  /**
   * Every route's worst-case catalog must fit the protocol's limits, so "this
   * new panel pushed the dashboard over the limit" fails a PR rather than a
   * user's turn. Worst case means every mounted view capability plus every
   * domain capability in the route's scope, all available at once.
   */
  it("keeps every route inside the protocol limits", async () => {
    const snapshot = (await mountSurface()).snapshot();
    const viewIds = surfaceCapabilityIds(snapshot);

    for (const route of ROUTES_WITH_SCOPE) {
      const scope = scopeForRoute(route);
      const domainInScope = capabilities
        .capabilities()
        .filter((capability) => capability.meta.expose?.aiSdk === true)
        .filter(
          (capability) =>
            scope.length === 0 ||
            (capability.meta.tags ?? []).some((tag) => (scope as readonly string[]).includes(tag)),
        );

      expect(viewIds.length).toBeLessThanOrEqual(CATALOG_LIMITS.maxFrontendTools);
      expect(domainInScope.length).toBeLessThanOrEqual(CATALOG_LIMITS.maxDomainTools);
      expect(viewIds.length + domainInScope.length).toBeLessThanOrEqual(
        CATALOG_LIMITS.maxTotalTools,
      );
    }
  });

  it("declares a scope for every route that mounts the assistant", () => {
    // A route the assistant runs on but the map does not name falls back to
    // the whole catalog — legal, but it should be a deliberate choice.
    for (const route of ROUTES_WITH_SCOPE) {
      expect(scopeForRoute(route).length).toBeGreaterThan(0);
    }
  });
});

describe("catalog guards · cost", () => {
  /**
   * Descriptions are model-visible text billed on every step, so catalog cost
   * is committed as a snapshot rather than a loose ceiling: a threshold with
   * headroom silently absorbs the doubling it is supposed to catch, while a
   * snapshot turns any change into a line in the diff. Update it deliberately,
   * and expect a reviewer to ask why it moved.
   */
  it("matches the committed tool-block size for the mounted route", async () => {
    const snapshot = (await mountSurface()).snapshot();

    let chars = 0;
    let count = 0;
    for (const component of snapshot.components) {
      for (const obs of component.observations) {
        chars += obs.capabilityId.length + obs.description.length;
        count += 1;
      }
      for (const act of component.actions) {
        chars += act.capabilityId.length + act.description.length;
        count += 1;
      }
    }
    for (const proc of snapshot.procedures) {
      chars += proc.procedureId.length + proc.description.length;
      count += 1;
    }

    expect({ capabilities: count, chars }).toMatchInlineSnapshot(`
      {
        "capabilities": 9,
        "chars": 727,
      }
    `);
  });
});
