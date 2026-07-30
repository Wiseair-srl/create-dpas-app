# Adding capabilities

The full, worked guides ship inside every generated app (and live in the
template here), because that is where developers extending an app will look:

- [templates/default/docs/adding-a-view-capability.md](../templates/default/docs/adding-a-view-capability.md)
- [templates/default/docs/adding-a-domain-capability.md](../templates/default/docs/adding-a-domain-capability.md)
- [templates/default/docs/contextual-domain-actions.md](../templates/default/docs/contextual-domain-actions.md)

The 30-second version:

- **View capability** — extend the `useAgentComponent` call of the component
  that owns the state: an `observation` (semantic read) or an `action`
  (`local-state` / `navigation` effect). Schemas via `zs(zodSchema)`.
- **Domain capability** — an oRPC procedure with `meta.agent`
  (deny-by-default `expose`, honest `sideEffect` + `risk`). Add to the router;
  governance and audit come from the shared runtime.
- **Contextual action** — `expose.aiSdk: false` on the procedure, an entry in
  the frontend manifest (the exposure ceiling), and a `useAgentProcedure`
  binding with `when` / `bind` / `confirmation` in the owning component.
  Never expose the same operation both ways — the host rejects the catalog.

When changing the template in THIS repo, also run `pnpm regen:example` (the
CI drift gate compares the committed example against generator output) and
review the semantic surface snapshot diff in
`templates/default/src/features/devices/__snapshots__/` as an API change.
