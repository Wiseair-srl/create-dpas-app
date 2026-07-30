import { z } from "zod";

/**
 * Domain schemas shared by the oRPC procedures (server), the React Query layer
 * (client) and the Agent Surface capability schemas. One shape, one source.
 */

export const DeviceStatusSchema = z.enum(["online", "offline"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: DeviceStatusSchema,
  city: z.string(),
  lastSeenAt: z.string(),
  firmwareVersion: z.string(),
  disabled: z.boolean(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceListFilterSchema = z.object({
  status: DeviceStatusSchema.optional().describe("Match devices by reporting status"),
  city: z.string().optional().describe("Match devices by city, case-insensitive"),
  disabled: z.boolean().optional().describe("Match only disabled (true) or active (false) devices"),
});
export type DeviceListFilter = z.infer<typeof DeviceListFilterSchema>;

export const DeviceListOutputSchema = z.object({
  devices: z.array(DeviceSchema),
  total: z.number().int(),
});
export type DeviceListOutput = z.infer<typeof DeviceListOutputSchema>;

export const DisableDevicesInputSchema = z.object({
  deviceIds: z
    .array(z.string())
    .min(1)
    .describe("Ids of the devices to disable. Bound from the current selection."),
  reason: z.string().max(200).optional().describe("Optional operator note for the audit trail"),
});
export type DisableDevicesInput = z.infer<typeof DisableDevicesInputSchema>;

export const DisableDevicesOutputSchema = z.object({
  disabled: z.number().int(),
  devices: z.array(DeviceSchema),
});
export type DisableDevicesOutput = z.infer<typeof DisableDevicesOutputSchema>;

/** UI filter state — what the dashboard's filter bar actually shows. */
export const StatusFilterSchema = z.enum(["all", "online", "offline", "disabled"]);
export type StatusFilter = z.infer<typeof StatusFilterSchema>;

export const CITY_OPTIONS = ["Milan", "Turin", "Rome", "Bologna", "Genoa"] as const;
