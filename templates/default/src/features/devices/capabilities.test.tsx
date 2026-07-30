import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFixture,
  FixturePage,
  FixtureProviders,
} from "@/test/devices-fixture";

/**
 * Presentation-plane contract tests — no LLM, no network, no Next.js server.
 * The REAL feature components register against a real registry; a captured
 * fake stands in for the oRPC transport at the exact seam where HTTP begins.
 */

const MILAN_OFFLINE = ["d-mi-03", "d-mi-05", "d-mi-07"];

let fixture: ReturnType<typeof createFixture> | undefined;
let surface: RenderedAgentSurface | undefined;

afterEach(() => {
  surface?.dispose();
  surface = undefined;
  fixture?.cleanup();
  fixture = undefined;
});

async function mount(options?: Parameters<typeof createFixture>[0] & { strict?: boolean }) {
  fixture = createFixture(options);
  const page = <FixturePage />;
  surface = await renderAgentSurface(
    options?.strict ? <StrictMode>{page}</StrictMode> : page,
    {
      registry: fixture.registry,
      wrapper: ({ children }) => (
        <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>
      ),
    },
  );
  return { fixture, surface };
}

describe("capability discovery", () => {
  it("exposes the documented view capabilities while mounted", async () => {
    const { surface } = await mount();
    expect(surface).toExpose("view:devices.filters.read");
    expect(surface).toExpose("view:devices.filters.set");
    expect(surface).toExpose("view:devices.table.readState");
    expect(surface).toExpose("view:devices.table.selectRows");
    expect(surface).toExpose("view:devices.table.sort");
    expect(surface).toExpose("view:devices.drawer.open");
    // Closed drawer: close is visible but unavailable — state discloses.
    expect(surface).toExposeUnavailable("view:devices.drawer.close", {
      reason: "The drawer is not open",
    });
  });

  it("registers exactly once under React StrictMode double-mount", async () => {
    const { surface } = await mount({ strict: true });
    const snapshot = surface.snapshot();
    const tables = snapshot.components.filter((c) => c.type === "devices.table");
    expect(tables).toHaveLength(1);
    expect(surface).toExpose("view:devices.table.selectRows");
  });

  it("matches the committed semantic surface snapshot", async () => {
    const { surface } = await mount();
    expect(surface).toMatchSurfaceSnapshot();
  });
});

describe("view invocation", () => {
  it("sets filters semantically and the table follows the app's data flow", async () => {
    const { surface } = await mount();
    const result = await surface.invoke("view:devices.filters.set", {
      status: "offline",
      city: "Milan",
    });
    expect(result).toBeOk();
    expect(await surface.observe("view:devices.filters.read")).toEqual({
      status: "offline",
      city: "Milan",
    });
    const table = await surface.observe<{ visibleRows: Array<{ id: string }> }>(
      "view:devices.table.readState",
    );
    expect(table.visibleRows.map((row) => row.id)).toEqual(MILAN_OFFLINE);
  });

  it("rejects selecting rows that are not visible, with actionable details", async () => {
    const { surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    const result = await surface.invoke("view:devices.table.selectRows", {
      ids: ["d-rm-01"],
      mode: "replace",
    });
    expect(result).toFailWith("PRECONDITION_FAILED", { unknown: ["d-rm-01"] });
  });

  it("selects visible rows and reports the applied selection", async () => {
    const { surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    const result = await surface.invoke("view:devices.table.selectRows", {
      ids: MILAN_OFFLINE,
      mode: "replace",
    });
    expect(result).toBeOk();
    const table = await surface.observe<{ selectedIds: string[] }>(
      "view:devices.table.readState",
    );
    expect(table.selectedIds).toEqual(MILAN_OFFLINE);
  });

  it("sorts idempotently", async () => {
    const { surface } = await mount();
    const input = { column: "name", direction: "desc" } as const;
    expect(await surface.invoke("view:devices.table.sort", input)).toBeOk();
    expect(await surface.invoke("view:devices.table.sort", input)).toBeOk();
    const table = await surface.observe<{ sorting: unknown }>("view:devices.table.readState");
    expect(table.sorting).toEqual(input);
  });

  it("opens the drawer only for visible devices", async () => {
    const { surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    expect(
      await surface.invoke("view:devices.drawer.open", { deviceId: "d-rm-01" }),
    ).toFailWith("PRECONDITION_FAILED");
    expect(
      await surface.invoke("view:devices.drawer.open", { deviceId: "d-mi-03" }),
    ).toBeOk();
    expect(surface).toExpose("view:devices.drawer.close");
    expect(await surface.invoke("view:devices.drawer.close", {})).toBeOk();
  });

  it("validates input against the capability schema", async () => {
    const { surface } = await mount();
    const result = await surface.invoke("view:devices.filters.set", { status: "sideways" });
    expect(result).toFailWith("INVALID_INPUT");
  });
});

describe("lifecycle and staleness", () => {
  it("fails deterministically after unmount", async () => {
    const { surface } = await mount();
    surface.unmount();
    const result = await surface.invoke("view:devices.filters.set", { status: "offline" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(["COMPONENT_UNMOUNTED", "CAPABILITY_NOT_FOUND"]).toContain(result.error.code);
    }
  });

  it("rejects invocations that carry a stale registrationId", async () => {
    const { surface } = await mount();
    const stale = surface.captureRef("view:devices.table.selectRows");
    surface.rerender(
      <FixtureProviders user={fixture!.user}>
        <FixturePage key="remounted" />
      </FixtureProviders>,
    );
    const result = await surface.invoke(
      "view:devices.table.selectRows",
      { ids: [], mode: "replace" },
      { registrationId: stale.registrationId },
    );
    expect(result).toFailWith("STALE_CAPABILITY");
  });
});

describe("contextual domain reference: domain:devices.disable", () => {
  it("is hidden from the viewer's catalog, and force-calling it is denied", async () => {
    const { surface } = await mount({ role: "viewer" });
    // Authority hides: the capability is absent from every snapshot…
    expect(surface).not.toExpose("domain:devices.disable");
    // …and a consumer who guesses the id anyway is stopped by the
    // authorization policy once the state gate would otherwise pass.
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    const result = await surface.invoke("domain:devices.disable", {});
    expect(result).toFailWith("NOT_AUTHORIZED", { origin: "client" });
  });

  it("is visible but unavailable without a selection — state discloses", async () => {
    const { surface } = await mount();
    expect(surface).toExposeUnavailable("domain:devices.disable", {
      reason: "Select at least one device first",
    });
    const result = await surface.invoke("domain:devices.disable", {});
    expect(result).toFailWith("CAPABILITY_NOT_AVAILABLE");
  });

  it("binds the live selection, requires confirmation, and executes through oRPC with evidence", async () => {
    const { fixture, surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    expect(surface).toExpose("domain:devices.disable");

    const first = await surface.invoke("domain:devices.disable", {});
    expect(first).toFailWith("CONFIRMATION_REQUIRED");
    const pending = surface.confirmations.pending();
    expect(pending).toHaveLength(1);
    // The confirmation is bound to the EXACT effective input.
    expect(pending[0]!.input).toEqual({ deviceIds: MILAN_OFFLINE });

    surface.confirmations.approve();
    const confirmationId = pending[0]!.confirmationId;
    const second = await surface.invoke("domain:devices.disable", {}, { confirmationId });
    expect(second).toBeOk();

    expect(fixture.disableCalls).toHaveLength(1);
    expect(fixture.disableCalls[0]!.input.deviceIds).toEqual(MILAN_OFFLINE);
    // Correlation metadata rode the authenticated client call.
    expect(fixture.disableCalls[0]!.context).toMatchObject({
      agentInvocationId: expect.stringContaining(""),
      confirmation: { id: confirmationId },
    });
  });

  it("rejects model-supplied values for the locked bound field", async () => {
    const { surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    const result = await surface.invoke("domain:devices.disable", {
      deviceIds: ["d-rm-01"],
    });
    expect(result).toFailWith("INVALID_INPUT", { lockedFields: ["deviceIds"] });
  });

  it("treats denial as a terminal typed error and never calls the server", async () => {
    const { fixture, surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    const first = await surface.invoke("domain:devices.disable", {});
    expect(first).toFailWith("CONFIRMATION_REQUIRED");
    const confirmationId = surface.confirmations.pending()[0]!.confirmationId;
    surface.confirmations.deny(confirmationId, "user-declined");
    const second = await surface.invoke("domain:devices.disable", {}, { confirmationId });
    expect(second).toFailWith("CONFIRMATION_INVALID", { reason: "denied" });
    expect(fixture.disableCalls).toHaveLength(0);
  });

  it("rejects expired confirmations", async () => {
    const { surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    await surface.invoke("domain:devices.disable", {});
    const confirmationId = surface.confirmations.pending()[0]!.confirmationId;
    surface.confirmations.expire(confirmationId);
    const result = await surface.invoke("domain:devices.disable", {}, { confirmationId });
    expect(result).toFailWith("CONFIRMATION_INVALID", { reason: "expired" });
  });

  it("rejects approval evidence when the selection changed afterwards — no bait-and-switch", async () => {
    const { fixture, surface } = await mount();
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    await surface.invoke("domain:devices.disable", {});
    const confirmationId = surface.confirmations.pending()[0]!.confirmationId;
    surface.confirmations.approve(confirmationId);
    // The user (or the model) changes the selection AFTER approving.
    await surface.invoke("view:devices.table.selectRows", {
      ids: [MILAN_OFFLINE[0]!],
      mode: "replace",
    });
    const result = await surface.invoke("domain:devices.disable", {}, { confirmationId });
    expect(result).toFailWith("CONFIRMATION_INVALID", { reason: "mismatch" });
    expect(fixture.disableCalls).toHaveLength(0);
  });

  it("maps server authorization rejections to a typed, sanitized error", async () => {
    const { surface } = await mount({
      failDisableWith: () => Object.assign(new Error("nope"), { code: "FORBIDDEN" }),
    });
    await surface.invoke("view:devices.filters.set", { status: "offline", city: "Milan" });
    await surface.invoke("view:devices.table.selectRows", { ids: MILAN_OFFLINE, mode: "replace" });
    await surface.invoke("domain:devices.disable", {});
    const confirmationId = surface.confirmations.pending()[0]!.confirmationId;
    surface.confirmations.approve(confirmationId);
    const result = await surface.invoke("domain:devices.disable", {}, { confirmationId });
    expect(result).toFailWith("NOT_AUTHORIZED", { origin: "server" });
  });
});
