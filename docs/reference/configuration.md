# Configuration

> **This page:** every environment variable the generated app reads. All of them are server-side; none is ever exposed to the browser.

The generated `.env` comes from the template's `.env.example` with **every key left commented**, except the one line your `--model-provider` choice uncommented, which arrives empty. The app runs fully with all of it unset: the screens, the governed data layer, the approval flow and the MCP endpoint need nothing. A key adds one thing, the copilot's ability to think.

## Variables

| Variable | Values | Default | Effect |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | unset | Enables the Anthropic models in the picker |
| `OPENROUTER_API_KEY` | secret | unset | Enables the OpenRouter models in the picker |
| `ANTHROPIC_MODELS` | comma-separated ids | `claude-sonnet-4-5,claude-haiku-4-5` | Overrides the built-in Anthropic allowlist |
| `OPENROUTER_MODELS` | comma-separated ids | `anthropic/claude-sonnet-4.5,deepseek/deepseek-chat-v3.1` | Overrides the built-in OpenRouter allowlist |
| `DEFAULT_MODEL` | `provider/id` | `anthropic/claude-sonnet-4-5` | The model a turn runs on when the browser names none. Ignored unless it is one of the allowed ids |
| `AUTH_SECRET` | secret | `dpas-dev-secret-change-me` | HMAC secret for the demo session cookie. **Change it before sharing a deployment** |
| `PORT` | number | `3001` (server) · `3000` (Vite) | In production, where the one process listens. In development, where **Vite** listens |
| `SERVER_PORT` | number | `3001` | Development only: where the Hono server listens, and what Vite proxies to |
| `DPAS_DATA_DIR` | path | `<cwd>/.data` | Where the embedded store writes `db.json` and `threads.json` |
| `MODEL_PROVIDER` | `mock` | unset | Test hook only. `mock` swaps in the scripted `LanguageModelV2` the e2e suite runs on |

**There is no provider switch.** The app decides which providers are available from **which keys are set** (`allowedModels()` in `server/mastra.ts`), so there is no second source of truth to keep in agreement with them. Setting a key enables its models; setting none leaves the composer inert and saying so.

## Ports, and why there are two names

Development runs two processes. Vite serves the SPA and proxies `/rpc`, `/agent`, `/api` and `/mcp` to the Hono server; production runs one process that serves all of it.

`PORT` therefore means "where the app is reachable", which in development is Vite. If the server read `PORT` too, both would bind the same port, the proxy would target itself, and every `/rpc` call would come back as the SPA's `index.html`. So the server reads `SERVER_PORT` first and the `dev` script sets it explicitly; in production only one process is listening and `PORT` is unambiguous.

The Playwright suite builds and serves on `3210` with `DPAS_DATA_DIR=.data-e2e`, so it collides with neither a running dev server nor your own ledger.

## Model ids

Each list holds the provider's **own** ids; the provider prefix is added for you. Mastra's model router splits on the first slash, so an OpenRouter meta-model genuinely needs the gateway segment twice (`openrouter/openrouter/auto`). Never strip a leading `openrouter/`.

The browser's model picker is a **request**, not an instruction: the server checks whatever arrives against its own allowlist and falls back to the default when it does not match. Identity and authority never come from there.

## Rules the app enforces

- **No secret reaches the browser.** The agent loop runs server-side, so the client never needs a model key and is never sent one. `GET /api/session` returns the user, the allowed model ids and the default, never a key.
- **The scaffolder writes no secrets.** A generated `.env` is a form to fill in: the chosen provider's key line is uncommented and empty, and every other stays commented.
- **A key is read once, at boot.** `server/env.ts` loads `.env` and nothing re-reads it per request.
