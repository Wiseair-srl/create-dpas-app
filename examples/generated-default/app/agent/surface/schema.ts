import {
  fromStandardSchema,
  type JsonSchema,
  type StandardSchemaV1,
} from "@agent-surface/core";
import * as z from "zod";

/**
 * Zod v4 → AgentSchema adapter.
 *
 * Agent Surface validates against a conservative JSON Schema keyword subset
 * and REJECTS a schema outside it at registration — that is, when the
 * component mounts, taking the screen with it. Zod emits a few constructs
 * outside that subset even for ordinary shapes, so they are normalised here
 * rather than worked around at each call site:
 *
 *   - `$schema` — a marker, carries no constraint;
 *   - `propertyNames` — zod adds `{type: "string"}` on every open record, which
 *     JSON already guarantees;
 *   - `additionalProperties: {}` — the subset wants a boolean; an empty schema
 *     means "anything", which is `true`.
 *
 * Anything else outside the subset is left alone deliberately: it is a real
 * schema the surface cannot express, and failing loudly at mount beats
 * silently advertising something different to the model.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _$schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return sanitize(rest) as JsonSchema;
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "propertyNames") continue;
    if (key === "additionalProperties") {
      out[key] =
        typeof value === "object" && value !== null && Object.keys(value).length === 0
          ? true
          : sanitize(value);
      continue;
    }
    out[key] = sanitize(value);
  }
  return out;
}

/** Wrap a zod schema for use as a capability input/output schema. */
export function zs<T extends z.ZodType>(schema: T) {
  return fromStandardSchema<z.output<T>>(schema, { jsonSchema: toJsonSchema(schema) });
}

/**
 * `zs` with the TypeScript type pinned by hand instead of inferred.
 *
 * Needed where zod's inferred type is wider than `JsonValue` even though every
 * value is JSON — an open record infers `{ [k: string]: unknown }`, and
 * `unknown` is not assignable to `JsonValue`. Validation is unchanged; only
 * the type the capability advertises is narrowed.
 *
 * Use `z.looseObject({})` for such records rather than
 * `z.record(z.string(), z.json())`: the latter emits `propertyNames` and a
 * recursive `$ref`/`$defs` pair, and Agent Surface validates against a
 * conservative JSON Schema keyword subset that rejects both
 * (UNSUPPORTED_SCHEMA, thrown at registration — i.e. on mount).
 */
export function zsAs<TOut>(schema: z.ZodType) {
  // The cast is the whole point of this helper: zod's inferred output is
  // deliberately wider than the type the capability advertises. Validation
  // still runs against `schema`, so a value that would not satisfy TOut is
  // rejected before any handler sees it.
  return fromStandardSchema<TOut>(
    schema as unknown as StandardSchemaV1<unknown, TOut>,
    { jsonSchema: toJsonSchema(schema) },
  );
}
