---
"create-dpas-app": patch
---

Fix meta mode: give the model instructions that describe the catalog it was
actually handed.

`ASSISTANT_INSTRUCTIONS` was a single constant written for the direct
projection — "Tools prefixed `view_` … Tools prefixed `domain_` …" — and
`buildAssistantAgent()` took no mode, even though `catalogMode` already
arrived on every step-request and was echoed back on `step-start`. Under
`meta` those tool names do not exist: there are three verbs
(`surface_discover`, `surface_read`, `surface_act`) and a discovery
round-trip.

The failure that exposed it was total rather than degraded. Primed to expect a
`view_` namespace, the model called `surface_discover({scope:["view_"]})` and
then `{scope:["*"]}`. Neither token intersects the route's scope floor, and a
disjoint scope returns an empty surface rather than falling back to the floor —
`AS-META-002`, decided and pinned upstream, and the correct behavior. But an
empty snapshot is byte-identical to a surface with nothing mounted, so the
model concluded the dashboard had no capabilities and stopped. Calling
`surface_discover` with no arguments at all would have returned everything.

`domain:devices.disable` is what made it fatal. It is `expose.aiSdk: false` on
purpose, so it never appears as a direct server tool and reaches the model only
as a contextual procedure in the surface snapshot. In direct mode that
procedure sits in the frontend tool block and the prompt bug is invisible; in
meta mode, blanking the snapshot removes the operation's only path and "disable
the offline devices in Turin" becomes unanswerable.

`assistantInstructions(mode)` now composes a shared preamble and shared
guidelines with a mode-specific description of the projection. The meta text
names the three verbs, states the discovery loop, tells the model to call
`surface_discover` with no arguments and never to invent a scope token, and
says plainly that an empty surface means the scope was wrong rather than that
the page is empty. The shared guidelines moved from tool-name wording to plane
wording, so they read correctly in both modes.

A second, milder version of the same mistake shows up once discovery works:
the model names the right capability and then flattens that capability's
arguments next to `capabilityId`, instead of nesting them under `input`.
`req.input` is `undefined`, the capability rejects an empty payload, and
`INVALID_INPUT` reads as "wrong capability" rather than "wrong envelope". The
meta text now carries a worked `surface_act` call showing the nesting, and says
what flattening produces. Naming the parameter in a signature line was not
enough; one concrete example is.

Both libraries are conformant here — prompting is the host's job, and the
adapter contract says nothing about system prompts. Two upstream ergonomics
gaps made the mistake easy to fall into and impossible to recover from, and are
worth reporting rather than working around: `surface_discover`'s `scope`
property carries no description and no enum, so valid tokens cannot be learned
from the tool definition; and the blank payload carries no marker, unlike the
`truncated` marker that budget truncation rides on for exactly the reason that
a silent reduction is invisible to the party affected by it.
