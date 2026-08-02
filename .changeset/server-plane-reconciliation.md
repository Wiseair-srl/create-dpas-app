---
"create-dpas-app": patch
---

Reconcile the query cache after a server-plane write, so an agent write updates
the screen on both planes instead of only one.

The generated app had one reconciliation trigger: the surface subscription in
`app/agent/surface/wiring.tsx`, which invalidates the query cache when a
`domain:` invocation settles. That covers capabilities the agent runs in the
**browser** — a contextual binding, the app-level actions — and nothing else.
Most domain capabilities are composed server-side by `toAISDKTools` and execute
inside the model loop, talking to the database directly; no surface invocation
ever happens, so nothing in the tab knows the data moved. The screen kept
showing the old rows until `staleTime` lapsed, the route remounted, or the
window regained focus.

The symptom is the confusing one: *some* agent writes refresh the UI and others
don't, with no pattern visible from the chat transcript. The ones that worked
were the ones that happened to run in the browser. A comment in `wiring.tsx`
stated the convention — "the agent writes through the same data layer as every
human path" — in terms general enough to read as covering both planes, which is
what let the gap survive review.

The signal was already on the wire: `step-start` announces the domain half of
the catalog and `tool-result` reports each call. `DomainToolInfo` now carries
`sideEffect`, read from the capability's own `meta.sideEffect` in the registry
at the moment the wire name is minted — the one point where name and capability
are both known for certain — and defaulting to `write` if the lookup misses.
The stream consumer builds a wire-name → effect map per step (the catalog is
composed per request, so an earlier step's map describes a different catalog)
and calls a `reconcile` callback on every successful result whose effect is not
a declared read. The callback is supplied by `runtime-adapter.tsx`, where the
React context lives, and its body is the same `invalidateQueries()` the buttons
already run: an agent refresh narrower than a click's would make the same
operation refresh different screens depending on who asked for it.

The test is written by exclusion — anything that is not `read` or `none`
reconciles, including an effect string this build does not recognise and the
field being absent because the server predates it. One refetch too many costs a
request; one missed leaves the user reading numbers that have already changed.
Invalidation fires per write rather than once per turn, so a turn that writes
three times updates the screen as it goes, and the agent's own later reads of
that screen see the new state. Each one is logged to the Inspector, which is the
trace this class of bug needs the next time somebody reports that the screen did
not update.

Both triggers now name each other in comments, in `docs/concepts/dual-plane.md`
and in the generated `docs/architecture.md`: one convention, two triggers,
because there are two execution planes. Also fixes the Inspector's domain
catalog, which labelled every server tool `server-query` — including the writes.
