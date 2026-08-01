---
"create-dpas-app": patch
---

Wait for the surface to catch up before projecting the next catalog, so a
capability gained mid-turn is in the very next step the model sees.

The generated host loop took its per-step snapshot in the same task that had
just executed the step's frontend tool calls. React has not committed by then:
registration lives in a passive effect in `@agent-surface/react`, availability
is pushed from an effect that runs after it, and both are a macrotask away —
while a resolved `dispatchFrontendToolCall` returns across microtasks only, and
microtasks drain first. The `await fetch` further down *is* a real macrotask
boundary, which is why the lag was exactly one step and why calls dispatched in
step N+1 still resolved against fresh handlers. It was the descriptor and state
half, serialized before that fetch, that was stale.

Two ways it showed. **A capability the step created was absent outright**: ask
the agent to open the dashboard and filter the table, and step N+1 arrives with
the `/architecture` catalog — no `devices.table`, no `devices.filters`. Since
the generated instructions tell the model that an absent tool is not something
to work around, the likely outcome was a refusal rather than a retry. **A
capability's state was stale**: after a `selectRows`, the capability-state block
still reported the selection-bound procedure as unavailable with the old count,
though invoking it right then would have succeeded. A milder third case sat
inside a single step — parallel calls were dispatched with only microtasks
between them, so `filters.set` followed by `table.readState` returned pre-filter
rows. Wrong data, silently.

`src/agent/host/surface-settle.ts` closes it. After any call whose effect is not
`read`, the loop blocks until the registry's version moves and then stays quiet
for a short window — gated on `surface-changed`, the registry's own signal, and
not on a fixed macrotask yield, which would only be a guess about React's
scheduler that a future scheduler is free to break. It compares versions rather
than only listening, because `surface-changed` is coalesced per microtask and a
bump that landed before the subscription emits no event a listener could see.
The quiet window re-arms on every change, so an unmount-then-mount route change
settles once rather than mid-transition. Budgets are 60ms to start moving, 40ms
of quiet, 750ms ceiling; a read-only step skips the gate entirely, and a surface
that never stops changing reports `surface-settled` as an error in the Inspector
instead of stalling the turn. The same wait sits between calls within a step,
which is the parallel case.

The first-change budget also doubles as the commit yield, because not every
change the model must see bumps the version: a contextual binding's `describe()`
text and an observation's output ride the latest-ref, written during render, so
they need a commit rather than a registration or an availability push. There is
no event for that, and the budget is what gives React the macrotask.

A route change gets its own, much larger budget (2s to start moving, 5s
ceiling), keyed on the route actually having changed rather than on the declared
effect. Measured against the running template: a warm navigation has the
destination mounted by the time the action resolves, so none of it is spent — but
a cold one, where the route's code split and its data still have to arrive,
takes about 1.8s during which the surface has not moved at all. That window is
exactly where the old catalog looks settled because nothing has happened yet,
and the default 750ms ceiling gave up inside it.

This is the host's half of adapter duty 2 in `agent-surface/docs/09-adapters.md`
— *"MUST subscribe to `surface-changed` … MUST NOT cache descriptors across
versions"*. The template did subscribe, but only `inspector.setViewCatalog`
refreshed from it; the catalog the model actually received was still built by an
unsynchronized pull.

The other half is an authoring fix, in `src/components/app-shell/nav-rail.tsx`.
`view:app.navigation.goTo` called `router.push` and returned, reporting success
while the old page was still mounted — no amount of host-side waiting can
recover a route transition that has not started settling. Per the D23 authoring
contract it now resolves when the router **commits**, holding the promise until
`usePathname` reports the new route and rejecting under an aborted signal so a
cancelled transition settles `CANCELLED` rather than `EXECUTION_FAILED`. That
capability living in the app layout is what makes this possible: a rail owned by
the page it navigates away from cannot observe its own success.

Meta mode's three tools now carry honest effects (`surface_discover` and
`surface_read` are reads, `surface_act` is not), so the gate is not blind to
which projection the tab is using.

Regression tests come in two shapes, both of which fail without the fix: a
loop-level test that drives `runTurn` against a scripted `/api/chat` and asserts
step 1's `frontendState` reflects the selection step 0 made, and a nav-rail test
that asserts `goTo` does not settle until the route commits. The loop test runs
deliberately outside `act()` — the agent-surface test harness wraps `invoke()`
in `act()`, which flushes effects synchronously, and that courtesy is exactly
why this class of bug survives a green suite.

Reported in [#8](https://github.com/Wiseair-srl/create-dpas-app/issues/8).
