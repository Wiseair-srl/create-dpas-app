# ADR-0002 — Application-owned host protocol instead of `@assistant-ui/react-ai-sdk`

**Status:** accepted · 2026-07-30

## Context

The agent-surface integration guide (docs/16, explicitly non-executable)
sketches the live topology with `useChatRuntime` + `frontendTools` from
`@assistant-ui/react-ai-sdk`. Two facts changed the calculus:

1. **Version split-brain.** `@orpc-agent/ai-sdk@1.0.0` peers on `ai@^5`.
   Current `@assistant-ui/react-ai-sdk@1.4.x` hard-depends on `ai@^7`
   (1.0–1.1 → ai5, 1.2–1.3 → ai6, 1.4 → ai7). Using it means either pinning a
   year-old assistant-ui adapter line into a brand-new scaffold or running two
   `ai` majors with an unverified wire-protocol match between Mastra's v5
   UI-message stream and an ai7 client.
2. **DPAS §11.1** requires a versioned browser-server transport owned by the
   Agent Host, with correlation, typed errors, confirmation transport, and
   protocol versioning — and allows "an application-specific protocol" as long
   as it stays an adapter concern. The build directive independently requires
   `protocol.ts`, `correlation.ts`, typed transport errors in the host.

## Decision

The Agent Host implements **DPAS host protocol v1**: a stateless step-loop.

- Browser → server: one POST per model step-run carrying
  `{ protocolVersion, conversationId, turnId, modelMessages, frontendTools }`
  where `frontendTools` are wire descriptors projected from the live Agent
  Surface toolset (declaration only — execution stays in the browser).
- Server → browser: NDJSON frames mapped 1:1 from Mastra `fullStream` chunks
  (`text-delta`, `tool-call`, `tool-result`, `step-finish`, `finish`, `error`)
  plus host frames (`catalog`, `inspector`) carrying correlation ids.
- When a run finishes with `finishReason: "tool-calls"` on frontend tools, the
  browser executes them through the Agent Surface toolset (confirmation waits
  happen **here, between requests** — no server stream held open), appends
  tool results to the model messages, and POSTs the next step.

The chat UI uses `@assistant-ui/react` (latest, 0.15.x) through
`useExternalStoreRuntime` for **both** live and guided modes; tool renderers
and the thread UI are shared. Verified by spike: Mastra `clientTools` end the
run at the client tool-call, and continuation from ModelMessages with tool
results works.

## Consequences

- One `ai` major (v5) in the entire app; `@orpc-agent/ai-sdk` and Mastra agree.
- The transport is explicit, versioned, testable, and serverless-safe
  (no in-memory run state).
- Confirmation `"wait"` becomes safe (ADR-0005).
- We forgo `useChatRuntime` conveniences (auto-continue, resume); the host
  implements the step loop (~200 lines, unit-tested).
- Replaceability improves: the experience layer consumes a plain message store,
  so swapping assistant-ui means rewriting only the thread components and the
  external-store adapter, not the capability providers or the protocol.
- If a future `@assistant-ui/react-ai-sdk` line re-aligns with the `ai` major
  required by orpc-agent, a `useChatRuntime`-based transport can be offered as
  an alternative adapter without touching either capability provider.
