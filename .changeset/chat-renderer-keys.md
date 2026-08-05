---
"create-dpas-app": patch
---

Key the chat renderers by bare capability id, the id both lookups actually
carry — the native result cards were dead in every generated app.

`CHAT_RENDERERS` (`app/chat-renderers.tsx`) is the map that lets a reporting
capability answer in the thread with the same chart the page draws, instead of
a JSON blob. Its two consumers had always agreed on the key, and the map had
always disagreed with both. `tool-ui.tsx` receives the **canonical id** under
the host protocol — `domain:collections-aging` — and strips the plane prefix
before the lookup, because only the domain plane has renderers; the approval
receipt (`approval-receipt.tsx`) reads `capabilityId` off the approval record,
which is the registry key, already bare. The map was keyed
`"domain:collections-aging"`. Both lookups missed.

The failure is silent by design, which is why it survived: a miss is not an
error. A capability with no renderer is the normal case, and the thread falls
back to the collapsible payload viewer — the right default, since a renderer
guessing at an unknown shape is worse than an honest `{ … }`. So both shipped
renderers, ageing chart and receivables tiles, degraded to that fallback with
nothing in the console and nothing failing.

Both keys are now the registry id. `rendererKey` moves out of `tool-ui.tsx`
into `app/agent/host/wire-names.ts`, next to the other canonical-id conventions
it belongs with (`domainToolName`, `canonicalIdOfCall`), where a node-env test
can reach it. New `app/chat-renderers.test.ts` pins all three edges: every key
is a real registry id, `domain:<id>` resolves back through `rendererKey` to a
defined renderer, and the receipt's bare id passes through unchanged — so a
future change to either side of the convention fails a test rather than
quietly emptying the thread again.

`docs/adding-a-capability.md` gains the section that would have prevented it,
stating which id is the key and why a missing renderer is not an error.
