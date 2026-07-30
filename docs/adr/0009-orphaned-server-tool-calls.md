# ADR-0009 — The Agent Host answers server tool calls Mastra leaves open

**Status:** accepted · 2026-07-30

## Context

Found with a live model, not by the test suite. A user asked *"disable the
offline devices in Turin and filter them in the table"*; the model replied
with one assistant message containing **both** `domain_devices__list` (a
server tool) and view tools (client tools). The view tools completed, the
table filtered correctly — and `domain:devices.list` sat on "running"
forever. The turn then stalled.

Reproduced against Mastra directly. When a step contains a server tool call
*and* a client tool call:

- the server tool **does execute** (the procedure ran, audit recorded);
- the run then suspends for the browser and **its result is dropped** — it
  appears in neither `fullStream` nor `stream.toolResults` (verified: the
  array is empty).

Two consequences, one of them serious:

1. the browser never receives a `tool-result` frame, so the card hangs;
2. the reconstructed history contains a `tool-call` with no matching
   `tool-result`. Providers reject that shape, which is what stalled the
   conversation — the visible symptom was a spinner, the real damage was a
   malformed transcript.

The scripted CI model never batched tool calls, so nothing caught it. Real
models batch constantly.

## Decision

The Agent Host wraps the domain toolset it hands to Mastra
(`withResultCapture`) and records each result by tool-call id. At step
finalization, `settleOrphanedServerCalls` answers every unresolved server
call — emitting the `tool-result` frame and appending the tool message to the
history. A call with no captured result is answered with
`TOOL_NOT_EXECUTED` / `retry: "yes"` rather than left silent, so the model
retries instead of assuming success.

This stays inside the host's remit: it composes the toolset and owns result
transport and correlation. Execution, authorization and audit remain entirely
inside the orpc-agent runtime — the wrapper only observes.

The scripted model now **batches a server tool with a client tool in its
first message**, so the deterministic e2e exercises this path on every run,
and `live-mock.spec.ts` asserts the domain card reaches `data-status="ok"`.

## Consequences

- Every `tool-call` gets a `tool-result`, in both planes, always.
- The mock is more faithful to real model behavior, which is what let the bug
  through in the first place.
- If a future Mastra release emits the dropped result itself, the settlement
  loop simply finds nothing unresolved and does nothing.
