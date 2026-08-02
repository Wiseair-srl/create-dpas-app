import type { AgentSurfaceRegistry } from "@agent-surface/core";

/**
 * Wait for the browser to finish applying what a capability just did, so the
 * NEXT catalog describes the surface the model is about to act on rather than
 * the one it just acted on.
 *
 * This is the host half of adapter duty 2 (agent-surface `09-adapters.md`): an
 * adapter must refresh the catalog it exported when the surface changes and
 * must never serve a stale one. The turn loop already pulls a fresh snapshot at
 * the top of every step, which is the right shape — but it pulls in the SAME
 * TASK that just ran the tool calls, and React has not committed by then.
 * Microtasks drain before the render React scheduled, so without this the step
 * after a navigation ships the previous route's catalog and the model is told
 * the capability it needs does not exist.
 *
 * Two mechanisms, because neither covers both cases alone:
 *
 *   - a REGISTRATION change — a route mounting its screen, a `when()` flipping
 *     — emits `surface-changed` / `availability-changed`, which we can wait for;
 *   - a DATA change behind an observation emits nothing at all. `setFilters`
 *     re-renders the table with different rows and `read()` picks them up
 *     through the hook's live ref; no registry mutation happens, so there is no
 *     event to await — only React's commit.
 *
 * So: yield task boundaries until the surface has been quiet for a whole one,
 * with a floor (React needs one task to render and another to flush the passive
 * effect that registers) and a ceiling (a screen that never settles must not be
 * able to hold the turn).
 *
 * QUIET IS NOT DONE. React Router wraps every navigation — `navigate()`, and
 * also `setSearchParams`, which is how this app's filters, sort and columns are
 * applied — in `startTransition`. A transition is deliberately deferred and
 * time-sliced: `history.pushState` has already run, so `window.location` is the
 * destination, but the tree that mounts the destination screen commits tens to
 * hundreds of milliseconds later, across task boundaries that are perfectly
 * silent. Waiting for quiet alone returns during that gap and hands the next
 * step a catalog for the screen the user just left — observed as the model
 * navigating correctly and then reporting that the screen it asked for offers
 * nothing.
 *
 * Hence `until`: a caller that knows what "applied" means passes a predicate,
 * and quiet does not count until it holds.
 */

/** Task boundaries to yield before believing quiet: render, then effects. */
const MIN_TICKS = 2;

/** Upper bound with nothing to wait FOR. A slow mount costs this much, once. */
const BUDGET_MS = 250;

/**
 * Upper bound when a caller is waiting on `until`. Larger because a transition
 * that mounts a heavy screen genuinely takes longer than a passive effect — and
 * it is a ceiling, not a cost: the wait ends the moment the predicate holds.
 */
const UNTIL_BUDGET_MS = 1_500;

export interface SettleOptions {
  /**
   * Must hold before the surface counts as settled. For anything the router
   * applies, that is "the tree has caught up with the URL" — see
   * `locationCommitted()` in transport-client.
   */
  until?: () => boolean;
  budgetMs?: number;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function settleSurface(
  registry: AgentSurfaceRegistry,
  options: SettleOptions = {},
): Promise<void> {
  const { until } = options;
  const budgetMs = options.budgetMs ?? (until ? UNTIL_BUDGET_MS : BUDGET_MS);
  let changed = false;
  const unsubscribe = registry.subscribe((event) => {
    if (event.type === "surface-changed" || event.type === "availability-changed") {
      changed = true;
    }
  });
  const deadline = performance.now() + budgetMs;
  try {
    for (let tick = 0; ; tick++) {
      // Cleared before the yield, so it reports on the tick we are about to
      // wait out rather than on anything that landed earlier.
      changed = false;
      await nextTask();
      // The predicate is checked AFTER the yield and re-checked every tick: a
      // navigation that redirects moves the target rather than deadlocking on
      // the one this call started with.
      const applied = until === undefined || until();
      if (applied && tick + 1 >= MIN_TICKS && !changed) return;
      if (performance.now() >= deadline) return;
    }
  } finally {
    unsubscribe();
  }
}
