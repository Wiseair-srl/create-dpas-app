# Connecting a model

> **This page:** how the generated app runs an agent, and what the model actually receives. Full variable list: [Configuration](../reference/configuration.md).

## Two live modes, and one for CI

| Mode | How | Model | Use for |
|---|---|---|---|
| **No key** (default) | nothing to configure | none; the composer is inert and says so | first run, screenshots, everything that is not the copilot |
| **Live** | a provider key in `.env` | a real provider | actual agent work |
| **Mock** | `MODEL_PROVIDER=mock` | a scripted `LanguageModelV2` | e2e and CI, with no credentials |

The mock is not a simulation of the pipeline. It *is* the pipeline, with the model replaced by a script. Host protocol, per-request catalog composition, client-tool suspension, oRPC execution and reconciliation are all the real ones.

## Setting a key

```bash
# .env: set one. There is no provider switch; which key you set IS the choice.
ANTHROPIC_API_KEY=sk-ant-...
# OPENROUTER_API_KEY=sk-or-...
```

Restart, and the picker in the composer fills with that provider's models. Setting both offers both.

To change which ids are offered:

```bash
ANTHROPIC_MODELS=claude-sonnet-4-5,claude-haiku-4-5
DEFAULT_MODEL=anthropic/claude-sonnet-4-5    # must be one of the allowed ids
```

::: warning OpenRouter ids carry a gateway prefix
Mastra's router splits a model string on the **first** slash, so the vendor segment has to survive it. The app prefixes the gateway for you (`openrouter/anthropic/claude-sonnet-4.5`), which is also why OpenRouter's own meta-models need it twice: `openrouter/openrouter/auto`. Never strip a leading `openrouter/`. The model must support **tool calling**; one that does not fails with *"No endpoints found that support tool use"*.
:::

## What the model actually gets

Per protocol step, the composed catalog is:

- the governed `domain:*` tools **your identity** may see, **scoped by route** (`app/agent/host/scope.ts`), and
- the `view:*` capabilities currently mounted in the tab,

each with a description, a JSON Schema input, an effect and a confirmation requirement. Live availability is *not* in that block: it rides in a compact system message after the conversation, so the tool definitions stay byte-identical across a turn and the provider's prompt cache survives.

Instructions live in `server/mastra.ts`. They improve planning and enforce nothing: delete every line and availability, schema surgery, approvals and server authorization are unchanged, because all four are runtime code.

Run limits are host code, not prompt text:

| Limit | Value | Where |
|---|---|---|
| Model steps per protocol request | 5 | `RUN_LIMITS.maxStepsPerRequest` (`server/mastra.ts`) |
| Inactivity between stream chunks | 45 s | `RUN_LIMITS.modelTimeoutMs` |
| Protocol steps per turn | 8 | `MAX_STEPS_PER_TURN` (`app/agent/host/transport-client.ts`) |
| Turn deadline | 180 s | `TURN_DEADLINE_MS` |
| Identical consecutive failures | 3 | `LOOP_LIMITS.maxIdenticalFailures` (`app/agent/host/loop-guard.ts`) |
| Any consecutive failures | 4 | `LOOP_LIMITS.maxConsecutiveFailures` |

## Try it

Restart, press ⌘J, and ask:

> *Which invoices are overdue, and by how much?*

The copilot reads the ageing ladder on the server, narrows the table in your browser, reads the rows back, and answers from what it read. The table moves because the agent called the same setter the toolbar calls; it has no privileged channel into the UI, and the URL updates so the view it produced is one you can share.

Then ask it to issue a draft. It will not: a model-initiated `issue-invoice` comes back as an approval card, and nothing moves until you decide. That is [ADR-0010](../adr/0010-approvals-over-confirmations.md) in one interaction.

## When it does not work

| You see | Meaning |
|---|---|
| `MODEL_NOT_CONFIGURED` | No provider key is set, so there is no model to run |
| `MODEL_TIMEOUT` | No chunk for 45 s, usually an upstream stall |
| `MODEL_ERROR` | The provider rejected the request. A model without tool-calling support is the common cause |
| `RUN_LIMIT_EXCEEDED` | A limit above was hit; the message says which |
| `NO_SUCH_TOOL` | The model invented a tool name. Answered with `retry: "no"`, since the catalog for that step is the complete set that exists |
| `CATALOG_TOO_LARGE` | More capabilities than the protocol's named limits allow. Scope the route |

All of these are typed host frames, not exceptions; see [Error codes](../reference/errors.md).
