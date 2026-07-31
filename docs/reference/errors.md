# Error codes

> **This page:** every failure the model can read back, and what it should do about it. Failures are **typed results, not exceptions** — a tool call that fails still returns a tool result, so the model can self-correct instead of guessing.

Every model-visible tool result in the generated app has the same envelope:

```ts
{ ok: boolean, value: unknown }   // on failure, value is { error: { code, message, retry, details? } }
```

`retry` is the actionable part: `no` · `yes` · `after-refresh` · `after-delay` · `with-confirmation` · `with-changes`.

## Capability errors (presentation plane)

The closed enum from `@agent-surface/core`. These reach the model for `view:*` capabilities and for contextual domain references.

| Code | Means | The model should |
|---|---|---|
| `CAPABILITY_NOT_FOUND` | Not on the current surface | Re-read the catalog; the page changed |
| `CAPABILITY_NOT_AVAILABLE` | Present, but not callable now — `reason` says why | Do the enabling step first (*“Select at least one device”*) |
| `AMBIGUOUS_INSTANCE` | Several mounted instances match | Name the instance |
| `COMPONENT_UNMOUNTED` | The owner left the page | Re-read the surface |
| `STALE_CAPABILITY` | The registration is from a previous mount | Re-read the surface |
| `INVOCATION_CONFLICT` | Another invocation of the same capability is in flight | Wait, then retry |
| `INVALID_INPUT` | Schema or `precondition` rejected the input. `details.lockedFields` means a **bound** key was supplied | Fix the input — and never try to override a bound field |
| `NOT_AUTHENTICATED` / `NOT_AUTHORIZED` | Identity is missing or insufficient | Stop; this is not a retryable condition |
| `PRECONDITION_FAILED` | Semantically invalid against current state | Read state, then retry with changes |
| `CONFIRMATION_REQUIRED` | The call needs human approval | Request it — it is not skippable |
| `CONFIRMATION_INVALID` | `reason: denied \| expired \| consumed \| mismatch` | **`denied`** → stop and report honestly. **`mismatch`** → state changed after approval; start over |
| `RATE_LIMITED` | Too many calls | Back off |
| `TIMEOUT` / `CANCELLED` | The invocation did not complete | Retry only if idempotent |
| `EXECUTION_FAILED` | The handler threw | Report; do not loop |

`CONFIRMATION_INVALID { reason: "mismatch" }` is the bait-and-switch guard: approval is bound to the exact effective input, so changing the selection after a human approves invalidates the evidence rather than executing something else.

## Domain errors (authoritative plane)

From `@orpc-agent/core`, produced by the governed pipeline around your procedure:

| Code | Stage |
|---|---|
| `CAPABILITY_NOT_FOUND` | Not exposed on this surface, or hidden by policy — deliberately indistinguishable from nonexistent |
| `INPUT_INVALID` | Validation, **before** your handler runs |
| `UNAUTHENTICATED` · `FORBIDDEN` | Authentication and authorization |
| `POLICY_DENIED` · `POLICY_FAILED` | A policy denied, threw, or timed out — failure is closed |
| `APPROVAL_*` | Server approvals: `REQUIRED`, `PENDING`, `REJECTED`, `EXPIRED`, `CONSUMED`, `INPUT_MISMATCH`, `SELF_APPROVAL`, `UNSERIALIZABLE_INPUT`. The template leaves server approvals off; the seam is `src/server/agent/runtime.ts` |
| `EXECUTION_FAILED` | Your handler threw a non-typed error |
| `OUTPUT_INVALID` | The handler returned something the output schema rejects |
| `TIMEOUT` · `CANCELLED` | Execution did not complete |
| `AUDIT_UNAVAILABLE` · `ADAPTER_ERROR` | Infrastructure |
| `INTERNAL_ERROR` | Anything else — deliberately opaque |

Your own typed procedure errors (`.errors({ DEVICE_NOT_FOUND: … })`) pass through with their public message. Everything else the model sees is either a public code/message or a generic `INTERNAL_ERROR`: stack traces and internals never reach it.

## Host errors (transport)

`PROTOCOL_VERSION_MISMATCH` · `PROTOCOL_DECODE_ERROR` · `CATALOG_COLLISION` · `MODEL_NOT_CONFIGURED` · `MODEL_TIMEOUT` · `MODEL_ERROR` · `RUN_LIMIT_EXCEEDED` · `TRANSPORT_FAILED` — see [Host protocol](host-protocol.md).

Two host-produced *tool* results are worth knowing:

| Code | Means |
|---|---|
| `CAPABILITY_NOT_FOUND` | The model called a wire name that is not on the live surface (`retry: "after-refresh"`) |
| `TOOL_NOT_EXECUTED` | A tool call Mastra left open could not be answered — the model is told so explicitly (`retry: "yes"`) rather than receiving silence |

## Reading them in the app

The tool cards in the assistant render the same payloads the model receives, so if you can read the card you can read the transcript the model reasoned over. The Inspector's Timeline pairs every `tool-call` with its `tool-result`. Both are covered in [Tracing a tool call](../guides/tracing-a-tool-call.md).

## Testing them

Assert the code *and* the retry hint — they are API. `src/features/devices/capabilities.test.tsx` covers unavailability, locked fields, denial, expiry and mismatch without a model; see [Testing without an LLM](../guides/testing.md).
