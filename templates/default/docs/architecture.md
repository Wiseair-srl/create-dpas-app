# Architecture

This app implements the **Dual-Plane Agent Stack (DPAS)**: four core layers
with explicit ownership, plus a replaceable chat shell. The point of the
architecture is a single sentence:

> One agent-facing toolset, two execution planes, one authoritative path per
> operation.

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

## Why each layer exists

**Agent Surface** ([src/agent/surface/](../src/agent/surface/), registrations in
[src/features/devices/components/](../src/features/devices/components/))
exists because "what the agent may do to the page" must be an explicit,
lifecycle-aware contract — not DOM access. Components register semantic
capabilities (`view:devices.filters.set`) that exist only while mounted,
validate input, disclose availability ("Select at least one device first"),
and reject stale calls. If a component is not annotated, it does not exist
for the agent.

**oRPC Agent** ([src/server/agent/runtime.ts](../src/server/agent/runtime.ts)
over [src/server/orpc/procedures.ts](../src/server/orpc/procedures.ts))
exists because backend operations need governance a tool list cannot provide:
deny-by-default exposure per surface, policy evaluation, input validation,
audit, and error sanitization. A procedure without `meta.agent` is invisible
to every agent. The same procedures serve the dashboard UI — one
implementation, every consumer.

**The Agent Host** ([src/agent/host/](../src/agent/host/)) exists because the
two providers must never own each other, and the runtime must not own either.
Someone has to compose the per-turn catalog, refuse duplicate paths, map
canonical ids to provider-safe wire names, route each call to its executor,
and carry correlation ids across the browser/server boundary. That someone is
application code you can read: [protocol.ts](../src/agent/host/protocol.ts)
(the versioned transport), [catalog.ts](../src/agent/host/catalog.ts),
[wire-names.ts](../src/agent/host/wire-names.ts),
[client-dispatch.ts](../src/agent/host/client-dispatch.ts),
[transport-client.ts](../src/agent/host/transport-client.ts) (browser half),
[server-compose.ts](../src/agent/host/server-compose.ts) (server half),
[identity.ts](../src/agent/host/identity.ts),
[errors.ts](../src/agent/host/errors.ts).

**Mastra** ([src/agent/runtime/](../src/agent/runtime/)) owns the reasoning
loop — model calls, tool selection, streaming — and nothing else. It consumes
tools the host composed. It cannot see React, redefine procedures, or bypass
confirmation: those properties are enforced by runtime code, not by prompt
text.

**assistant-ui** ([src/agent/experience/](../src/agent/experience/),
[src/components/assistant/](../src/components/assistant/)) renders the
conversation. It is deliberately replaceable: the adapter is one file
([runtime-adapter.tsx](../src/agent/experience/runtime-adapter.tsx)) over a
plain message store. Swapping the shell touches zero capability code.

Two details of model output live here rather than in any capability: answers
are markdown, rendered through react-markdown (a React tree, never injected
HTML); and reasoning arrives on its own protocol frame, shown as a collapsed
block so it is never mistaken for the answer. Models that leak their channel
format into visible text (`<|channel|>analysis…`) are cleaned by
[sanitize.ts](../src/agent/experience/sanitize.ts), which strips only known
control tokens and leaves ordinary prose alone.

## The transport (host protocol v1)

The host is logically one layer but physically split. The browser half and
server half speak a small versioned protocol over `POST /api/chat`:

1. The browser snapshots the live surface into wire descriptors
   (declaration only — executors stay in the tab) and sends them with the
   model-message history.
2. The server composes the catalog — governed domain tools for the
   authenticated actor + the declared frontend tools — rejects duplicate
   paths, runs one Mastra step, and streams NDJSON frames (`text-delta`,
   `tool-call`, `tool-result`, `inspector`, `step-finish`).
3. A run that stops at frontend tool-calls suspends: the browser executes
   them through Agent Surface (confirmations wait HERE, between requests — no
   stream is held open across a human decision), waits for the surface to
   absorb them, appends the results, and posts the next step.

That wait is load-bearing. A tool call returns to the loop across microtasks;
the surface it changed moves on a React commit, one macrotask later. Snapshot
immediately and step N+1 gets the surface as it was BEFORE step N acted — an
agent that navigates is told the page it just opened has no capabilities. So
the loop blocks on the registry's own version moving and then going quiet
([surface-settle.ts](../src/agent/host/surface-settle.ts)), rather than on a
guess about React's scheduler. Reads skip the gate; nothing waits longer than
750ms, except a route change, which gets 5s because a cold destination has to
load its code and its data before it registers anything at all.

One sharp edge the host absorbs: a model may call a server tool and a client
tool in the *same* message. Mastra executes the server tool but suspends for
the browser without emitting that result — it appears in neither
`fullStream` nor `stream.toolResults`. The host captures domain results as
they are produced and answers any call Mastra left open
([server-compose.ts](../src/agent/host/server-compose.ts),
`settleOrphanedServerCalls`). Without it the model would receive a tool-call
with no tool-result — which providers reject — and the UI would show a card
stuck on "running".

The server keeps no run state; the messages are the state. Run limits (max
steps, turn deadline, repeated-failure loop detection, model inactivity
timeout) live in host code on both sides.

## State, identity, reconciliation

- **Application state** is React Query + the oRPC procedures. After a domain
  mutation the agent's invocation settles, the registry emits
  `invocation-settled`, and [wiring.tsx](../src/agent/surface/wiring.tsx)
  invalidates the devices query — the same path a button click uses.
  Conversation history is never application state.
- **Identity** is server-resolved on every request
  ([src/server/auth/session.ts](../src/server/auth/session.ts)). The browser
  reads it to shape UI policy; the server re-derives it independently for
  every oRPC call and every chat step.
- **The store** ([src/server/db/](../src/server/db/)) is a zero-configuration
  embedded JSON file. The procedures are its only callers — swap in a real
  database without touching either plane.

## Modes

- **Guided demo** (default): a deterministic runner
  ([src/agent/demo/scenario.ts](../src/agent/demo/scenario.ts)) drives the
  real pipeline. No model.
- **Live** (`MODEL_PROVIDER=anthropic|openai`): Mastra with a real model.
- **Mock** (`MODEL_PROVIDER=mock`, used by e2e): a scripted
  `LanguageModelV2` through the full live pipeline — CI never needs a key.
