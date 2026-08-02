# Architecture

This app implements the **Dual-Plane Agent Stack**: two capability providers,
an application-owned host between them and the runtime, and a replaceable chat
shell. The point of the whole arrangement is one sentence:

> One agent-facing toolset, two execution planes, one authoritative path per
> operation.

```
assistant-ui   (experience: thread, streaming, tool cards, approval cards)
     ↕
Agent Host     (application-owned: protocol, composition, dispatch, correlation)
     ↕
Mastra         (runtime: planning, the agent loop, run limits)
   ↙    ↘
Agent Surface        oRPC Agent
(view:* — browser)   (domain:* — server, authoritative)
```

## Why each layer exists

**Agent Surface** (`app/agent/surface/`, registrations in
`app/lib/hooks/useTableAgentComponent.ts` and the screens) exists because "what
the agent may do to the page" must be an explicit, lifecycle-aware contract —
not DOM access. Components register semantic capabilities that exist only while
mounted, validate input, disclose availability with a reason, and reject stale
calls. If a component is not annotated, it does not exist for the agent.

**oRPC Agent** (`server/runtime.ts` over `capabilities/`) exists because backend
operations need governance a tool list cannot provide: deny-by-default exposure
*per surface*, policy evaluation, input validation, approvals, audit, and error
sanitization. A procedure without `meta.agent` is invisible to every agent. The
same procedures serve the UI through `/rpc` — one implementation, every
consumer.

**The Agent Host** (`app/agent/host/`, `server/agent/host.ts`) exists because
the two providers must never own each other, and the runtime must not own
either. Someone has to compose the per-request catalog, refuse duplicate paths,
map canonical ids to provider-safe wire names, route each call to its executor,
and carry correlation ids across the browser/server boundary. That someone is
application code you can read.

**Mastra** owns the reasoning loop and nothing else. It consumes tools the host
composed. It cannot see React, redefine procedures or bypass an approval:
those properties are enforced by runtime code, not by prompt text.

## The rule that decides a capability's shape

A consequential operation gets one of two shapes, and picking the wrong one is
the most expensive mistake available here.

**Bind for context.** When correctness depends on pointing at what the user is
looking at, make it a contextual reference: `expose.aiSdk: false` on the server,
an entry in `app/agent/domain/manifest.ts`, and a `useAgentProcedure` binding in
the component that owns the state. The bound keys are *removed from the
advertised input schema*, so the model has no field in which to name a different
target. `update-collection-status` is the example.

**Gate for consequence.** When the risk is what the operation *does*, leave it a
direct governed tool and let `gateModelWrites` suspend model-initiated calls
into a server-side approval record. `issue-invoice` is the example.

Do not reach for a binding to make a dangerous operation safer. A contextual
binding reaches the server over `/rpc` as `surface: "direct"`, which the gate
lets through ungated by design — so binding a gated capability trades a
persisted, server-side approval record for a browser-side dialog. That is
weaker authority on exactly the operations that least want it.

## The transport

The host is logically one layer, physically split. The two halves speak a small
versioned protocol over `POST /agent/chat`:

1. The browser snapshots the live surface into wire descriptors (declaration
   only — executors stay in the tab) and posts them with the message history.
2. The server composes the catalog — governed domain tools for the
   authenticated actor, scoped by route, plus the declared frontend tools —
   drops duplicate paths, runs one Mastra step, and streams NDJSON frames.
3. A run that stops at frontend tool-calls suspends: the browser executes them
   through Agent Surface, waits for the surface to absorb them, appends the
   results and posts the next step.

Two details carry most of the design.

**The volatile half never enters the tool block.** Tool definitions sit at the
front of the provider prompt, so folding live availability into a description
would invalidate the cached prefix behind the whole conversation on every step.
Availability and binding text ride in a compact system message *after* the
conversation, where they cost a few hundred tokens and invalidate nothing.

**The loop waits for the surface to catch up.** A tool call returns across
microtasks; the screen it changed commits on a React render, one macrotask
later. Snapshot immediately and step N+1 gets the surface as it was *before*
step N acted — an agent that navigates is then told the page it just opened has
no capabilities. `app/agent/host/settle.ts` blocks on the registry's own version
moving and then going quiet, with a separate budget for a route change, which
genuinely takes longer.

One sharp edge the host absorbs: a model may call a server tool and a client
tool in the *same* message. Mastra executes the server tool but suspends for the
browser without emitting its result. The host captures domain results as they
are produced and answers any call Mastra left open — without it the model would
receive a tool-call with no tool-result, which providers reject, and the UI
would show a card stuck on "running".

## State, identity, reconciliation

- **Application state** is React Query over `/rpc`. After a domain mutation the
  agent's invocation settles and `app/agent/surface/wiring.tsx` invalidates the
  cache — the same path a button uses. The agent has no privileged channel.
- **Identity** is re-derived server-side on every request (`server/auth.ts`).
  The browser reads it to shape UI; it never asserts it. Correlation metadata
  the agent path attaches is recorded for audit and explicitly untrusted.
- **The conversation is not application state.** The protocol is stateless —
  the messages are the state, carried by the browser. Persistence is explicit
  and separate (`server/agent/thread-store.ts`), which is what keeps one copy of
  each message and one writer.
