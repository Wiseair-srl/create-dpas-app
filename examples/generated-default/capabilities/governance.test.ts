import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// The store reads this at first access, so it has to be set before anything
// imports it — a test that seeds the developer's own .data/ is a test that
// deletes their work.
process.env.DPAS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "dpas-governance-"));

const { resetStore, getInvoiceRow } = await import("../server/db");
const { runtime } = await import("../server/runtime");
const { contextFor } = await import("./base");
const { DEMO_USERS } = await import("../server/auth");
const { actorFor } = await import("../server/runtime");

/**
 * Domain-plane governance, deterministically and without a model.
 *
 * These are the tests worth copying into your own app: they assert the three
 * things the architecture actually promises — exposure is deny-by-default,
 * authority HIDES rather than refuses, and a consequential capability cannot
 * be reached from a model loop without a human deciding.
 */

const controller = {
  actor: actorFor(DEMO_USERS.controller),
  context: contextFor(DEMO_USERS.controller),
};
const analyst = {
  actor: actorFor(DEMO_USERS.analyst),
  context: contextFor(DEMO_USERS.analyst),
};

beforeEach(() => {
  resetStore();
});

describe("exposure is deny-by-default", () => {
  it("hides the contextual capability from the model loop but keeps it on MCP", async () => {
    const modelTools = await runtime.describe("aiSdk", controller);
    const mcpTools = await runtime.describe("mcp", controller);

    // `update-collection-status` is aiSdk:false — the in-app agent must come
    // through the live screen, where its input is bound to the open invoice.
    expect(modelTools.map((t) => t.id)).not.toContain("update-collection-status");
    // An MCP client has no screen to bind to, so it keeps the direct path.
    expect(mcpTools.map((t) => t.id)).toContain("update-collection-status");
  });

  it("offers every read to the model", async () => {
    const ids = (await runtime.describe("aiSdk", controller)).map((t) => t.id);
    expect(ids).toContain("list-invoices");
    expect(ids).toContain("collections-aging");
    expect(ids).toContain("receivables-summary");
    expect(ids).toContain("list-clients");
  });
});

describe("authority hides", () => {
  it("removes writes from the analyst's catalog entirely", async () => {
    const ids = (await runtime.describe("aiSdk", analyst)).map((t) => t.id);
    expect(ids).toContain("list-invoices");
    expect(ids).not.toContain("issue-invoice");
    expect(ids).not.toContain("delete-invoice");
    expect(ids).not.toContain("create-invoice");
  });

  it("reports a hidden capability as NOT FOUND, not as forbidden", async () => {
    const result = await runtime.invoke("issue-invoice", { id: 5 }, { ...analyst, surface: "direct" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      // Hidden and nonexistent must look identical from outside: "forbidden"
      // tells a probing caller that the capability is real and worth attacking.
      expect(result.error.code).toBe("CAPABILITY_NOT_FOUND");
    }
  });
});

describe("gate for consequence", () => {
  it("suspends a model-initiated issue into an approval, changing nothing yet", async () => {
    const before = getInvoiceRow(5);
    expect(before?.status).toBe("draft");

    const result = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "aiSdk" });
    expect(result.status).toBe("approval-required");
    // The ledger has not moved. An approval that acts first and asks second is
    // not an approval.
    expect(getInvoiceRow(5)?.status).toBe("draft");
  });

  it("executes once the human approves, and the invoice is issued", async () => {
    const pending = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "aiSdk" });
    if (pending.status !== "approval-required") throw new Error("expected an approval");

    await runtime.approvals.decide(pending.approval.id, {
      status: "approved",
      approver: controller.actor,
    });
    const resumed = await runtime.resume(pending.approval.id, { context: controller.context });

    expect(resumed.status).toBe("completed");
    expect(getInvoiceRow(5)?.status).toBe("sent");
  });

  it("conceals a relayed resume bound to another requester", async () => {
    const pending = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "aiSdk" });
    if (pending.status !== "approval-required") throw new Error("expected an approval");
    await runtime.approvals.decide(pending.approval.id, {
      status: "approved",
      approver: controller.actor,
    });

    // What an adapter-relayed resume passes (the MCP `approvals_resume` tool
    // sends the session's actor and its surface). The record belongs to the
    // controller's aiSdk loop; this caller claims neither.
    const relayed = await runtime.resume(pending.approval.id, {
      context: analyst.context,
      expectedActor: analyst.actor,
      expectedSurface: "mcp",
    });

    expect(relayed.status).toBe("failed");
    if (relayed.status === "failed") {
      // In-process the real code is visible; over any adapter it serializes
      // byte-identical to an unknown id, so probing with guessed ids learns
      // nothing — not even that the record exists.
      expect(relayed.error.code).toBe("APPROVAL_RESUME_MISMATCH");
      expect(relayed.error.publicMessage).toBe("The operation failed.");
    }
    expect(getInvoiceRow(5)?.status).toBe("draft");

    // The failed relay consumed nothing: the rightful resume still executes.
    const resumed = await runtime.resume(pending.approval.id, { context: controller.context });
    expect(resumed.status).toBe("completed");
    expect(getInvoiceRow(5)?.status).toBe("sent");
  });

  it("changes nothing when the human rejects", async () => {
    const pending = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "aiSdk" });
    if (pending.status !== "approval-required") throw new Error("expected an approval");

    await runtime.approvals.decide(pending.approval.id, {
      status: "rejected",
      approver: controller.actor,
    });

    expect(getInvoiceRow(5)?.status).toBe("draft");
  });

  it("lets the SAME operation through ungated on the direct surface", async () => {
    // A person clicking the button in their own session has already expressed
    // intent. One implementation, two callers, and the difference between them
    // is a policy input rather than a second code path.
    const result = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "direct" });
    expect(result.status).toBe("completed");
    expect(getInvoiceRow(5)?.status).toBe("sent");
  });
});

describe("the handler still owns its own rules", () => {
  it("refuses to issue an invoice that is not a draft", async () => {
    await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "direct" });
    const again = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "direct" });
    expect(again.status).toBe("failed");
    if (again.status === "failed") {
      expect(again.error.publicMessage).toContain("already");
    }
  });

  it("validates input before the handler runs", async () => {
    const result = await runtime.invoke(
      "issue-invoice",
      { id: "five" },
      { ...controller, surface: "direct" },
    );
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error.code).toBe("INPUT_INVALID");
  });
});
