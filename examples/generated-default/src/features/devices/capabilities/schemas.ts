"use client";

import { z } from "zod";
import { StatusFilterSchema } from "@/features/devices/schemas/device";

/**
 * Capability input/output schemas for the presentation plane. Semantic and
 * minimal by design: observations expose what an agent needs to plan with,
 * not entire domain records.
 */

export const FiltersStateSchema = z.object({
  status: StatusFilterSchema,
  city: z.string().nullable().describe("Active city filter, or null for all cities"),
});
export type FiltersState = z.infer<typeof FiltersStateSchema>;

export const FiltersPatchSchema = z.object({
  status: StatusFilterSchema.optional().describe("New status filter; omit to keep the current one"),
  city: z
    .string()
    .nullable()
    .optional()
    .describe('New city filter ("Milan", …); null clears it; omit to keep the current one'),
});
export type FiltersPatch = z.infer<typeof FiltersPatchSchema>;

export const TableRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["online", "offline"]),
  city: z.string(),
  disabled: z.boolean(),
});
export type TableRow = z.infer<typeof TableRowSchema>;

export const SortStateSchema = z.object({
  column: z.enum(["name", "status", "city", "lastSeenAt", "firmwareVersion"]),
  direction: z.enum(["asc", "desc"]),
});
export type SortState = z.infer<typeof SortStateSchema>;

export const TableStateSchema = z.object({
  visibleRows: z.array(TableRowSchema).describe("Rows matching the active filters, in view order"),
  selectedIds: z.array(z.string()),
  sorting: SortStateSchema.nullable(),
});
export type TableState = z.infer<typeof TableStateSchema>;

export const SelectRowsSchema = z.object({
  ids: z.array(z.string()).describe("Device ids to select; must be visible in the table"),
  mode: z
    .enum(["replace", "add", "remove"])
    .optional()
    .describe("How to apply the ids to the current selection (default replace)"),
});
export type SelectRowsInput = z.infer<typeof SelectRowsSchema>;

export const DrawerOpenSchema = z.object({
  deviceId: z.string().describe("Device to inspect; must be visible in the table"),
});

export const RouteStateSchema = z.object({
  path: z.string(),
});

export const NavigateSchema = z.object({
  path: z.enum(["/dashboard", "/architecture"]).describe("Application route to open"),
});
