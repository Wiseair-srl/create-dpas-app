# ADR-0006 — Scripted `LanguageModelV2` for credential-free live-path testing

**Status:** accepted · 2026-07-30

The deterministic guided demo drives the browser half (surface, confirmation,
contextual oRPC call) without a model, but it does not exercise the server
half of the live path (chat route → Mastra loop → domain toolset →
client-tool suspension). CI must never depend on a model provider.

Decision: `MODEL_PROVIDER=mock` (test-only, undocumented in the README's main
flow) wires a hand-written scripted `LanguageModelV2` into the same Mastra
agent used by live mode. The script follows the golden scenario: filter → read
→ select → disable → summarize. Playwright runs one E2E pass in this mode, so
the *entire* production pipeline — route, per-turn catalog composition,
collision check, NDJSON frames, browser dispatch, confirmation, oRPC
execution, reconciliation — is exercised with zero credentials.

`ai/test`'s `MockLanguageModelV2` is not used: it drags `msw` into the runtime
graph. The mock is ~80 lines of plain `LanguageModelV2` implementation.
