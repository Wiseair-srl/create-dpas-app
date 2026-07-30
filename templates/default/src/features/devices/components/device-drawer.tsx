"use client";

import { action, observation } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { z } from "zod";
import { zs } from "@/agent/surface/schema";
import { DrawerOpenSchema } from "@/features/devices/capabilities/schemas";
import type { Device } from "@/features/devices/schemas/device";
import { formatDateTime, relativeTime } from "@/lib/format";
import { StatusBadge } from "./status-badge";

/**
 * Device detail drawer. `view:devices.drawer.open` has a precondition (the
 * device must be visible under the current filters — the agent sees what the
 * user could click, nothing more) and `close` is only available while open:
 * availability IS the component state, disclosed to the agent.
 */

const DrawerStateSchema = z.object({
  openDeviceId: z.string().nullable(),
});

export function DeviceDrawer({
  devices,
  openDeviceId,
  onOpenChange,
  returnFocusTo,
}: {
  devices: Device[];
  openDeviceId: string | null;
  onOpenChange: (deviceId: string | null) => void;
  /**
   * The drawer is state-controlled (both humans and the agent open it), so
   * Radix has no Trigger to restore focus to. The opener captures the active
   * element; we put focus back there on close.
   */
  returnFocusTo?: () => HTMLElement | null;
}) {
  const device = devices.find((d) => d.id === openDeviceId) ?? null;

  useAgentComponent({
    type: "devices.drawer",
    description: "Detail drawer for a single device",
    observations: {
      readState: observation({
        description: "Which device the drawer is showing, if any",
        output: zs(DrawerStateSchema),
        read: () => ({ openDeviceId }),
      }),
    },
    actions: {
      open: action({
        description: "Open the detail drawer for a device visible in the table",
        input: zs(DrawerOpenSchema),
        effect: "local-state",
        precondition: ({ deviceId }) => {
          if (!devices.some((d) => d.id === deviceId)) {
            return {
              message: "That device is not visible under the current filters.",
              details: { deviceId },
            };
          }
          return undefined;
        },
        execute: ({ deviceId }) => onOpenChange(deviceId),
      }),
      close: action({
        description: "Close the detail drawer",
        input: zs(z.object({})),
        effect: "local-state",
        idempotent: true,
        when: () => openDeviceId !== null,
        unavailableReason: "The drawer is not open",
        execute: () => onOpenChange(null),
      }),
    },
  });

  return (
    <DialogPrimitive.Root
      open={device !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(null);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-2xl outline-none"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            const target = returnFocusTo?.();
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          {device ? (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <DialogPrimitive.Title className="font-mono text-sm font-semibold">
                    {device.name}
                  </DialogPrimitive.Title>
                  <p className="mt-1 text-xs text-muted-foreground">{device.id}</p>
                </div>
                <DialogPrimitive.Close
                  aria-label="Close device details"
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <X aria-hidden className="h-4 w-4" />
                </DialogPrimitive.Close>
              </header>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-5 text-sm">
                <Field label="Status">
                  <StatusBadge device={device} />
                </Field>
                <Field label="City">{device.city}</Field>
                <Field label="Last seen">
                  <span title={formatDateTime(device.lastSeenAt)}>
                    {relativeTime(device.lastSeenAt)}
                  </span>
                </Field>
                <Field label="Firmware">
                  <span className="font-mono text-xs">{device.firmwareVersion}</span>
                </Field>
              </dl>
              {device.disabled ? (
                <p className="mx-5 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                  This device is disabled. It stops reporting data until an operator re-enables it
                  from the table selection.
                </p>
              ) : null}
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
