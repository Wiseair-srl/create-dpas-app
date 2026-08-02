# ADR-0008 — Model keys may be connected from the browser, in server memory only

**Status:** **superseded** · 2026-07-30 → superseded 2026-08-02

> **Superseded.** The template no longer accepts a model key from the browser.
> A provider is configured in `.env` and selected by which key is present
> (`server/mastra.ts`); the browser's model picker chooses only among ids the
> server already allows, and nothing about a key crosses to the client. See
> [Connecting a model](../guides/connecting-a-model.md) and
> [Configuration](../reference/configuration.md).
>
> The record is kept for the reasoning, not the feature.

## What it was

`POST /api/config/model` accepted a provider key from the UI and held it in
**process memory only** — never written to disk, a cookie or `process.env`, and
never echoed back (`GET /api/config` returned a `••••`+last-four hint). The
point was to go from `pnpm dev` to a working assistant without editing a file.

## Why it went

The invariant that killed it is the one that made it development-only from the
start: **a server process is shared, and a key held in it is shared with every
visitor of that deployment.** The original decision guarded this with an
`ALLOW_RUNTIME_MODEL_KEY` flag defaulting off in production — but a security
property maintained by a flag someone can flip is a weaker claim than the same
property maintained by the absence of the code path. Removing the endpoint makes
"no user-supplied key is ever accepted" checkable by grep rather than by
reasoning about an environment variable.

The convenience it bought also shrank: one `.env` line and a restart is the
whole setup, and everything except the copilot's ability to think works before
that.

## What is still true

Mastra's model router **strips the leading provider segment** before calling
upstream, so a bare `anthropic/claude-sonnet-4.5` reaches OpenRouter as
`claude-sonnet-4.5` — not a valid id there — and the run dies with OpenRouter's
*"No endpoints found that support tool use"*, which points at the tools rather
than at the real cause. The app prefixes the gateway for you
(`openrouter/anthropic/claude-sonnet-4.5`), which is also why OpenRouter's own
meta-models need it twice (`openrouter/openrouter/auto`). Never strip a leading
`openrouter/`. Direct providers are unaffected — their APIs want the bare id,
which is exactly what stripping produces.

That behaviour outlived the feature it was found in, and is documented for
readers in [Connecting a model](../guides/connecting-a-model.md).
