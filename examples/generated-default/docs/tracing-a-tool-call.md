# Tracing a tool call, end to end

Run the guided demo, open **Inspector → Timeline**, and follow one call —
here `domain:devices.disable` — through every layer. This document maps each
timeline event to the code that emitted it.

## The identifiers

| Id | Minted by | Meaning |
|---|---|---|
| `conversationId` | browser ([identity.ts](../src/agent/host/identity.ts)) | one chat thread |
| `turnId` | browser | one user message and everything it causes |
| `stepId` | server ([server-compose.ts](../src/agent/host/server-compose.ts)) | one protocol step (one Mastra run) |
| `toolCallId` | the model (or the demo runner) | one tool invocation attempt |
| `invocationId` | = `toolCallId`, passed into Agent Surface | dedupe key: a retried transport can never double-execute |
| `confirmationId` | Agent Surface confirmation controller | one single-use approval, bound to one effective input |
| `registrationId` | Agent Surface registry | one mount lifetime of a capability |
| `executionId` | oRPC Agent runtime | one governed server execution |

One tuple ties a row together: `turnId · toolCallId/invocationId ·
capabilityId (canonical id) · confirmationId?`.

## Following the destructive call

1. **`host / step-request`** — the browser snapshots the live surface and
   posts step N ([transport-client.ts](../src/agent/host/transport-client.ts)).
   The frame notes the surface version and how many frontend tools were
   declared.
2. **`host / step-start`** — the server composed the catalog: governed domain
   tools for YOUR session + the declared frontend tools, collision-checked
   ([server-compose.ts](../src/agent/host/server-compose.ts)).
3. **model calls the tool** — in live mode a `tool-call` frame streams back
   with `executor: "browser"`; in the demo the runner emits the same shape
   ([scenario.ts](../src/agent/demo/scenario.ts)).
4. **`host / dispatch`** — the browser resolves the wire name against the
   LIVE toolset and executes through Agent Surface with
   `invocationId = toolCallId`
   ([client-dispatch.ts](../src/agent/host/client-dispatch.ts)).
5. **`surface / confirmation-requested`** — the binding evaluated the live
   selection; the controller minted `cnf_…` for that exact input. The card
   you see is rendered from this record
   ([confirmation-card.tsx](../src/agent/experience/confirmation-card.tsx)).
6. **`surface / confirmation-resolved`** — your decision. On approve, the
   toolset retries internally with the evidence attached.
7. **`surface / invocation-settled`** — the capability executed. For this
   contextual reference that means: authenticated oRPC call with
   `x-dpas-invocation-id` and `x-dpas-confirmation-id` headers
   ([registry.ts](../src/agent/surface/registry.ts) `callContext`).
8. **`domain / devices.disabled`** — the authoritative audit record written
   by the procedure itself, carrying the correlation ids as untrusted
   metadata ([procedures.ts](../src/server/orpc/procedures.ts)). In live mode
   this arrives over the stream as an `inspector` frame; governance events
   from oRPC Agent (`capability.started/completed`) appear the same way for
   direct tools.
9. **reconciliation** — `invocation-settled(ok)` for
   `domain:devices.disable` invalidates the devices query
   ([wiring.tsx](../src/agent/surface/wiring.tsx)); the table re-renders from
   fresh server data. The demo then re-reads the table state and reports the
   VERIFIED outcome — never an assumed one.

## Batched tool calls

A model often calls several tools in one message — sometimes a server tool
and a browser tool together. When that happens Mastra runs the server tool
but suspends the step for the browser without reporting the server result, so
the Agent Host answers that call from the result it captured while the tool
ran. In the timeline you will still see a matching `tool-result` for every
`tool-call`; if a call could not be answered at all, the model receives
`TOOL_NOT_EXECUTED` with `retry: "yes"` rather than silence.

## Reading failures

Failures are typed results, not exceptions, and each carries a retry hint:

- `CAPABILITY_NOT_AVAILABLE { reason }` → do the enabling step first;
- `INVALID_INPUT { lockedFields }` → the model tried to override a binding;
- `CONFIRMATION_INVALID { reason: denied | expired | consumed | mismatch }`;
- `STALE_CAPABILITY` / `COMPONENT_UNMOUNTED` → re-read the surface;
- `CATALOG_COLLISION` (HTTP 409) → configuration error: one operation, two paths.

The tool cards render the same payloads the model sees — if you can read the
card, you can read the transcript the model reasoned over.

## Server-side records

Beyond the inspector (which is per-tab), the server keeps a bounded audit
ring ([src/server/audit/log.ts](../src/server/audit/log.ts)) with every
domain record and governance event. Swap the sink for your telemetry pipeline
in one place ([src/server/agent/runtime.ts](../src/server/agent/runtime.ts)).
