# ADR-0002 · Application-owned host protocol instead of `@assistant-ui/react-ai-sdk`

**Status:** accepted · 2026-07-30 · **amended 2026-08-02**

> **Amendment.** The decision stands; the protocol has since moved to **v2**,
> which adds `pathname`, a catalog envelope with mode and scope, and drops a
> duplicate path instead of aborting the turn. The current contract is
> [Host protocol](../reference/host-protocol.md); the v1 shape below is the
> decision as taken.

## Context

The obvious way to wire a browser-side toolset into a chat UI is
`useChatRuntime` + `frontendTools` from `@assistant-ui/react-ai-sdk`. Two facts
ruled it out.

1. **Version split-brain.** `@orpc-agent/ai-sdk` peers on `ai@^5`, while the
   current `@assistant-ui/react-ai-sdk@1.4.x` hard-depends on `ai@^7`
   (1.0–1.1 → ai5, 1.2–1.3 → ai6, 1.4 → ai7). Using it means either pinning a
   year-old adapter line into a brand-new scaffold, or running two `ai` majors
   with an unverified wire-protocol match between the runtime's v5 UI-message
   stream and an ai7 client.
2. **The transport is load-bearing, and would not be ours.** A DPAS host needs a
   *versioned* browser↔server transport with correlation ids, typed errors, and
   somewhere for a human decision to happen that is not inside a held-open
   stream. Handing that to a dependency means the layer that decides what the
   model may see each turn is the one layer nobody in the application can read.

## Decision

The Agent Host implements the **DPAS host protocol**: a stateless step-loop, as
application code.

- Browser → server: one POST per model step-run carrying the protocol version,
  conversation and turn ids, the model messages, and wire descriptors projected
  from the live Agent Surface toolset: declaration only, execution stays in the
  browser.
- Server → browser: NDJSON frames mapped from the runtime's stream chunks, plus
  host frames carrying correlation ids.
- When a run ends at frontend tool calls, the browser executes them through
  Agent Surface, appends the results to the model messages, and POSTs the next
  step. **Confirmation waits happen here, between requests**: no server stream
  is held open across a human decision.

The chat UI uses `@assistant-ui/react` through `useExternalStoreRuntime`, so the
experience layer consumes a plain message store rather than owning the loop.

## Consequences

- One `ai` major in the entire app; `@orpc-agent/ai-sdk` and the runtime agree.
- The transport is explicit, versioned, unit-testable, and serverless-safe:
  the server holds no run state, because the messages *are* the state.
- Confirmation `wait` becomes safe ([ADR-0005](0005-confirmation-wait-between-steps.md)).
- We forgo `useChatRuntime` conveniences (auto-continue, resume); the host
  implements the step loop itself.
- Replaceability improves in both directions: swapping assistant-ui means
  rewriting the thread components and the external-store adapter, not the
  capability providers or the protocol. And if a future
  `@assistant-ui/react-ai-sdk` line re-aligns with the `ai` major orpc-agent
  requires, a `useChatRuntime` transport can be offered as an alternative
  adapter without touching either capability provider.
- The ceiling of this protocol is now the application's problem rather than a
  dependency's: the catalog limits, the scoping rules and the cache-stability
  design in [Host protocol](../reference/host-protocol.md) all follow from that.
