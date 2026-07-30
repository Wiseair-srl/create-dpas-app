import { AgentSurfaceProvider } from "@agent-surface/react";
import { render, cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runGuidedDemo } from "@/agent/demo/scenario";
import { useMessageStore } from "@/agent/experience/message-store";
import { getSurfaceRegistry } from "@/agent/surface/registry";
import { createFixture, FixturePage, FixtureProviders } from "@/test/devices-fixture";

/**
 * The deterministic golden scenario, end to end in jsdom: the demo runner
 * drives the REAL registry, toolset, confirmation controller and (captured)
 * oRPC seam — exactly the pipeline the browser uses. No model, no server.
 */

const MILAN_OFFLINE = ["d-mi-03", "d-mi-05", "d-mi-07"];

// This file simulates the REAL browser loop: the runner sleeps between steps
// and React commits on its own schedule, exactly as in production. act()
// semantics would batch everything into one commit and defeat the point.
beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
});

function currentEntries() {
  return useMessageStore.getState().entries;
}

function assistantTranscript(): string {
  return currentEntries()
    .filter((entry) => entry.kind === "assistant")
    .map((entry) => entry.text)
    .join("\n");
}

describe("guided demo (golden scenario)", () => {
  it("runs the full flow through real capabilities and reports the verified outcome", async () => {
    const fixture = createFixture();
    try {
      render(
        <AgentSurfaceProvider registry={fixture.registry}>
          <FixtureProviders user={fixture.user}>
            <FixturePage />
          </FixtureProviders>
        </AgentSurfaceProvider>,
      );
      useMessageStore.getState().reset();

      // Auto-approve the (real) confirmation when it appears.
      const registry = getSurfaceRegistry();
      const unsubscribe = registry.subscribe((event) => {
        if (event.type === "confirmation-requested") {
          const pending = registry.confirmations.pending()[0];
          if (pending) {
            expect(pending.input).toEqual({ deviceIds: MILAN_OFFLINE });
            registry.confirmations.resolve(pending.confirmationId, { approved: true });
          }
        }
      });

      await runGuidedDemo(new AbortController().signal);
      unsubscribe();

      // The mutation went through the captured oRPC seam with bound input
      // and correlation evidence.
      expect(fixture.disableCalls).toHaveLength(1);
      expect(fixture.disableCalls[0]!.input.deviceIds).toEqual(MILAN_OFFLINE);
      expect(fixture.disableCalls[0]!.context).toMatchObject({
        agentInvocationId: expect.stringMatching(/^demo_/),
        confirmation: { id: expect.stringMatching(/^cnf_/) },
      });

      // The transcript reports the verified outcome, not wishful thinking.
      expect(assistantTranscript()).toContain("the server disabled 3");

      // Tool entries cover the golden steps in order.
      const toolCalls = currentEntries()
        .filter((entry) => entry.kind === "tool")
        .map((entry) => entry.canonicalId);
      expect(toolCalls).toEqual([
        "view:devices.filters.set",
        "view:devices.table.readState",
        "view:devices.table.selectRows",
        "domain:devices.disable",
        "view:devices.table.readState",
      ]);
    } finally {
      fixture.cleanup();
    }
  }, 20_000);

  it("reports denial honestly and mutates nothing", async () => {
    const fixture = createFixture();
    try {
      render(
        <AgentSurfaceProvider registry={fixture.registry}>
          <FixtureProviders user={fixture.user}>
            <FixturePage />
          </FixtureProviders>
        </AgentSurfaceProvider>,
      );
      useMessageStore.getState().reset();

      const registry = getSurfaceRegistry();
      const unsubscribe = registry.subscribe((event) => {
        if (event.type === "confirmation-requested") {
          const pending = registry.confirmations.pending()[0];
          if (pending) {
            registry.confirmations.resolve(pending.confirmationId, {
              approved: false,
              reason: "user-declined",
            });
          }
        }
      });

      await runGuidedDemo(new AbortController().signal);
      unsubscribe();

      expect(fixture.disableCalls).toHaveLength(0);
      expect(assistantTranscript()).toContain("declined");
    } finally {
      fixture.cleanup();
    }
  }, 20_000);
});
