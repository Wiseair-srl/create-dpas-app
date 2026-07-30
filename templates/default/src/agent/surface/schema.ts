"use client";

import { fromStandardSchema, type JsonSchema } from "@agent-surface/core";
import { z } from "zod";

/**
 * Zod v4 → AgentSchema adapter. Agent Surface validates against a conservative
 * JSON Schema keyword subset, so we strip the `$schema` marker zod emits.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _$schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest as JsonSchema;
}

/** Wrap a zod schema for use as a capability input/output schema. */
export function zs<T extends z.ZodType>(schema: T) {
  return fromStandardSchema<z.output<T>>(schema, { jsonSchema: toJsonSchema(schema) });
}
