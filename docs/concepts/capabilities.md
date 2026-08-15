# Anatomy of a capability

> **This page:** what a capability actually is on each plane: its identity, its fields, its lifetime, and what the model receives. The task-shaped version is [Adding a capability](../guides/adding-a-capability.md).

## Identity

Every capability has one **canonical id**, prefixed by its plane, and one **wire name**, the provider-safe form the model calls. The mapping is mechanical and reversible (`:` → `_`, `.` → `__`):

| Canonical id | Wire name |
|---|---|
| `view:invoices.pending.setFilters` | `view_invoices__pending__setFilters` |
| `view:invoices.pending.selectRows` | `view_invoices__pending__selectRows` |
| `domain:list-invoices` | `domain_list-invoices` |
| `domain:issue-invoice` | `domain_issue-invoice` |

The canonical id is the **audit identity**: it is what the timeline, the audit records and your tests refer to. The wire name exists only because model providers restrict tool-name characters. Multiple mounted instances of the same component add an `_at_<instance>` suffix to the wire name; the canonical id in front of it is unchanged.

A `domain:` capability's id is its key in the flat registry: `mark-invoice-paid` there is `domain:mark-invoice-paid` everywhere else. Flat on purpose: that one string is the audit identity, the MCP tool name, the manifest key and what a policy matches on, so there is nowhere for four readers to disagree about how to flatten it.

## A view capability

**Declared** in `app/agent/surface/contracts.ts`, **bound** by the component that owns the state. Two kinds:

- an **observation**: a semantic read. No effect, never confirmed.
- an **action**: something that changes page state or navigates.

The declaration is what the model sees, and it is compiled out of your source at build time ([ADR-0011](../adr/0011-compiled-capability-contracts.md)):

```ts
export const pendingInvoicesTableContract = defineAgentComponentContract({
  type: "invoices.pending",
  description: "Issued invoices that have not been paid — the collections working set.",
  observations: {
    readFilters: observationContract({
      description: "The filters currently narrowing this table, as a key/value map.",
      output: fromJsonSchema<FilterMap>(PENDING_INVOICES_FILTERS),
    }),
  },
  actions: {
    setFilters: actionContract<FilterMap>({
      description: "Narrow this table. Pass only the keys you want to change.",
      input: fromJsonSchema<FilterMap>(PENDING_INVOICES_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
  },
});
```

The binding supplies behaviour and nothing else:

```tsx
useAgentComponent(pendingInvoicesTableContract, {
  observations: { readFilters: { read: () => ({ ...filters.values }) } },
  actions: { setFilters: { execute: (patch) => filters.setMany(patch) } },
});
```

The table screens do not write the binding by hand: `useTableAgentComponent`
supplies the whole plane's behaviour from the state a screen already has, given
that screen's contract. It is worth reading in the expanded form once, because
that hook is a loop over exactly these fields.

**The split between the two halves is enforced, not stylistic.** Everything the
model *reads* is frozen in the contract and provable at build time; a component
may only supply behaviour. A binding that tries to set a description, a schema
or an effect is a type error, and one the contract does not declare is refused
by the registry ([ADR-0011](../adr/0011-compiled-capability-contracts.md)).

Declared in the contract, what the model sees:

| Field | Meaning |
|---|---|
| `type` + key | Together form the id: `view:invoices.pending.setFilters` |
| `description` | What the model reads. Write it for a stranger, not for you |
| `input` / `output` | Literal JSON Schema through `fromJsonSchema(…)`; validated before `execute` ever runs |
| `effect` | `local-state` or `navigation`, the only two. Anything server-side belongs to the domain plane |
| `idempotent` | Safe to repeat with the same input |
| `confirmation` | `never` · `optional` · `required` |

Supplied by the binding, behaviour only:

| Field | Meaning |
|---|---|
| `read` / `execute` | Your ordinary handler. The human path calls the same one |
| `when` + `unavailableReason` | Present but unavailable, *with the reason the model should act on* |
| `precondition(input)` | Reject semantically invalid input with details (e.g. ids not in the current result set) |

Above both sits the registry's own baseline (`app/agent/surface/registry.ts`):
the compiled contract as its `authority`, and `policies: [authenticated()]`, so
a tab with no session has no surface at all rather than an empty one.

**Lifetime is the mount.** Registering is the only way a capability exists; unmounting removes it. The browser snapshots the live surface at the start of every protocol step, so what the model sees is what is on the page right now, and a call against a stale registration fails with `STALE_CAPABILITY` or `COMPONENT_UNMOUNTED` rather than silently hitting the wrong component.

## A domain capability

An ordinary oRPC procedure with an `agent` block in its meta. The procedure remains the single implementation for the UI, the agent and your tests.

```ts
export const listInvoices = agentBase
  .meta({
    agent: {
      description:
        "List invoices with their client, amount in cents, status, due date and days overdue. " +
        "kind=pending: issued and unpaid — the collections working set. Read-only.",
      expose: { aiSdk: true, mcp: true, direct: true, test: true },
      sideEffect: "read",
      risk: "low",
      tags: ["invoices"],           // the scope token
      redact: { output: capRows(50) },  // model-facing cap; the UI is unaffected
    },
  })
  .input(listInvoicesInput)
  .handler(({ input }) => { /* … */ });
```

| Field | Meaning |
|---|---|
| `description` | What the model reads |
| `expose` | **Deny by default.** Only the surfaces you list are reachable: `aiSdk`, `mcp`, `test`, `direct`, `workflow`. No `agent` block at all means invisible to every agent |
| `sideEffect` | `none` · `read` · `write` · `destructive` · `external`. Declare honestly; it drives UI treatment and review |
| `risk` | `low` · `medium` · `high` · `critical` |
| `tags` | The scope token. One per vertical; the route map in `app/agent/host/scope.ts` narrows discovery by it |
| `redact` | Caps what a MODEL sees of the output. The UI reads through plain oRPC and is never redacted |

Governance is not something you remember to call: every invocation, on every adapter, passes the same pipeline: exposure check, input validation, policy evaluation, execution under *your* oRPC middleware, output validation, redaction, audit. Errors reach the model in exactly two shapes: a public code and message, or a generic `INTERNAL_ERROR`.

**Policies decide by actor.** The template's `analyst-hides-writes` policy hides write capabilities from non-controllers at discovery *and* at invocation: for an analyst the capability does not exist, which is exactly what a probing model should learn.

## The third shape: a contextual reference

A domain capability can be made reachable **only through the live UI**, with its input bound to what the user is looking at. That takes four declarations: the procedure opting out of direct exposure, the frontend manifest admitting it, a `defineAgentProcedureContract` declaring what the model sees, and the owning component binding it:

```tsx
useAgentProcedure(updateCollectionStatusContract, getDomainRefs()["update-collection-status"], {
  when: () => invoice !== null,
  unavailableReason: "Open an invoice's chase dialog first",
  bind: () => ({ invoiceId: invoice?.id ?? 0 }),   // evaluated at EXECUTION time
  describe: () => `Bound to ${invoice.reference} (${invoice.client_name}…).`,
});
```

Bound keys are **removed from the advertised input schema and locked**: supplying one anyway returns `INVALID_INPUT { lockedFields: [...] }`.

Reach for this when correctness depends on pointing at what the user is looking at, and **not** as a way to make a dangerous operation safer. A contextual binding reaches the server as `surface: "direct"`, which the model-write gate lets through by design, so binding a gated capability trades a persisted approval for a browser dialog. Bind for context; gate for consequence ([ADR-0010](../adr/0010-approvals-over-confirmations.md)).

## Hidden vs unavailable

Two different answers to two different questions, and the difference is deliberate:

| | Hidden | Unavailable |
|---|---|---|
| Cause | the identity lacks the authority | the app is not in the right state |
| The model sees | nothing, indistinguishable from a capability that never existed | the capability, `available: false`, and `unavailableReason` |
| Example | `domain:issue-invoice` for an analyst | `domain:update-collection-status` with no chase dialog open |

**Authority hides; state discloses.** A reason string is planning fuel; leaking the shape of another identity's authority is not.

## What the model receives each turn

The browser projects the live surface into wire descriptors and the server composes them with the governed domain tools for the authenticated actor. One descriptor per capability:

```ts
{ wireName, canonicalId, plane, description, inputSchema,
  effect, confirmation, available, unavailableReason? }
```

Declaring a frontend tool grants **visibility only**: the executor never leaves the tab. Duplicate paths for one operation are refused: under protocol v2 the duplicate frontend declaration is dropped, the governed server tool kept, and the reduction reported rather than silently applied. The full transport is in [Host protocol](../reference/host-protocol.md). `pnpm view:inspect` prints this exact list, and the host streams it as a `step-start` frame on every request.
