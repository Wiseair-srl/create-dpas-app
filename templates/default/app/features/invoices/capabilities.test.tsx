import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSurfaceRoot } from "@/agent/surface/wiring";
import {
  getSurfaceRegistry,
  resetSurfaceForTests,
  setDomainClientFactoryForTests,
  setSurfaceEnvironmentForTests,
} from "@/agent/surface/registry";
import { orpc } from "@/lib/rpc";
import { seed } from "../../../server/db/seed";
import { PendingInvoices } from "./PendingInvoices";

/**
 * Presentation-plane contract tests — no LLM, no server, no network.
 *
 * The REAL screen mounts against a real registry, and a captured fake stands in
 * for the oRPC transport at the exact seam where HTTP would begin. What these
 * assert is the thing a snapshot cannot: that the agent-facing surface of this
 * screen behaves the way its description promises.
 */

const USER = { email: "carla@example.com", name: "Carla Controller", role: "controller" as const };

/** The seeded ledger, joined the way the server would return it. */
function pendingRows() {
  const data = seed(new Date("2026-08-02T12:00:00Z"));
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  return data.invoices
    .filter((invoice) => invoice.status === "sent")
    .map((invoice) => {
      const client = clients.get(invoice.client_id)!;
      const due = Date.parse(`${invoice.due_date}T00:00:00Z`);
      const asOf = Date.parse("2026-08-02T00:00:00Z");
      return {
        ...invoice,
        client_name: client.name,
        segment: client.segment,
        days_overdue: Math.max(0, Math.round((asOf - due) / 86_400_000)),
        collection: null,
      };
    });
}

const chaseCalls: Array<{ input: unknown; context: unknown }> = [];

function mount(): Promise<RenderedAgentSurface> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seed the cache directly: the screen's job here is the SURFACE it registers,
  // and a test that also exercises fetch is a test that fails for two reasons.
  // The key comes from the same util the hook uses — hand-writing it is how a
  // test ends up asserting against an empty table it seeded into the void.
  queryClient.setQueryData(
    orpc["list-invoices"].queryOptions({ input: { kind: "pending" } }).queryKey,
    pendingRows(),
  );

  return renderAgentSurface(<PendingInvoices />, {
    // The APP's registry, not a fresh one: it is the only one with the oRPC
    // procedure executor installed, and the contextual binding under test is
    // exactly the thing that needs it.
    registry: getSurfaceRegistry(),
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/receivables/pending"]}>
          <AgentSurfaceRoot user={USER}>{children}</AgentSurfaceRoot>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  chaseCalls.length = 0;
  resetSurfaceForTests();
  setSurfaceEnvironmentForTests("test");
  setDomainClientFactoryForTests(() => ({
    "update-collection-status": async (input, options) => {
      chaseCalls.push({ input, context: options?.context });
      return {
        invoice_id: input.invoiceId,
        last_reminder_date: null,
        reminders_sent: 1,
        expected_payment_date: null,
        note: null,
      };
    },
  }));
});

afterEach(() => {
  resetSurfaceForTests();
  vi.restoreAllMocks();
});

describe("the pending-invoices screen registers a usable surface", () => {
  it("exposes read, narrow, sort and select — and nothing that clicks", async () => {
    const surface = await mount();

    expect(surface).toExpose("view:invoices.pending.readState");
    expect(surface).toExpose("view:invoices.pending.readFilters");
    expect(surface).toExpose("view:invoices.pending.setFilters");
    expect(surface).toExpose("view:invoices.pending.clearFilters");
    expect(surface).toExpose("view:invoices.pending.sort");
    expect(surface).toExpose("view:invoices.pending.selectRows");

    // The whole point of a semantic plane: there is no DOM verb anywhere.
    const ids = surface.snapshot().components.flatMap((c) => [
      ...c.observations.map((o) => o.capabilityId),
      ...c.actions.map((a) => a.capabilityId),
    ]);
    expect(ids.some((id) => /click|type|focus|selector|element/i.test(id))).toBe(false);
  });

  it("reads the visible rows, and reports what it narrowed away", async () => {
    const surface = await mount();
    const before = await surface.observe<{ rowCount: number; totalRows?: number }>(
      "view:invoices.pending.readState",
    );
    expect(before.rowCount).toBe(13);

    expect(await surface.invoke("view:invoices.pending.setFilters", { due: "overdue" })).toBeOk();

    const after = await surface.observe<{ rowCount: number; totalRows?: number }>(
      "view:invoices.pending.readState",
    );
    expect(after.rowCount).toBe(7);
    // `totalRows` is what makes the narrowing legible: 7 alone could be the
    // whole ledger, and a model that cannot tell will not think to widen.
    expect(after.totalRows).toBe(13);
  });

  it("rejects an unknown filter key against the declared schema", async () => {
    const surface = await mount();
    const result = await surface.invoke("view:invoices.pending.setFilters", { nope: "1" });
    // The contract lists this table's filter keys with `additionalProperties:
    // false`, so an unknown key never reaches a handler — and the model can
    // read the valid keys off the schema rather than discovering them from a
    // rejection. Under the pre-contract surface this was a runtime
    // precondition built from whatever the screen happened to pass.
    expect(result).toFailWith("INVALID_INPUT");
  });

  it("refuses to select a row the filters are hiding", async () => {
    const surface = await mount();
    await surface.invoke("view:invoices.pending.setFilters", { due: "overdue" });
    const hidden = pendingRows().find((row) => row.days_overdue === 0)!;

    const result = await surface.invoke("view:invoices.pending.selectRows", { ids: [hidden.id] });
    // A row the user cannot see is not a row the agent may act on.
    expect(result).toFailWith("PRECONDITION_FAILED");
  });
});

describe("the contextual reference: domain:update-collection-status", () => {
  it("is present but unavailable until a chase dialog is open", async () => {
    const surface = await mount();
    expect(surface).toExposeUnavailable("domain:update-collection-status", {
      reason: "Open an invoice's chase dialog first",
    });
    // Present-and-unavailable is planning fuel; absent would be a dead end.
    const result = await surface.invoke("domain:update-collection-status", {});
    expect(result).toFailWith("CAPABILITY_NOT_AVAILABLE");
  });

  it("does not accept an invoiceId from the model — the field is not in the schema", async () => {
    const surface = await mount();
    const procedure = surface
      .snapshot()
      .procedures.find((p) => p.procedureId === "domain:update-collection-status");

    expect(procedure).toBeDefined();
    // Bound keys are REMOVED from the advertised schema. The model is not asked
    // to leave the invoice alone; it is given no field in which to name one.
    expect(procedure!.boundFields.map((f) => f.path)).toContain("invoiceId");
    expect(procedure!.boundFields.find((f) => f.path === "invoiceId")?.locked).toBe(true);
  });
});
