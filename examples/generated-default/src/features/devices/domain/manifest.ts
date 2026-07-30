"use client";

import type { OrpcAgentManifest } from "@agent-surface/orpc";
import {
  DisableDevicesInputSchema,
  DisableDevicesOutputSchema,
} from "@/features/devices/schemas/device";
import { toJsonSchema } from "@/agent/surface/schema";

/**
 * The frontend's declaration of which domain procedures may be referenced
 * contextually — the exposure ceiling for the presentation plane. A procedure
 * missing from this manifest cannot be bound by any component, no matter what
 * the component code says.
 *
 * `devices.disable` appears here and is NOT exposed as a direct model tool
 * server-side (`expose.aiSdk: false` in src/server/orpc/procedures.ts):
 * one operation, one model-visible path.
 */
export const domainManifest: OrpcAgentManifest = {
  tools: {
    "devices.disable": {
      description: "Disable the given devices. Destructive: they stop reporting data.",
      inputSchema: toJsonSchema(DisableDevicesInputSchema),
      outputSchema: toJsonSchema(DisableDevicesOutputSchema),
      effect: "destructive",
    },
  },
};
