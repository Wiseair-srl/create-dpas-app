import { os } from "@orpc/server";

import type { AppContext } from "./base";

/**
 * Human-readable audit decoration.
 *
 * Audit events carry only the input HASH, never the input — deliberately, so
 * the trail cannot become a second copy of the data. But "capability.completed
 * · issue-invoice" is not something an auditor can read six months later, so a
 * target and a one-line summary are computed where the validated input IS
 * visible: an oRPC middleware on the capability itself.
 *
 * It stashes by executionId; the decorated sink (server/runtime.ts) merges the
 * fields into the terminal event. Plain UI reads never stash — they have no
 * `context.agent`, because they never entered the governed pipeline.
 */

export type AuditFields = {
  target?: { type: string; id: string };
  summary?: string;
};

const stash = new Map<string, AuditFields>();
const MAX_STASH = 10_000;

export function takeAuditFields(executionId: string): AuditFields | undefined {
  const fields = stash.get(executionId);
  stash.delete(executionId);
  return fields;
}

/**
 * `target` and `summary` receive the validated input and — on the second pass,
 * after the handler ran — its output. Compute defensively: the first pass
 * happens before the handler, so the failure event has a summary too.
 */
export function auditFields<TInput, TOutput = unknown>(compute: {
  target?: (input: TInput, output?: TOutput) => { type: string; id: string };
  summary?: (input: TInput, output?: TOutput) => string;
}) {
  return os.$context<AppContext>().middleware(async ({ context, next }, input) => {
    const executionId = context.agent?.executionId;
    const record = (output?: TOutput) => {
      if (!executionId) return;
      if (stash.size >= MAX_STASH) stash.clear(); // runaway guard
      try {
        const fields: AuditFields = {};
        if (compute.target) fields.target = compute.target(input as TInput, output);
        if (compute.summary) fields.summary = compute.summary(input as TInput, output);
        stash.set(executionId, fields);
      } catch {
        // Audit decoration must never break the call it decorates.
      }
    };
    record();
    const result = await next();
    // Refine with the handler's output before the runtime emits the terminal
    // event — this middleware returns first, so the update wins by construction.
    record((result as { output?: TOutput }).output);
    return result;
  });
}
