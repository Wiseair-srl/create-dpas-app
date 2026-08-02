import { ORPCError, os } from "@orpc/server";

import type { AppContext } from "../capabilities/base";
import { actorFor, runtime } from "./runtime";

/**
 * The /rpc surface the UI calls.
 *
 * Reads pass through as plain oRPC procedures — they are session-gated by the
 * server middleware, and auditing every polled read is noise that buries the
 * writes. Writes are WRAPPED: the procedure forwards to `runtime.invoke(id,
 * input, { surface: "direct" })`, so every human mutation gets the full
 * governed pipeline (validation, policy, audit) without an approval prompt.
 * The central policy only gates model loops.
 *
 * That is the load-bearing asymmetry of the whole app: one implementation, two
 * callers, and the difference between them is a policy input rather than a
 * second code path.
 *
 * Capabilities are defined ONCE; this builder derives each wrapper from the
 * procedure's own def, so the typed client sees identical input/output types
 * either way.
 */

type AnyProcedure = { "~orpc": Record<string, unknown> };

function isProcedure(value: unknown): value is AnyProcedure {
  return Boolean(value && typeof value === "object" && "~orpc" in value);
}

const ERROR_STATUS: Record<string, string> = {
  INPUT_INVALID: "BAD_REQUEST",
  CAPABILITY_NOT_FOUND: "NOT_FOUND",
  POLICY_DENIED: "FORBIDDEN",
  TIMEOUT: "TIMEOUT",
};

function wrapWrite(id: string, procedure: AnyProcedure) {
  const def = procedure["~orpc"] as {
    inputSchema?: unknown;
    outputSchema?: unknown;
  };
  // The builder is only typed once the schemas are applied, which is what the
  // two lines below do — there is no intermediate type to name here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let builder: any = os.$context<AppContext>();
  if (def.inputSchema) builder = builder.input(def.inputSchema);
  if (def.outputSchema) builder = builder.output(def.outputSchema);
  return builder.handler(async ({ input, context }: { input: unknown; context: AppContext }) => {
    const result = await runtime.invoke(id, input, {
      actor: actorFor(context.session),
      context,
      surface: "direct",
    });
    switch (result.status) {
      case "completed":
        return result.output;
      case "approval-required":
        // Policy misconfiguration: humans on the direct surface are never gated.
        throw new ORPCError("CONFLICT", {
          message: `"${id}" unexpectedly requires approval on the direct surface (${result.approval.id}).`,
        });
      case "failed":
      case "cancelled":
        throw new ORPCError(ERROR_STATUS[result.error.code] ?? "INTERNAL_SERVER_ERROR", {
          message: result.error.publicMessage,
        });
    }
  });
}

/** Same-shaped router with writes governed; reads untouched. */
export function buildGovernedRouter<T extends Record<string, unknown>>(router: T): T {
  const out: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(router)) {
    if (!isProcedure(node)) {
      throw new Error(`Registry entry "${id}" is not a procedure — the registry is flat by design.`);
    }
    const meta = (node["~orpc"] as { meta?: { agent?: { sideEffect?: string } } }).meta;
    const sideEffect = meta?.agent?.sideEffect;
    out[id] = sideEffect && sideEffect !== "read" ? wrapWrite(id, node) : node;
  }
  return out as T;
}
