import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentTestRuntime } from "@orpc-agent/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { capabilities, governance } from "@/server/agent/runtime";
import { createContextForSession } from "@/server/orpc/context";
import { DEMO_USERS } from "@/server/auth/session";
import { getDeviceStore } from "@/server/db/store";

/**
 * Domain-plane governance tests — deterministic, no model, no HTTP. The REAL
 * capability registry and policies run over the real store (isolated to a
 * temp directory), through orpc-agent's test runtime.
 */

process.env.DPAS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "dpas-domain-test-"));

const operatorContext = () => createContextForSession(DEMO_USERS.operator);
const viewerContext = () => createContextForSession(DEMO_USERS.viewer);

beforeEach(() => {
  getDeviceStore().reset();
});

function runtimeFor(role: "operator" | "viewer") {
  return {
    runtime: createAgentTestRuntime({
      registry: capabilities,
      policies: [...governance.policies],
      actor: { id: DEMO_USERS[role].userId, kind: "user" },
      context: role === "operator" ? operatorContext() : viewerContext(),
    }),
  };
}

describe("exposure is deny-by-default", () => {
  it("shows only read capabilities as direct model tools", async () => {
    const { runtime } = runtimeFor("operator");
    const descriptors = await runtime.describe("aiSdk");
    expect(descriptors.map((d) => d.id).sort()).toEqual(["devices.get", "devices.list"]);
  });

  it("excludes procedures without agent metadata entirely", () => {
    const excluded = capabilities.inspect().excluded.map((entry) => entry.path);
    expect(excluded).toContain("devices.reset");
  });

  it("never exposes devices.disable to the model loop — its only path is contextual", async () => {
    const { runtime } = runtimeFor("operator");
    const descriptors = await runtime.describe("aiSdk");
    expect(descriptors.map((d) => d.id)).not.toContain("devices.disable");
  });
});

describe("authority hides", () => {
  it("hides write capabilities from a viewer at discovery and denies at invocation", async () => {
    const { runtime } = runtimeFor("viewer");
    const descriptors = await runtime.describe("test");
    expect(descriptors.map((d) => d.id)).not.toContain("devices.disable");

    const result = await runtime.invoke("devices.disable", { deviceIds: ["d-mi-03"] });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      // Hidden and nonexistent look identical from outside (SI-8).
      expect(result.error.code).toBe("CAPABILITY_NOT_FOUND");
    }
  });
});

describe("execution through the governed pipeline", () => {
  it("lists devices with validated filters", async () => {
    const { runtime } = runtimeFor("operator");
    const result = await runtime.invoke<{ devices: unknown[]; total: number }>("devices.list", {
      status: "offline",
      city: "Milan",
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output.total).toBe(3);
    }
  });

  it("rejects invalid input before the handler runs", async () => {
    const { runtime } = runtimeFor("operator");
    const result = await runtime.invoke("devices.list", { status: "sideways" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INPUT_INVALID");
    }
  });

  it("disables devices for an operator and writes the authoritative audit record", async () => {
    const { runtime } = runtimeFor("operator");
    const result = await runtime.invoke<{ disabled: number }>("devices.disable", {
      deviceIds: ["d-mi-03", "d-mi-05"],
      reason: "test sweep",
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output.disabled).toBe(2);
    }
    expect(getDeviceStore().get("d-mi-03")?.disabled).toBe(true);

    const domainAudit = operatorContext()
      .audit.entries()
      .filter((entry) => entry.type === "devices.disabled");
    expect(domainAudit.length).toBeGreaterThan(0);
  });

  it("surfaces unknown device ids as a typed domain error", async () => {
    const { runtime } = runtimeFor("operator");
    const result = await runtime.invoke("devices.disable", { deviceIds: ["ghost-1"] });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("EXECUTION_FAILED");
      expect(result.error.publicMessage).toContain("do not exist");
    }
  });

  it("emits governance audit events for the run", async () => {
    const { runtime } = runtimeFor("operator");
    await runtime.invoke("devices.list", {});
    const types = runtime.audit.types();
    expect(types).toContain("capability.requested");
    expect(types).toContain("capability.started");
    expect(types).toContain("capability.completed");
  });
});
