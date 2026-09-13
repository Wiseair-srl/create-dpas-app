import { expect, it, vi } from "vitest";
import {
  createMemorySurfaceCallStore,
  createSurfaceHost,
  type SurfaceCall,
  type SurfaceResult,
} from "./surface.js";

const call: SurfaceCall = {
  protocolVersion: 1,
  type: "surface-call",
  identity: { appId: "app", buildId: "build", sessionId: "session", tabId: "tab" },
  connectionId: "connection",
  runId: "run",
  toolCallId: "tool",
  invocation: {
    invocationId: "invocation",
    capabilityId: "view:selection",
    registrationId: "registration",
    surfaceVersion: "v1",
  },
};
const result: SurfaceResult = {
  protocolVersion: 1,
  type: "surface-result",
  identity: call.identity,
  connectionId: call.connectionId,
  runId: call.runId,
  toolCallId: call.toolCallId,
  invocationId: call.invocation.invocationId,
  result: { status: "success" },
};

it("correlates browser results after host replacement and accepts exact duplicates", async () => {
  const store = createMemorySurfaceCallStore();
  const authorizeCall = vi.fn();
  await createSurfaceHost({ store, authorizeCall }).dispatch(call, "session");
  const replacement = createSurfaceHost({ store, authorizeCall });
  expect(await replacement.acceptResult(result, "session")).toEqual(result);
  expect(await replacement.acceptResult(result, "session")).toEqual(result);
  expect(authorizeCall).toHaveBeenCalledTimes(3);
});

it("rejects unknown, conflicting, wrong-tab, wrong-user and moved pending calls", async () => {
  const host = createSurfaceHost({
    store: createMemorySurfaceCallStore(),
    authorizeCall: () => {},
  });
  await expect(host.acceptResult(result, "session")).rejects.toThrow("Unknown");
  await host.dispatch(call, "session");
  await expect(
    host.acceptResult({ ...result, identity: { ...result.identity, tabId: "other" } }, "session"),
  ).rejects.toThrow("does not match");
  await expect(host.acceptResult(result, "other-session")).rejects.toThrow("authenticated");
  await expect(host.dispatch({ ...call, connectionId: "reconnected" }, "session")).rejects.toThrow(
    "cannot move",
  );
  await host.acceptResult(result, "session");
  await expect(
    host.acceptResult({ ...result, result: { status: "changed" } }, "session"),
  ).rejects.toThrow("Conflicting");
});

it("requires successful server artifact/connection authorization", async () => {
  const host = createSurfaceHost({
    store: createMemorySurfaceCallStore(),
    authorizeCall: () => {
      throw new Error("unknown build");
    },
  });
  await expect(host.dispatch(call, "session")).rejects.toThrow("unknown build");
});

it("accepts the original mutation result after navigation changes its surface", async () => {
  let currentVersion = "v1";
  const host = createSurfaceHost({
    store: createMemorySurfaceCallStore(),
    authorizeCall: (pending, _session, phase) => {
      if (phase === "dispatch" && pending.invocation.surfaceVersion !== currentVersion)
        throw new Error("stale");
    },
  });
  await host.dispatch(call, "session");
  currentVersion = "v2";
  expect(await host.acceptResult(result, "session")).toEqual(result);
});
