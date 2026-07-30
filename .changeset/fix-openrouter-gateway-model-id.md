---
"create-dpas-app": patch
---

Fix OpenRouter model routing: send the vendor-qualified id upstream.

Mastra's model router strips the leading provider segment, so a bare
`anthropic/claude-sonnet-4.5` reached OpenRouter as `claude-sonnet-4.5` — not
a valid id there — and every run failed with "No endpoints found that support
tool use". Model ids are now normalized to the gateway form
(`openrouter/anthropic/claude-sonnet-4.5`), which sends
`anthropic/claude-sonnet-4.5` upstream. Both the UI-connected and
`MODEL_PROVIDER=openrouter` paths were affected; users may type either form.

"Test key" now also verifies the chosen model exists on OpenRouter and
supports tool calling, so this failure is diagnosed before a conversation
rather than during one.
