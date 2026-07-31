import { createAgentToolset } from "@agent-surface/core";
import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, FixturePage, FixtureProviders } from "@/test/devices-fixture";
import { buildFrontendToolDescriptors } from "./catalog";
import { HOST_CONSUMER } from "./identity";
import { renderCapabilityState } from "./protocol";

/**
 * W2 — cache-stable descriptors (acceptance criterion 4).
 *
 * Tool definitions sit at the front of the provider prompt, so anything
 * volatile in them invalidates the cached prefix behind the whole conversation
 * on every step. The DPAS value proposition guarantees volatility: `available`
 * flips as the UI changes, and contextual bindings inject live text.
 *
 * The fix is not to make descriptions stale — it is to move the live half out
 * of the tool block and render it after the messages. These tests assert the
 * split holds where it matters: the same state change that must be visible to
 * the model must NOT touch the serialized tool block.
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

/** The host's own projection, exactly as `transport-client` builds it. */
function project(rendered: RenderedAgentSurface) {
  const toolset = createAgentToolset(fixture!.registry, {
    consumer: HOST_CONSUMER,
    topology: "remote",
    confirmations: "wait",
    descriptionIncludesState: false,
  });
  const projection = buildFrontendToolDescriptors(
    toolset,
    rendered.snapshot({ consumer: HOST_CONSUMER, includeUnavailable: true }),
  );
  toolset.dispose();
  return projection;
}

/** What actually reaches the provider as the tool block. */
const serializeToolBlock = (descriptors: unknown) => JSON.stringify(descriptors);

const MILAN_OFFLINE = ["d-mi-03", "d-mi-05", "d-mi-07"];

describe("cache stability · the tool block survives state changes", () => {
  it("stays byte-identical when availability flips", async () => {
    const rendered = await mount();

    // Step 1: nothing selected, so the destructive procedure is unavailable.
    const step1 = project(rendered);
    const disableBefore = step1.state.find((s) => s.wireName.startsWith("domain_devices__disable"));
    expect(disableBefore?.available).toBe(false);

    // A real state change the model must be told about.
    await rendered.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await rendered.invoke("view:devices.table.selectRows", {
      ids: MILAN_OFFLINE,
      mode: "replace",
    });

    const step2 = project(rendered);
    const disableAfter = step2.state.find((s) => s.wireName.startsWith("domain_devices__disable"));

    // The volatile half moved...
    expect(disableAfter?.available).toBe(true);
    expect(disableAfter?.available).not.toBe(disableBefore?.available);

    // ...and the tool block did not. This is the whole point: at 300
    // capabilities this converts the per-step tool definitions from full-rate
    // input into cache reads for every step after the first.
    expect(serializeToolBlock(step2.descriptors)).toBe(serializeToolBlock(step1.descriptors));
  });

  it("keeps a contextual binding's live text out of the tool block", async () => {
    const rendered = await mount();
    const before = project(rendered);

    await rendered.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await rendered.invoke("view:devices.table.selectRows", {
      ids: MILAN_OFFLINE,
      mode: "replace",
    });
    const after = project(rendered);

    // The note is live text — it names the current selection count.
    const noteBefore = before.state.find((s) => s.note)?.note;
    const noteAfter = after.state.find((s) => s.note)?.note;
    expect(noteBefore).toBeDefined();
    expect(noteAfter).toBeDefined();
    expect(noteAfter).not.toBe(noteBefore);

    // No descriptor description carries it, in either step.
    for (const descriptor of [...before.descriptors, ...after.descriptors]) {
      expect(descriptor.description).not.toMatch(/currently bound to/i);
      expect(descriptor.description).not.toMatch(/currently unavailable/i);
    }
  });

  it("carries no live state on the descriptor at all", async () => {
    const rendered = await mount();
    const { descriptors } = project(rendered);

    // v2 leaves these unset; they exist on the schema only for v1.
    for (const descriptor of descriptors) {
      expect(descriptor.available).toBeUndefined();
      expect(descriptor.unavailableReason).toBeUndefined();
    }
  });
});

describe("cache stability · the volatile block stays honest", () => {
  it("names what is unavailable and why", async () => {
    const rendered = await mount();
    const { descriptors, state } = project(rendered);
    const block = renderCapabilityState(state, descriptors);

    expect(block).toBeDefined();
    expect(block).toContain("domain:devices.disable");
    expect(block).toMatch(/unavailable: .*select at least one device/i);
  });

  it("reports the live binding once rows are selected", async () => {
    const rendered = await mount();
    await rendered.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await rendered.invoke("view:devices.table.selectRows", {
      ids: MILAN_OFFLINE,
      mode: "replace",
    });

    const { descriptors, state } = project(rendered);
    const block = renderCapabilityState(state, descriptors);
    expect(block).toContain("domain:devices.disable");
    expect(block).toMatch(/3 selected device/i);
  });

  it("costs nothing when there is nothing to say", () => {
    // A fully-available catalog with no contextual notes adds no tokens.
    expect(
      renderCapabilityState(
        [{ wireName: "view_a", available: true }],
        [
          {
            wireName: "view_a",
            canonicalId: "view:a",
            plane: "view",
            description: "d",
            inputSchema: {},
            effect: "read",
            confirmation: "never",
          },
        ],
      ),
    ).toBeUndefined();
  });
});
