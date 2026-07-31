# Configuration

> **This page:** every environment variable the generated app reads. All of them are server-side; none is ever exposed to the browser.

The generated `.env` comes from the template's `.env.example` with `MODEL_PROVIDER` set to your CLI choice and **every key left commented**. The app runs with all of it unset.

## Variables

| Variable | Values | Default | Effect |
|---|---|---|---|
| `MODEL_PROVIDER` | `demo` · `anthropic` · `openai` · `openrouter` · `mock` | `demo` | Which model backs the live chat path. `demo` = guided demo only; `mock` = the scripted model used by e2e |
| `MODEL_ID` | provider model id | per provider (below) | Overrides the model for the selected provider |
| `ANTHROPIC_API_KEY` | secret | — | Required by `MODEL_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | secret | — | Required by `MODEL_PROVIDER=openai` |
| `OPENROUTER_API_KEY` | secret | — | Required by `MODEL_PROVIDER=openrouter` |
| `ALLOW_RUNTIME_MODEL_KEY` | `true` · `false` | dev: on, production: off | Whether a key may be connected from the assistant panel |
| `AUTH_SECRET` | secret | `dpas-dev-secret-change-me` | HMAC secret for the demo session cookie. **Change it before sharing a deployment** |
| `DPAS_DATA_DIR` | path | `<cwd>/.data` | Where the embedded JSON store writes `db.json` |
| `NODE_ENV` | standard | — | Production disables runtime key entry unless `ALLOW_RUNTIME_MODEL_KEY=true` |

Default model ids: `anthropic` → `anthropic/claude-sonnet-4-5`; `openai` → `openai/gpt-5.1`; `openrouter` → `anthropic/claude-sonnet-4.5` (the app adds the `openrouter/` gateway prefix; the model must support tool calling).

## Precedence

1. A key connected at runtime from the assistant panel (process memory only) wins while it is set.
2. Otherwise `MODEL_PROVIDER` plus the matching key from the environment.
3. A provider selected **without** its key is not live: the app stays in guided-demo mode instead of failing at request time.

## Rules the app enforces

- **No secret reaches the browser.** `GET /api/config` returns the provider, the model id and a masked hint (`••••1234`) — never the key. Nothing model-related is read outside route handlers, and no key is ever placed in a `NEXT_PUBLIC_*` variable.
- **A runtime key is never persisted.** It is not written to disk, not copied into an env var, not logged, and it is gone on restart ([ADR-0008](../adr/0008-runtime-model-credentials.md)).
- **The scaffolder writes no secrets.** Generated `.env` files select a provider; keys stay commented with a pointer to where they go.

## Ports

`next dev` and `next start` use `3000` unless you pass `-p`. The Playwright suite builds and serves on `3100` so it never collides with a running dev server.
