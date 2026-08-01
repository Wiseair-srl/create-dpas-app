"use client";

import type { AgentSurfaceRegistry } from "@agent-surface/core";

/**
 * Surface settlement — the host's half of adapter duty 2 (agent-surface
 * `docs/09-adapters.md`): *"MUST subscribe to `surface-changed` and refresh
 * whatever catalog it exported; MUST NOT cache descriptors across versions."*
 *
 * The step loop projects a fresh catalog at the top of every iteration, which
 * looks like it discharges that duty on its own. It does not, because of WHEN
 * it runs. A frontend tool call returns to the loop across MICROTASKS only,
 * while the surface moves on a React commit: registration happens in a passive
 * effect, and availability is pushed from an effect that runs after it.
 * Microtasks drain before either, so a snapshot taken the instant the last
 * call resolves is the surface as it was BEFORE the call — a cached descriptor
 * set in every sense that matters, cached for one step instead of forever.
 *
 * The symptom lands exactly where the capability model is worth the most: an
 * agent that navigates does not see the page it just opened, and an agent that
 * selects rows is still told the selection-bound procedure is unavailable.
 *
 * So the loop waits for the surface to catch up rather than assuming it has.
 * The wait is gated on the registry's own version — the same signal the
 * Inspector refreshes from — and not on a fixed macrotask yield, which would
 * be a guess about React's scheduler that a future scheduler is free to break.
 */

export interface SurfaceSettleBudget {
  /**
   * How long to wait for the surface to START moving. Spent in full only when
   * nothing moves at all, so it is the standing cost of the gate and stays
   * around one animation frame.
   *
   * It doubles as the commit yield. Not every change the model must see bumps
   * the version: a contextual binding's `describe()` text and an observation's
   * output ride `latest.current`, which is written during render, so they need
   * a COMMIT rather than a registration or an availability push. There is no
   * event for that, and this budget is what gives React the macrotask.
   */
  firstChangeMs: number;
  /**
   * How long the surface must then stay quiet to count as settled. Re-armed on
   * every change, because one user-visible transition is routinely several
   * version bumps: unmounting the old route and mounting the new one are two,
   * and a Suspense boundary resolving underneath is another.
   */
  quietMs: number;
  /**
   * Hard ceiling on the whole wait. A surface that changes continuously — a
   * running animation driving `when()`, a poll on a short interval — would
   * otherwise re-arm the quiet window forever and hang the turn.
   */
  timeoutMs: number;
}

export const DEFAULT_SETTLE_BUDGET: SurfaceSettleBudget = {
  firstChangeMs: 60,
  quietMs: 40,
  timeoutMs: 750,
};

/**
 * A route change is a different order of magnitude and needs its own budget.
 *
 * On a warm route the destination is mounted by the time the navigation action
 * resolves, so the version has already moved and none of `firstChangeMs` is
 * spent. The budget is for the cold case: the route's code split has to load
 * and its data has to arrive before anything registers, and until then the
 * surface has not moved at all — the exact window in which the old catalog
 * looks settled because nothing has happened yet.
 *
 * Applied only when the route actually changed, so a `goTo` to the current
 * route pays the default budget like any other no-op.
 */
export const NAVIGATION_SETTLE_BUDGET: SurfaceSettleBudget = {
  firstChangeMs: 2_000,
  quietMs: 120,
  timeoutMs: 5_000,
};

export type SurfaceSettleReason =
  /** The surface moved and then went quiet: the next snapshot is current. */
  | "settled"
  /** Nothing moved within the budget; the call changed no capability. */
  | "unchanged"
  /** Still moving at the ceiling. The next snapshot may lag by design. */
  | "timeout"
  /** The turn was cancelled while waiting. */
  | "aborted";

export interface SurfaceSettleResult {
  reason: SurfaceSettleReason;
  fromVersion: string;
  toVersion: string;
  waitedMs: number;
}

/**
 * Resolve once the surface has absorbed whatever the caller just did.
 *
 * `fromVersion` is the version read BEFORE the call, so a change that landed
 * while the call was in flight is not missed: this compares versions rather
 * than only listening for the event, and `surface-changed` is coalesced per
 * microtask — a bump that happened before the subscription is a bump whose
 * event this listener would never see.
 *
 * Never rejects. A surface that will not settle is a slow catalog, not a
 * failed turn, and the caller decides what to do about it.
 */
export function waitForSurfaceSettled(
  registry: AgentSurfaceRegistry,
  fromVersion: string,
  options: { budget?: Partial<SurfaceSettleBudget>; signal?: AbortSignal } = {},
): Promise<SurfaceSettleResult> {
  const budget = { ...DEFAULT_SETTLE_BUDGET, ...options.budget };
  const { signal } = options;
  const startedAt = performance.now();

  const outcome = (reason: SurfaceSettleReason): SurfaceSettleResult => ({
    reason,
    fromVersion,
    toVersion: registry.getVersion(),
    waitedMs: Math.round(performance.now() - startedAt),
  });

  if (signal?.aborted) return Promise.resolve(outcome("aborted"));

  return new Promise<SurfaceSettleResult>((resolve) => {
    let moved = registry.getVersion() !== fromVersion;
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;

    const finish = (reason: SurfaceSettleReason) => {
      if (done) return;
      done = true;
      if (quiet !== undefined) clearTimeout(quiet);
      clearTimeout(ceiling);
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome(reason));
    };

    function onAbort() {
      finish("aborted");
    }

    // Before the first change this is the "did anything happen?" budget;
    // after it, the quiet window. One timer, two meanings, because the
    // question changes the moment the surface moves.
    const arm = () => {
      if (quiet !== undefined) clearTimeout(quiet);
      quiet = setTimeout(
        () => finish(moved ? "settled" : "unchanged"),
        moved ? budget.quietMs : budget.firstChangeMs,
      );
    };

    // Declared after `finish` and only ever reached from a timer or a
    // listener, so both are initialized long before anything reads them.
    const unsubscribe = registry.subscribe((event) => {
      if (event.type !== "surface-changed") return;
      moved = true;
      arm();
    });
    const ceiling = setTimeout(() => finish("timeout"), budget.timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    arm();
  });
}
