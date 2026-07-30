# ADR-0008 — Model keys may be connected from the UI, in server memory only

**Status:** accepted · 2026-07-30

## Context

Requiring a `.env` edit plus a restart before the assistant can say anything
is a poor first experience for a scaffold whose selling point is "runs
immediately". OpenRouter is the natural fit: one key reaches many models.

But the DPAS security model is explicit that the browser is not a trusted
boundary and that no secret may reach a client bundle, so "let the user paste
a key" has to be designed rather than bolted on.

## Decision

`POST /api/config/model` accepts `{ provider: "openrouter", apiKey, modelId }`.
The key is stored in **process memory only**
(`src/server/model-config.ts`) and used solely to construct the Mastra model —
Mastra's model router accepts an inline `{ id, apiKey }`, so the credential
never has to be written into `process.env` either.

Invariants, each covered by a test:

- No response ever contains the key. `GET /api/config` returns provider,
  model id, and `keyHint` = `••••` + last four characters.
- Nothing is persisted: no disk write, no cookie, no env mutation. A restart
  clears it, which the UI states plainly.
- Runtime entry is **off in production** unless `ALLOW_RUNTIME_MODEL_KEY=true`,
  because a single process shares one key with every visitor. It is on in
  development, where the process belongs to one developer.
- Key verification against OpenRouter is a **separate, explicit** action
  ("Test key"), so saving stays deterministic and offline-friendly and the
  test suite never depends on the network.

Runtime configuration is scoped to OpenRouter. Anthropic and OpenAI remain
env-configured; adding them would mean provider-specific verification and a
wider attack surface for no additional demonstration value.

## Consequences

- A generated app goes from `pnpm dev` to live chat without touching a file.
- `.env` remains the right answer for deployments, and the docs say so.
- The scaffold models the honest handling of a user-supplied secret — a
  question every adopter of this architecture will face — instead of
  side-stepping it.
