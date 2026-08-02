# The dual-plane model

> **This page:** the idea the generated app is built around, in one read. The layer-by-layer tour is [Architecture](architecture.md); the per-capability mechanics are [Anatomy of a capability](capabilities.md).

## The problem

An assistant that can *act* inside a product needs two very different abilities, and the two common ways of giving it them each supply one and botch the other.

**Drive the browser.** Let the model click, type and select. It can now do anything the user can see — and nothing about it survives contact with reality. A renamed test id breaks it. Nobody can say what it is *allowed* to do, because the answer is "whatever is on screen". The audit log records `click(#btn-4)`, which tells you nothing six weeks later. And a model that has been talked into something by a poisoned invoice memo has the same reach as one that has not.

**Give it a list of backend tools.** Now every call is validated, authorized and audited — real governance. But the assistant is blind to the product the user is actually looking at. *"Select the overdue ones"* has no answer, because "the overdue ones" is a property of a filtered table in a browser tab, and the tool list has never heard of it. So people bolt a DOM escape hatch onto the side, and inherit the first problem anyway.

The two abilities are not the same thing, and the mistake is treating them as one list.

## The idea

> **One agent-facing toolset, two execution planes, one authoritative path per operation.**

The model sees a single uniform catalog. Underneath, each capability belongs to exactly one plane, and the plane is a property of the capability — never a choice the model makes, so the difference can never be used to escape governance.

| | `view:*` — presentation plane | `domain:*` — authoritative plane |
|---|---|---|
| **Means** | what the currently open page can observe or do | operations that are valid with no UI at all |
| **Examples** | `view:invoices.pending.setFilters`, `view:invoices.pending.selectRows` | `domain:list-invoices`, `domain:issue-invoice` |
| **Owner** | [Agent Surface](https://www.npmjs.com/package/@agent-surface/core), registered by the component that owns the state | [oRPC Agent](https://www.npmjs.com/package/@orpc-agent/core) over real oRPC procedures |
| **Lifetime** | one component mount — unmount and the capability is gone | the deployment |
| **Executes** | in this browser tab | on the server, re-authorized on every call |
| **Wrong answer to** | "read the server's data" | "select the rows the user is looking at" |

## What is *not* on either plane

There is no `click`, no `type`, no `focus`, no element selector — not restricted, **absent**. A capability is a semantic promise (*"set the filters to this"*), which is why it can be validated, made unavailable with a reason, bound to an exact input, and audited under a name that still means something later. If you find yourself reaching for a DOM verb, the missing piece is a capability.

## Bind for context, gate for consequence

Two planes leave one genuine judgement call, and it is the one worth getting right:

> **Bind for context. Gate for consequence.**

**Bind** when the operation's *correctness* depends on what the user is looking at. It becomes a contextual reference: reachable only through the live screen, with its target taken from the component's own state and **removed from the advertised input schema**. The model is not asked to leave the target alone — it is given no field in which to name a different one.

**Gate** when the operation's *risk* is simply what it does. It stays a direct governed tool, and a model-initiated call suspends into a server-side approval record that a human decides. The same call from the app's own button passes ungated: a person clicking in their own session has already expressed intent.

Reaching for the first to make the second safer is the expensive mistake, and the template is built to make it obvious. A contextual binding arrives at the server as an ordinary direct call — which the gate lets through by design — so binding a gated capability trades a persisted approval for a browser dialog. See [ADR-0010](../adr/0010-approvals-over-confirmations.md).

## What this buys you

**A hijacked model has a small blast radius.** It cannot invent a tool, re-aim a bound call, skip an approval, or reach a capability the current identity lacks. Prompt injection stops being a question of whether the model can be fooled — assume it can — and becomes a question of what a fooled model is able to reach. The worst case at the domain boundary is a 403 in the audit log.

**"What can the assistant do here?" is a question with an answer.** Both planes compile to committed inventories you diff like an API: a changed description is a changed prompt, a capability that gains a surface has gained an audience. You review that in a pull request instead of discovering it in production.

**The agent path and the human path are one implementation.** The toolbar button and the assistant call the same oRPC procedure. The assistant's filter change and the user's filter change go through the same setter, so the URL moves either way and the view the agent produced is one you can bookmark and share. There is no second, quieter code path to keep in agreement — or to attack. That extends to the client cache: an agent write invalidates it exactly as a click does, and because the two planes execute in different processes it takes two triggers to say one thing — the surface subscription for what runs in the browser, the stream consumer for what runs in the model loop. Wire only the first and agent writes refresh the screen *sometimes*, which reads as a flaky UI rather than a missing trigger.

**You can test all of it without a model.** Availability, binding, locked fields, approve/deny/expiry/mismatch, analyst-versus-controller authority — every one is deterministic, because every one is runtime code rather than prompt text. CI never needs a credential. See [Testing without an LLM](../guides/testing.md).

**Nothing here is enforced by the prompt.** Delete every instruction the app gives the model and availability, schema surgery, approvals and server authorization are unchanged. That is the property the rest of the list depends on.

## The invariants

These hold whatever the model does:

1. **Deny by default on both planes.** A procedure without `meta.agent` is invisible to every agent. A component that registers nothing has no capabilities. Nothing is incidentally callable.
2. **One operation, one model-visible path.** A destructive operation is either a direct tool or a contextual reference — never both. The host refuses to offer a capability twice, and reports the reduction rather than applying it silently.
3. **A contextual reference narrows; it can never widen.** Binding, availability and confirmation constrain what the server would already have allowed. The server re-authorizes regardless.
4. **Authority hides; state discloses.** If you may not do it, it is absent — indistinguishable from never existing. If you may do it but the app is not in the right state, it is present and unavailable, *with the reason*, which is planning fuel for the model.
5. **Approval binds the exact input.** Bound to the validated input by hash, single-use, expiring. Approving one thing can never execute another.
6. **The browser is not a boundary.** Everything model-side of an adapter is untrusted input. Identity is re-derived and inputs re-validated on the server for every call; correlation metadata sent by the browser is recorded and explicitly untrusted.
7. **Errors are typed results, not exceptions.** They carry retry hints the model can act on, and they never carry internals. See [Error codes](../reference/errors.md).

## Where the layers sit

```
assistant-ui  (experience: chat, streaming, tool & approval cards)
     ↕
Agent Host    (application-owned: protocol, composition, dispatch, correlation)
     ↕
Mastra        (runtime: planning, agent loop, run limits)
   ↙    ↘
Agent Surface        oRPC Agent
(view:* — browser)   (domain:* — server, authoritative)
```

The host is application code on purpose. Something has to compose the per-turn catalog, refuse duplicate paths, map canonical ids to provider-safe wire names, route each call to its executor, and carry correlation ids across the browser/server boundary — and that something must not belong to either capability provider or to the runtime, or the layer deciding what the model may see each turn is the one layer nobody in the application can read. [Architecture](architecture.md) walks each layer; [Host protocol](../reference/host-protocol.md) is the contract between the two halves.

## Next

- [Anatomy of a capability](capabilities.md) — the fields, ids and lifecycle you actually write
- [Architecture](architecture.md) — why each layer exists, and the transport between them
- [Adding a capability](../guides/adding-a-capability.md) — domain, view and contextual, in code
