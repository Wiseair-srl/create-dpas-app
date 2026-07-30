# Security and confirmation

## Trust model in one paragraph

The browser is not a security boundary. Everything model-side of an adapter
is untrusted input. Agent Surface makes frontend behavior explicit, minimal,
and deterministic for honest code — but authorization lives on the server,
which re-derives identity and re-validates every domain call regardless of
what the browser claims. Prompts are never enforcement: availability,
validation, confirmation, and policy are runtime code.

## The layers, and what each one may decide

| Layer | Decides | Must never decide |
|---|---|---|
| Agent Surface (browser) | what is visible/available on this page, input validity, confirmation UX, staleness | server authorization |
| Agent Host | catalog composition, duplicate-path rejection, transport, run limits | capability semantics, authority |
| oRPC Agent + procedures (server) | exposure per surface, policy, validation, execution, audit | — (this is the authority) |
| Mastra | which tool to call next | anything — it consumes composed tools |
| assistant-ui | how things look | any of the above |

## Identity

[src/server/auth/session.ts](../src/server/auth/session.ts) resolves the
session from a server-signed cookie on EVERY request — the chat route, every
oRPC call, the catalog endpoint. The browser reads the resolved session
(`GET /api/auth/session`) to shape UI policy; it never asserts one. Role
fields in request bodies or tool inputs are never read. The correlation
metadata the agent path attaches (`x-dpas-invocation-id`,
`x-dpas-confirmation-id`) is recorded for audit and explicitly untrusted.

**Authority hides; state discloses.** A viewer's catalog simply lacks
`domain:devices.disable` — indistinguishable from it never existing. An
operator with nothing selected sees it, unavailable, with the reason. The
Inspector's catalog tab demonstrates both live.

## Confirmation (frontend) vs approval (server)

This app gates the destructive contextual call with **frontend
confirmation**, enforced by Agent Surface:

- minted per invocation for the EXACT effective input (after binding);
- single-use, expiring (120s), consumed atomically;
- digest-bound: if the selection changed after approval, execution fails
  with `CONFIRMATION_INVALID { reason: "mismatch" }` — no bait-and-switch;
- denial and expiry return typed errors the model must respect.

Frontend confirmation is a safety and comprehension mechanism for the human
present at the page. It is **not** server authorization: the procedure's own
middleware (operator role) authorizes the call, and would reject a forged or
missing confirmation path identically.

oRPC Agent additionally supports **server approvals** (input-hash-bound,
single-use, decided by `runtime.approvals.decide` + `runtime.resume`) for
operations that need a second actor or durable workflow. This template keeps
them off — frontend confirmation plus server authorization is the right floor
for an in-session demo — but the seam is
[src/server/agent/runtime.ts](../src/server/agent/runtime.ts)
(`approvals` option), and high-risk operations may require both.

## Prompt injection

The stack does not claim the model cannot be manipulated; it bounds what
manipulation can achieve:

- deny-by-default exposure on both planes — nothing incidental is callable;
- semantic capabilities, not DOM control — there is no "click anything" tool;
- bound + locked inputs — a hijacked model cannot re-aim the destructive call;
- exact-input confirmation — the human sees precisely what would happen;
- one execution path per operation — no quieter duplicate to abuse;
- server re-authorization — the blast radius of a fooled frontend is a 403;
- correlated audit on both planes — misuse is visible after the fact.

## Human paths stay human

The toolbar's Disable button calls the same procedure with NO agent evidence:
a person clicking in their own session has already expressed intent
([devices-table.tsx](../src/features/devices/components/devices-table.tsx)).
Confirmation evidence is an agent protocol, not a person protocol — the
server treats both as ordinary authenticated requests.

## Model credentials

A model key can arrive two ways, and neither puts it in the browser:

- **`.env`** — the durable option, read only in server code.
- **The assistant panel's model settings** — posted once to
  `POST /api/config/model` and held in
  [src/server/model-config.ts](../src/server/model-config.ts), in that
  process's memory. It is never written to disk, never copied into an env
  var, never logged, and never serialized back: `GET /api/config` returns the
  provider, the model id, and a masked hint (`••••1234`) only. Because the
  agent loop runs server-side, the browser never needs the key at all.

The guard that matters: one process shares that key with every visitor, so
runtime entry is **enabled in development and disabled in production
builds**. `ALLOW_RUNTIME_MODEL_KEY=true` opts a single-user deployment back
in; `false` refuses everywhere. Tests pin all of this — the store's
production guard and masking in
[src/server/model-config.test.ts](../src/server/model-config.test.ts), and
the endpoints' "never echo the key" contract in
[src/app/api/config/config-routes.test.ts](../src/app/api/config/config-routes.test.ts).

## Boundaries worth keeping when you extend this

- No secrets in `NEXT_PUBLIC_*`. Server env stays server-side
  ([src/agent/runtime/mastra.ts](../src/agent/runtime/mastra.ts) reads keys
  only in route handlers).
- New mutations: server-authorize in the procedure, not in the component.
- New contextual references: bind from state the USER controls, lock them,
  and let the confirmation floor for `destructive` effects do its job.
