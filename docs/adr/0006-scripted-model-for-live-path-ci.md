# ADR-0006 — Scripted `LanguageModelV2` for credential-free live-path testing

**Status:** accepted · 2026-07-30

Unit tests reach the browser half (surface registration, availability,
bindings) and the server half (exposure, policy, approvals) separately, but
neither exercises the seam between them: the chat route → Mastra loop → domain
toolset → client-tool suspension → browser dispatch → reconciliation. That path
is where the interesting failures live, and CI must never depend on a model
provider to reach it.

Decision: `MODEL_PROVIDER=mock` (test-only) wires a hand-written scripted
`LanguageModelV2` into the same Mastra agent live mode uses. The script follows
one scenario — read the ageing ladder, narrow the table, read it back,
summarize — and deliberately batches a **server tool and a client tool in the
same message**, because that is the case that suspends the run mid-step and
makes the host answer the server call itself (ADR-0009). Playwright runs the
suite in this mode, so the *entire* production pipeline — route, per-request
catalog composition, collision check, NDJSON frames, browser dispatch, oRPC
execution, reconciliation — is exercised with zero credentials.

`ai/test`'s `MockLanguageModelV2` is not used: it drags `msw` into the runtime
graph. The mock is ~80 lines of plain `LanguageModelV2` implementation.
