import { ORPCError, os } from "@orpc/server";
import { agentProcedure } from "@orpc-agent/core";
import { z } from "zod";
import {
  DeviceListFilterSchema,
  DeviceListOutputSchema,
  DeviceSchema,
  DisableDevicesInputSchema,
  DisableDevicesOutputSchema,
} from "@/features/devices/schemas/device";
import type { AppContext } from "./context";

/**
 * The domain plane. These oRPC procedures are the ONLY implementation of
 * device operations — the dashboard UI, the agent (directly or contextually)
 * and the tests all call the same code under the same authorization.
 *
 * Agent exposure is declared per procedure via `meta.agent` (deny-by-default):
 *  - `devices.list` / `devices.get`  → direct server tools for the model loop.
 *  - `devices.disable`               → `expose.aiSdk: false`. Its only
 *    model-visible path is the contextual Agent Surface reference, which binds
 *    the current selection and requires confirmation. One operation, one path.
 */

const base = agentProcedure(os.$context<AppContext>());

const authed = base.use(({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in required." });
  }
  return next({ context: { ...context, session: context.session } });
});

const operatorOnly = authed.use(({ context, next }) => {
  if (context.session.role !== "operator") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only operators can modify devices.",
    });
  }
  return next();
});

export const listDevices = authed
  .meta({
    agent: {
      description:
        "List devices, optionally filtered by status (online/offline), city, or disabled flag. Read-only.",
      expose: { aiSdk: true, test: true },
      tags: ["devices"],
      sideEffect: "read",
      risk: "low",
    },
  })
  .input(DeviceListFilterSchema)
  .output(DeviceListOutputSchema)
  .handler(({ input, context }) => {
    const devices = context.devices.list(input);
    return { devices, total: devices.length };
  });

export const getDevice = authed
  .meta({
    agent: {
      description: "Fetch one device by id, including firmware and last-seen time. Read-only.",
      expose: { aiSdk: true, test: true },
      tags: ["devices"],
      sideEffect: "read",
      risk: "low",
    },
  })
  .errors({
    DEVICE_NOT_FOUND: { message: "No device with that id exists." },
  })
  .input(z.object({ deviceId: z.string().describe("Device id, e.g. d-mi-01") }))
  .output(DeviceSchema)
  .handler(({ input, context, errors }) => {
    const device = context.devices.get(input.deviceId);
    if (!device) throw errors.DEVICE_NOT_FOUND();
    return device;
  });

export const disableDevices = operatorOnly
  .meta({
    agent: {
      // aiSdk exposure is deliberately false: exposing this directly to the
      // model AND contextually through Agent Surface would create two paths
      // for one operation (forbidden — see docs/security-and-confirmation.md).
      description: "Disable the given devices. Destructive: they stop reporting data.",
      expose: { aiSdk: false, test: true },
      tags: ["devices"],
      sideEffect: "destructive",
      risk: "high",
    },
  })
  .errors({
    DEVICE_NOT_FOUND: { message: "One or more devices do not exist." },
  })
  .input(DisableDevicesInputSchema)
  .output(DisableDevicesOutputSchema)
  .handler(({ input, context, errors }) => {
    const missing = input.deviceIds.filter((id) => !context.devices.get(id));
    if (missing.length > 0) {
      throw errors.DEVICE_NOT_FOUND({ data: { missing } });
    }
    const updated = context.devices.disable(input.deviceIds, {
      by: context.session.userId,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    // Authoritative domain audit. agentCall metadata is untrusted correlation
    // context from the browser host — recorded, never used for authorization.
    context.audit.record({
      source: "domain",
      type: "devices.disabled",
      actorId: context.session.userId,
      capabilityId: "domain:devices.disable",
      ...(context.agentCall?.invocationId
        ? { correlationId: context.agentCall.invocationId }
        : {}),
      data: {
        deviceIds: input.deviceIds,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(context.agentCall?.confirmationId
          ? { confirmationId: context.agentCall.confirmationId }
          : {}),
        via: context.agentCall?.invocationId ? "agent" : "ui",
      },
    });
    return { disabled: updated.length, devices: updated };
  });

export const enableDevices = operatorOnly
  .meta({
    agent: {
      // Human-only undo path: not exposed on any agent surface (test only).
      description: "Re-enable previously disabled devices.",
      expose: { test: true },
      tags: ["devices"],
      sideEffect: "write",
      risk: "medium",
    },
  })
  .input(z.object({ deviceIds: z.array(z.string()).min(1) }))
  .output(DisableDevicesOutputSchema)
  .handler(({ input, context }) => {
    const updated = context.devices.enable(input.deviceIds, {
      by: context.session.userId,
    });
    context.audit.record({
      source: "domain",
      type: "devices.enabled",
      actorId: context.session.userId,
      data: { deviceIds: input.deviceIds },
    });
    return { disabled: updated.length, devices: updated };
  });

// No `meta.agent` → invisible to every agent surface (excluded from the
// capability registry). Demo convenience for resetting the seeded data.
export const resetDevices = authed
  .input(z.object({}).optional())
  .output(z.object({ ok: z.boolean() }))
  .handler(({ context }) => {
    context.devices.reset();
    context.audit.record({
      source: "domain",
      type: "devices.reset",
      actorId: context.session.userId,
    });
    return { ok: true };
  });
