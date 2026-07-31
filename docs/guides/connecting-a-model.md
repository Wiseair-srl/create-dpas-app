# Connecting a model

> **This page:** the three ways the generated app runs an agent — and where a key may live. Full variable list: [Configuration](../reference/configuration.md).

## Three modes

| Mode | How | Model | Use for |
|---|---|---|---|
| **Guided demo** (default) | nothing to configure | none — a deterministic runner drives the real pipeline | first run, demos, screenshots |
| **Live** | `MODEL_PROVIDER` + key, or a key pasted into the UI | a real provider | actual agent work |
| **Mock** | `MODEL_PROVIDER=mock` | a scripted `LanguageModelV2` | e2e and CI, with no credentials |

All three go through the same host protocol, the same catalog composition and the same confirmation flow. The guided demo is not a simulation of the pipeline — it *is* the pipeline, with the model replaced by a script.

## From the UI (development)

Click the settings icon in the assistant panel, paste an [OpenRouter](https://openrouter.ai/keys) key, pick a model. No restart.

- The key is posted once to `POST /api/config/model` and held in **that server process's memory**. It is never written to disk, never copied into an env var, never logged, and never serialized back — `GET /api/config` returns the provider, the model id and a masked hint (`••••1234`).
- The browser never needs it: the agent loop runs server-side.
- Restarting the process clears it.
- A runtime key takes **precedence** over `.env` while it is set.

**The guard that matters:** one process shares that key with every visitor, so runtime entry is **enabled in development and disabled in production builds**. `ALLOW_RUNTIME_MODEL_KEY=true` opts a single-user deployment back in; `false` refuses everywhere. See [ADR-0008](../adr/0008-runtime-model-credentials.md).

## From `.env` (deployments)

```bash
MODEL_PROVIDER=openrouter    # demo | anthropic | openai | openrouter | mock
OPENROUTER_API_KEY=sk-or-...  # or ANTHROPIC_API_KEY / OPENAI_API_KEY
# MODEL_ID=                   # optional override
```

Default model ids per provider:

| `MODEL_PROVIDER` | Key | Default `MODEL_ID` |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-5` |
| `openai` | `OPENAI_API_KEY` | `openai/gpt-5.1` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.5` |
| `demo` | — | — (guided demo only) |
| `mock` | — | — (scripted model) |

A provider selected without its key stays non-live: the app falls back to the guided demo rather than failing at request time.

::: warning OpenRouter model ids carry a gateway prefix
Mastra's model router strips the leading segment before calling upstream, so a bare `anthropic/claude-sonnet-4.5` would reach OpenRouter as `claude-sonnet-4.5` — not a valid id there. The app prefixes the gateway (`openrouter/anthropic/claude-sonnet-4.5`) so the vendor segment survives. You may type either form. The model must support **tool calling**; one that does not fails with *“No endpoints found that support tool use”*.
:::

## What the model actually gets

Per protocol step, the composed catalog is: the governed `domain:*` tools your identity may see, plus the `view:*` capabilities currently mounted in the tab — each with a description, JSON Schema input, effect, confirmation requirement and availability. Instructions live in `src/agent/runtime/instructions.ts`; the Mastra agent itself is `src/agent/runtime/mastra.ts` and owns nothing but the loop.

Run limits are host code, not prompt text:

| Limit | Value | Where |
|---|---|---|
| Model steps per protocol request | 5 | `RUN_LIMITS.maxStepsPerRequest` |
| Inactivity between stream chunks | 45 s | `RUN_LIMITS.modelTimeoutMs` |
| Protocol steps per turn | 8 | `MAX_STEPS_PER_TURN` |
| Turn deadline | 180 s | `TURN_DEADLINE_MS` |
| Identical consecutive failures | 3 | `MAX_IDENTICAL_FAILURES` |

## Try it

Restart, then ask:

> *Show me the offline devices in Milan, select the visible devices, and disable them.*

Mastra plans over the composed catalog. View tools stream back to your browser and execute there; the destructive call still ends in the same confirmation card, bound to the same live selection. The guided demo keeps working regardless of what is configured.

## When it does not work

| You see | Meaning |
|---|---|
| `MODEL_NOT_CONFIGURED` | No live provider: no key for the selected provider, or `MODEL_PROVIDER=demo` |
| `MODEL_TIMEOUT` | No chunk for 45 s — usually an upstream stall |
| `MODEL_ERROR` | The provider rejected the request. A model without tool-calling support is the common cause |
| `RUN_LIMIT_EXCEEDED` | A limit above was hit; the message says which |
| The settings panel refuses the key | Runtime entry is off — a production build without `ALLOW_RUNTIME_MODEL_KEY=true` |

All of these are typed host frames, not exceptions; see [Error codes](../reference/errors.md).
