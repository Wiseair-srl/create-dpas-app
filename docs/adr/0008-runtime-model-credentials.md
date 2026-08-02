# ADR-0008 — Model keys may be connected from the UI, in server memory only

**Status:** superseded · 2026-07-30 → **superseded 2026-08-02**

> **Superseded.** The template no longer accepts a model key from the browser.
> The reasoning below about *why that was dangerous* is still worth reading —
> one process shares the key with every visitor, which is why it was
> development-only — but the feature is gone rather than guarded. A provider is
> configured in `.env` and selected by which key is present
> (`server/mastra.ts`), and the browser's model picker chooses only among ids
> the server already allows. Nothing about a key crosses to the client.

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

## Gateway model ids (added after a live-key failure)

Mastra's model router **strips the leading provider segment** before calling
upstream. A bare `anthropic/claude-sonnet-4.5` therefore reached OpenRouter
as `claude-sonnet-4.5` — not a valid id there — and the run died with
OpenRouter's *"No endpoints found that support tool use"*, which points at
the tools rather than the real cause.

`toRouterModelId()` prefixes the gateway, so `openrouter/anthropic/claude-
sonnet-4.5` sends `anthropic/claude-sonnet-4.5` upstream. Users may type
either form. Verified by driving Mastra against a local stub and reading the
request body; pinned by a regression test. The env-configured
`MODEL_PROVIDER=openrouter` path had the same defect and the same fix.
Direct providers (Anthropic, OpenAI) are unaffected — their APIs want the
bare model id, which is exactly what stripping produces.

"Test key" additionally verifies the model exists on OpenRouter and lists
`tools` in its supported parameters, so this class of failure is diagnosed
before a conversation rather than during one.

## Consequences

- A generated app goes from `pnpm dev` to live chat without touching a file.
- `.env` remains the right answer for deployments, and the docs say so.
- The scaffold models the honest handling of a user-supplied secret — a
  question every adopter of this architecture will face — instead of
  side-stepping it.
