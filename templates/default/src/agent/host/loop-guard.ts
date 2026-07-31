"use client";

/**
 * Run limits for a turn that is going wrong, enforced in host code because the
 * prompt cannot enforce anything. The instructions ask the model to read the
 * `retry` hint on a typed error; this decides what happens when it does not.
 *
 * Three different shapes of stuck, because one counter only catches one:
 *
 *   - **identical** — the same capability with the same arguments, over and
 *     over. The classic loop, and the only one the original counter caught.
 *   - **consecutive** — everything failing, arguments never repeating. What a
 *     degenerating model looks like: it is not retrying, it is emitting fresh
 *     garbage each time, so an identity-keyed counter never advances past 1.
 *   - **refused** — a capability that already answered `retry: "no"`, called
 *     again with the same arguments. "no" is the strongest hint the protocol
 *     has; re-issuing it is not a retry strategy, it is not reading results.
 *
 * A success resets the consecutive counter and nothing else. Progress means
 * the turn is working, but a capability that failed identically three times is
 * still not going to work on the fourth.
 */

export const LOOP_LIMITS = {
  /** Same capability, same arguments. */
  maxIdenticalFailures: 3,
  /** Any failures, back to back, regardless of what failed. */
  maxConsecutiveFailures: 4,
} as const;

export interface ToolOutcome {
  canonicalId: string;
  input: unknown;
  ok: boolean;
  /** The result envelope as the model sees it: `{ error: { code, retry? } }`. */
  result: unknown;
}

export interface LoopVerdict {
  code: "RUN_LIMIT_EXCEEDED";
  message: string;
}

export type LoopGuard = ReturnType<typeof createLoopGuard>;

export function createLoopGuard() {
  const identicalFailures = new Map<string, number>();
  const refused = new Set<string>();
  let consecutive = 0;

  return {
    /**
     * Fold one settled tool call into the guard, in the order it happened.
     * Returns the verdict that should stop the turn, or null to continue.
     */
    record(outcome: ToolOutcome): LoopVerdict | null {
      const key = `${outcome.canonicalId}:${stableKey(outcome.input)}`;

      if (outcome.ok) {
        consecutive = 0;
        return null;
      }

      consecutive += 1;
      const identical = (identicalFailures.get(key) ?? 0) + 1;
      identicalFailures.set(key, identical);

      // Checked before the counters: this one is already conclusive at two
      // calls, and it names the actual mistake rather than the symptom.
      if (refused.has(key)) {
        return {
          code: "RUN_LIMIT_EXCEEDED",
          message: `Stopped: ${outcome.canonicalId} was called again with the same arguments after answering "retry: no".`,
        };
      }
      if (retryHint(outcome.result) === "no") refused.add(key);

      if (identical >= LOOP_LIMITS.maxIdenticalFailures) {
        return {
          code: "RUN_LIMIT_EXCEEDED",
          message: `Stopped: ${outcome.canonicalId} failed identically ${identical} times.`,
        };
      }
      if (consecutive >= LOOP_LIMITS.maxConsecutiveFailures) {
        return {
          code: "RUN_LIMIT_EXCEEDED",
          message: `Stopped: ${consecutive} tool calls failed in a row without a single success.`,
        };
      }
      return null;
    },
  };
}

/** The `retry` hint of a typed capability error, if the result carries one. */
function retryHint(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("error" in result)) return undefined;
  const error = (result as { error?: { retry?: unknown } }).error;
  return typeof error?.retry === "string" ? error.retry : undefined;
}

/**
 * Key on the arguments as issued. Object key ORDER is not meaningfulness — a
 * model that re-sends the same call with its keys shuffled is repeating
 * itself, and `JSON.stringify` alone would read that as a new attempt.
 */
function stableKey(input: unknown): string {
  return JSON.stringify(sortKeys(input ?? {}));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}
