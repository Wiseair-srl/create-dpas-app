# ADR 0012: Installable host boundaries for separate runtimes

Status: accepted · 2026-09-13

DPAS supports an existing application with a short-lived domain backend,
a long-lived Mastra process and browser-owned presentation capabilities. The
scaffolder's single-process AI SDK 5 application remains the default example.

Publish host integration subpaths on `create-dpas-app`. Consume structural remote
capability clients, portable schemas and governed backend outcomes. Keep domain
policy, approval decisions, stable effect identity and execution receipts in
oRPC Agent. Use Agent Surface's authenticated browser session envelopes for
live UI dispatch. Never offer one domain operation directly and contextually in
the same toolset.

Persist host run/tool/invocation correlations before dispatch. Atomic reservation
and compare-and-set are application persistence requirements; ship a Postgres
reference adapter. Missing remote outcomes stay unknown and are reconciled before
any new effect. Browser result identity remains attached to its original tab,
connection, registration and tool call.

New integrations use Mastra-owned Memory and newest-user-message input. The host
creates trusted message IDs and rejects browser-authored system/history/tool
messages. Backend approval suspends Mastra natively. Reconstruct a fresh Agent
with the same stable ID and shared storage for each request and continuation:
Mastra 1.53 can retain original tool executor closures on same-instance resume.
Tests invalidate old credentials and verify the rebuilt client is used.

The host kit does not implement a workflow engine, active-run recovery or a
multi-replica lease. Applications configure their pinned Mastra durability and
run ownership facilities and test process replacement separately. Ship a local
three-process reference using a scripted model to test the actual runtime
boundaries without cloud credentials.
