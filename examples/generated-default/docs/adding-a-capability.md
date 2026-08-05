# Adding a capability

## A domain capability

An oRPC procedure with an `agent` block. The procedure stays the single
implementation for the UI, the agent, MCP and your tests.

```ts
// capabilities/invoices/write-off-invoice.ts
export const writeOffInvoice = agentBase
  .meta({
    agent: {
      description: "Write an unrecoverable invoice off the ledger. Irreversible.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "destructive",   // none | read | write | destructive | external
      risk: "high",                // low | medium | high | critical
      tags: ["invoices"],          // the scope token — see app/agent/host/scope.ts
    },
  })
  .use(auditFields({ summary: (input) => `Wrote off invoice ${input.id}` }))
  .input(invoiceId)
  .handler(({ input }) => { /* … */ });
```

Add it to `capabilities/registry.ts`. The key IS the capability id: the audit
identity, the MCP tool name, the manifest key, and the string a policy matches
on. That is why the registry is flat.

Then decide two things.

**Exposure.** `expose` is deny-by-default — only the surfaces you list are
reachable. `aiSdk` is the in-app copilot, `mcp` is external clients, `direct` is
your own UI, `test` is the harness. Omitting the `agent` block entirely makes a
procedure invisible to every agent while remaining callable from the UI.

**Whether it needs a human.** Add the id to `GATED_CAPABILITIES` in
`capabilities/policies.ts` and a model-initiated call suspends into an approval
record; the same call from your own UI passes ungated, because a person clicking
a button has already expressed intent.

Test it in `capabilities/governance.test.ts` — deterministic, no model, no HTTP.

### A native chat renderer

Optional, for reporting capabilities. `app/chat-renderers.tsx` keeps one
renderer per capability id. When a call comes back `ok` the thread draws that
renderer's output under the tool pill (`features/copilot/tool-ui.tsx`), and
the approval receipt reuses the map for the output of a gated run
(`approval-receipt.tsx`). The key is the bare capability id — the registry
key, not the `domain:`-prefixed name the pill shows — and the input is the
governed envelope's `data`, already unwrapped:

```tsx
// app/chat-renderers.tsx
export const CHAT_RENDERERS: Record<string, (data: unknown) => ReactNode> = {
  "collections-aging": (data) =>
    Array.isArray(data) ? (
      <ChatCard title="Receivables ageing">
        <AgingChart buckets={data as AgingBucket[]} />
      </ChatCard>
    ) : null,
};
```

Return `null` when the data is not the shape you expected. A missing entry —
or that `null` — is not an error: the thread falls back to the collapsible
payload viewer (`features/copilot/payload.tsx`), the right default, because a
renderer that guesses at an unknown shape is worse than an honest `{ … }`.
Render with the same components the pages use, so the assistant's version of
a number and the screen's version cannot disagree.

## A view capability

Two steps, in this order. **Declare** it in `app/agent/surface/contracts.ts`:

```ts
export const pendingInvoicesTableContract = defineAgentComponentContract({
  type: "invoices.pending",          // → view:invoices.pending.*
  description: "Issued invoices that have not been paid. Amounts are in cents.",
  observations: {
    readState: observationContract({ description: "…", output: fromJsonSchema<…>({ … }) }),
  },
  actions: {
    sort: actionContract<TableSortInput>({
      description: "…",
      input: fromJsonSchema<TableSortInput>({ … }),
      effect: "local-state",
      idempotent: true,
    }),
  },
});
```

Then **bind behaviour** to it. The table screens get theirs from one hook:

```ts
useTableAgentComponent({
  contract: pendingInvoicesTableContract,
  rows, total, rowSummary,
  filters, columns, sort, selection, rowId,
});
```

Everything routes through the same setters the toolbar calls, so the agent path
and the human path are one implementation, and the URL stays the source of
truth. Pass only the parts your screen has — and declare only those capabilities
on its contract, because a declared capability with no binding throws at mount
and a binding the contract does not declare is refused by the registry.

For anything that is not a table, bind directly with `useAgentComponent(contract,
bindings)` (see `app/agent/surface/wiring.tsx` for the shell's own two).

Contracts are read out of your source at build time, so they must be statically
evaluable: a top-level `export const`, literal values, literal JSON Schema via
`fromJsonSchema`. No template interpolation, no concatenation, no function calls,
no zod — a description that varies at runtime is not a contract. Violations are
build errors that name the file and line.

**Do not** expose `click`, `type`, `focus` or element selectors. If you are
reaching for those, the missing piece is a semantic capability.

## A contextual reference

Four declarations, and all four are required — which is the point:

1. the procedure opts out of direct model exposure (`expose.aiSdk: false`);
2. `app/agent/domain/manifest.ts` admits it — the frontend's exposure ceiling,
   so a component cannot bind something the manifest does not list;
3. `defineAgentProcedureContract` in `app/agent/surface/contracts.ts` declares
   the id, description, schemas and effect the model will see;
4. the component that owns the state binds it with `useAgentProcedure(contract,
   ref, config)`, which removes the bound keys from the advertised schema.

The contract's schemas must match what the manifest advertises — the registry
compares them and refuses the registration if they differ, so a drift between
the two fails on mount rather than reaching a model.

`app/features/collections/ChaseDialog.tsx` is the worked example. Read the
comment at the top of it before adding a second one — the choice between
binding and gating is explained there and in `docs/architecture.md`.

## After any of it

```bash
pnpm test            # contracts and governance
pnpm view:inspect    # the view plane — look at what you changed
pnpm view:check      # …and its gate
pnpm domain:inspect  # the domain plane — same two questions
pnpm domain:check
```

`view:check` compiles the contract from source and fails when it disagrees
with the committed `.agent-surface/contract.json`, reporting each change as
widening, narrowing or neutral. Regenerate with `pnpm view:snapshot` and
commit the result.

There is no coverage question any more: capabilities are declared in
`app/agent/surface/contracts.ts`, so the contract covers all of them whether or
not a screen ever mounts.

`domain:check` is the same bargain for the domain plane. It reads the `governance`
export of `server/runtime.ts` — registry plus runtime policies, without building
a runtime — and fails when it disagrees with `capabilities.snapshot.json`.
Regenerate with `pnpm domain:snapshot`.

It reports that a policy *exists*, never what it gates: `gate-model-writes` and
`analyst-hides-writes` decide on surface, actor and input, which needs a real
invocation. So a `0` in the APPROVAL column is a statement about `meta.approval`,
not a claim that nothing is gated — the exit codes are `0` clean, `1` drift,
`2` could not run, and CI has to keep the last two apart.
