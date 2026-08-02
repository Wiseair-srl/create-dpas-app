# The dual-plane model

> **This page:** the idea the generated app is built around, in one read. The layer-by-layer tour is [Architecture](architecture.md); the per-capability mechanics are [Anatomy of a capability](capabilities.md).

The Dual-Plane Agent Stack (DPAS) is one sentence:

> **One agent-facing toolset, two execution planes, one authoritative path per operation.**

An assistant that can act inside a product needs two very different kinds of ability, and most stacks blur them. Driving the DOM gives you the first kind badly (brittle, unauditable, unbounded). A flat list of backend tools gives you the second kind while pretending the open page does not exist. DPAS keeps both, and keeps them apart.

## The two planes

| | `view:*` — presentation plane | `domain:*` — authoritative plane |
|---|---|---|
| **Means** | what the currently open page can observe or do | operations that are valid with no UI at all |
| **Examples** | `view:invoices.pending.setFilters`, `view:invoices.pending.selectRows` | `domain:list-invoices`, `domain:issue-invoice` |
| **Owner** | [Agent Surface](https://www.npmjs.com/package/@agent-surface/core), registered by the component that owns the state | [oRPC Agent](https://www.npmjs.com/package/@orpc-agent/core) over real oRPC procedures |
| **Lifetime** | one component mount — unmount and the capability is gone | the deployment |
| **Executes** | in this browser tab | on the server, re-authorized on every call |
| **Wrong answer to** | "read the server's data" | "select the rows the user is looking at" |

A model sees one uniform catalog across both. It never sees the difference in transport, and it can never use the difference to escape governance: the plane is a property of the capability, not a choice the model makes.

## What is *not* on either plane

There is no `click`, no `type`, no `focus`, no element selector — not restricted, **absent**. A capability is a semantic promise (*“set the filters to this”*), which is why it can be validated, made unavailable with a reason, confirmed against an exact input, and audited. If you find yourself reaching for a DOM verb, the missing piece is a capability.

## The four layers, plus a replaceable shell

```
assistant-ui  (experience: chat, streaming, tool & confirmation UX)
     ↕
Agent Host    (application-owned: protocol, composition, dispatch, correlation)
     ↕
Mastra        (runtime: planning, agent loop, run limits)
   ↙    ↘
Agent Surface        oRPC Agent
(view:* — browser)   (domain:* — server, authoritative)
```

| Layer | Implementation | Owns |
|---|---|---|
| Presentation capability provider | `@agent-surface/*` | `view:*` capabilities, lifecycle, binding, confirmation |
| Domain capability provider | `@orpc-agent/*` over [oRPC](https://orpc.unnoq.com) | `domain:*` procedures, exposure, policy, audit |
| Agent Host | **your application code**, `app/agent/host/` + `server/agent/host.ts` | protocol, per-request composition, dispatch, correlation, run limits |
| Agent Runtime | [Mastra](https://mastra.ai) | planning, the agent loop |
| Experience | [assistant-ui](https://www.assistant-ui.com) | chat, streaming, tool and confirmation UX |

The host is application code on purpose. Something has to compose the per-turn catalog, refuse duplicate paths, map canonical ids to provider-safe wire names, route each call to its executor, and carry correlation ids across the browser/server boundary — and that something must not belong to either provider or to the runtime. See [Host protocol](../reference/host-protocol.md).

## The invariants

These hold whatever the model does, because they are runtime code rather than prompt text:

1. **Deny by default on both planes.** A procedure without `meta.agent` is invisible to every agent. A component that registers nothing has no capabilities. Nothing is incidentally callable.
2. **One operation, one model-visible path.** A destructive operation is either a direct tool or a contextual reference — never both. The host rejects a catalog containing both with `CATALOG_COLLISION` (HTTP 409), per turn.
3. **A contextual reference narrows; it can never widen.** Binding, availability and confirmation constrain what the server would already have allowed. The server re-authorizes regardless.
4. **Authority hides; state discloses.** If you may not do it, it is absent — indistinguishable from never existing. If you may do it but the app is not in the right state, it is present and unavailable, *with the reason*, which is planning fuel for the model.
5. **Confirmation binds the exact input.** Minted per invocation for the effective input after binding, single-use, expiring, digest-bound. Approving one thing can never execute another.
6. **The browser is not a boundary.** Everything model-side of an adapter is untrusted input. Identity is re-derived and inputs re-validated on the server for every call; correlation metadata sent by the browser is recorded and explicitly untrusted.
7. **Errors are typed results, not exceptions.** They carry retry hints the model can act on, and they never carry internals. See [Error codes](../reference/errors.md).

## What this buys you

- **A hijacked model has a small blast radius.** It cannot invent a tool, re-aim a bound call, skip a confirmation, or reach a capability the current identity lacks. The worst case at the domain boundary is a 403 in the audit log.
- **The agent path and the human path are one implementation.** The toolbar button and the assistant call the same oRPC procedure; the assistant's filter change and the user's filter change go through the same state.
- **You can test the governance without a model.** Availability, binding, locked fields, confirmation approve/deny/expiry/mismatch, analyst/controller authority — all deterministic. See [Testing without an LLM](../guides/testing.md).

## Next

- [Anatomy of a capability](capabilities.md) — the fields, ids and lifecycle you actually write
- [Architecture](architecture.md) — why each layer exists, and the transport between them
- [Contextual domain actions](../guides/adding-a-capability.md) — the pattern invariants 2–5 exist for
