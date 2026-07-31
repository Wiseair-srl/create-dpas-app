# Anatomy of a capability

> **This page:** what a capability actually is on each plane — its identity, its fields, its lifetime, and what the model receives. The task-shaped versions are [Adding a view capability](../guides/adding-a-view-capability.md) and [Adding a domain capability](../guides/adding-a-domain-capability.md).

## Identity

Every capability has one **canonical id**, prefixed by its plane, and one **wire name** — the provider-safe form the model calls. The mapping is mechanical and reversible (`:` → `_`, `.` → `__`):

| Canonical id | Wire name |
|---|---|
| `view:devices.filters.set` | `view_devices__filters__set` |
| `view:devices.table.selectRows` | `view_devices__table__selectRows` |
| `domain:devices.list` | `domain_devices__list` |
| `domain:devices.disable` | `domain_devices__disable` |

The canonical id is the **audit identity** — it is what the timeline, the audit records and your tests refer to. The wire name exists only because model providers restrict tool-name characters. Multiple mounted instances of the same component add an `_at_<instance>` suffix to the wire name; the canonical id in front of it is unchanged.

A `domain:` capability's id is its oRPC router path: `devices.rename` in the router is `domain:devices.rename` everywhere else.

## A view capability

Registered by the component that owns the state, through `useAgentComponent`. Two kinds:

- an **observation** — a semantic read. No effect, never confirmed.
- an **action** — something that changes page state or navigates.

```tsx
useAgentComponent({
  type: "devices.filters",
  description: "Status and city filters applied to the devices table",
  observations: {
    read: observation({
      description: "Currently active filters",
      output: zs(FiltersStateSchema),
      read: () => filters,
    }),
  },
  actions: {
    set: action({
      description: "Update one or both filters; omitted fields keep their current value.",
      input: zs(FiltersPatchSchema),
      effect: "local-state",
      idempotent: true,
      execute: (patch) => onChange({ ...filters, ...patch }),
    }),
  },
});
```

| Field | Meaning |
|---|---|
| `type` + key | Together form the id: `view:devices.filters.set` |
| `description` | What the model reads. Write it for a stranger, not for you |
| `input` / `output` | Zod through `zs(…)`; validated before `execute` ever runs |
| `effect` | `local-state` or `navigation` — the only two. Anything server-side belongs to the domain plane |
| `idempotent` | Safe to repeat with the same input |
| `when` + `unavailableReason` | Present but unavailable, *with the reason the model should act on* |
| `precondition(input)` | Reject semantically invalid input with details (e.g. ids not in the current result set) |
| `confirmation` | `never` · `optional` · `required` |
| `policies` | e.g. `hasPermission(...)` — hides the capability entirely from identities that lack it |
| `execute` / `read` | Your ordinary handler. The human path calls the same one |

**Lifetime is the mount.** Registering is the only way a capability exists; unmounting removes it. The browser snapshots the live surface at the start of every protocol step, so what the model sees is what is on the page right now — and a call against a stale registration fails with `STALE_CAPABILITY` or `COMPONENT_UNMOUNTED` rather than silently hitting the wrong component.

## A domain capability

An ordinary oRPC procedure with an `agent` block in its meta. The procedure remains the single implementation for the UI, the agent and your tests.

```ts
export const listDevices = authenticated
  .meta({
    agent: {
      description: "List devices, optionally filtered by status, city, or disabled flag. Read-only.",
      expose: { aiSdk: true, test: true },
      sideEffect: "read",
      risk: "low",
    },
  })
  .input(DeviceListFilterSchema)
  .output(z.array(DeviceSchema))
  .handler(({ input, context }) => { /* … */ });
```

| Field | Meaning |
|---|---|
| `description` | What the model reads |
| `expose` | **Deny by default.** Only the surfaces you list are reachable: `aiSdk`, `mcp`, `test`, `direct`, `workflow`. No `agent` block at all means invisible to every agent |
| `sideEffect` | `none` · `read` · `write` · `destructive` · `external` — declare honestly; it drives UI treatment and review |
| `risk` | `low` · `medium` · `high` · `critical` |

Governance is not something you remember to call: every invocation, on every adapter, passes the same pipeline — exposure check, input validation, policy evaluation, execution under *your* oRPC middleware, output validation, redaction, audit. Errors reach the model in exactly two shapes: a public code and message, or a generic `INTERNAL_ERROR`.

**Policies decide by actor.** The template's `viewer-hides-writes` policy hides write capabilities from non-operators at discovery *and* at invocation — for a viewer the capability does not exist, which is exactly what a probing model should learn.

## The third shape: a contextual reference

A domain capability can be made reachable **only through the live UI**, with its input bound to what the user is looking at. That takes three declarations — the procedure opting out of direct exposure, the frontend manifest admitting it, and the owning component binding it:

```tsx
useAgentProcedure(getDomainRefs().devices.disable, {
  when: () => selectedIds.length > 0,
  unavailableReason: "Select at least one device first",
  bind: () => ({ deviceIds: selectedIds }),   // evaluated at EXECUTION time
  confirmation: "required",
});
```

Bound keys are **removed from the advertised input schema and locked**: supplying one anyway returns `INVALID_INPUT { lockedFields: [...] }`. This is the pattern the whole model exists for — see [Contextual domain actions](../guides/contextual-domain-actions.md).

## Hidden vs unavailable

Two different answers to two different questions, and the difference is deliberate:

| | Hidden | Unavailable |
|---|---|---|
| Cause | the identity lacks the authority | the app is not in the right state |
| The model sees | nothing — indistinguishable from a capability that never existed | the capability, `available: false`, and `unavailableReason` |
| Example | `domain:devices.disable` for a viewer | `domain:devices.disable` with no rows selected |

**Authority hides; state discloses.** A reason string is planning fuel; leaking the shape of another identity's authority is not.

## What the model receives each turn

The browser projects the live surface into wire descriptors and the server composes them with the governed domain tools for the authenticated actor. One descriptor per capability:

```ts
{ wireName, canonicalId, plane, description, inputSchema,
  effect, confirmation, available, unavailableReason? }
```

Declaring a frontend tool grants **visibility only** — the executor never leaves the tab. Duplicate paths for one operation are rejected for the whole turn with `CATALOG_COLLISION`. The full transport is in [Host protocol](../reference/host-protocol.md), and the Inspector's Catalog tab shows this exact list live.
