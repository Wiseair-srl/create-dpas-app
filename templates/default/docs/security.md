# Security model

## The trust boundary, in one paragraph

The browser is not a security boundary. Everything model-side of an adapter is
untrusted input. Agent Surface makes frontend behaviour explicit, minimal and
deterministic *for honest code* — but authorization lives on the server, which
re-derives identity and re-validates every domain call regardless of what the
browser claims. Prompts are never enforcement: availability, validation,
approval and policy are runtime code, and deleting every instruction in
`server/mastra.ts` changes none of them.

## What each layer may decide

| Layer | Decides | Must never decide |
|---|---|---|
| Agent Surface (browser) | what is visible/available on this screen, input validity, staleness | server authorization |
| Agent Host | catalog composition, duplicate-path rejection, transport, run limits | capability semantics, authority |
| oRPC Agent + procedures (server) | exposure per surface, policy, approval, validation, execution, audit | — this *is* the authority |
| Mastra | which tool to call next | anything; it consumes composed tools |
| assistant-ui | how it looks | any of the above |

## Identity

`server/auth.ts` resolves the session from a server-signed cookie on **every**
request — `/rpc`, `/agent/chat`, `/mcp`, the approval endpoints. The browser
reads the resolved session to shape its UI; it never asserts one. Role fields in
request bodies and tool inputs are never read anywhere in this app. The
correlation metadata the contextual path attaches (`agentInvocationId`, the
confirmation record) is recorded for audit and is explicitly untrusted.

**Authority hides; state discloses.** An analyst's catalog simply lacks
`issue-invoice`, and invoking it by name returns `CAPABILITY_NOT_FOUND` — the
same answer a capability that never existed would give. "Forbidden" would tell a
probing caller that the capability is real and worth attacking. A *controller*
with no chase dialog open sees `update-collection-status` present and
unavailable, with the reason attached, because that is planning fuel rather
than an authority signal.

## Approvals

`gateModelWrites` suspends a model-initiated call on a gated capability into an
approval **record**, before the handler runs:

- bound to the validated input by hash, so the arguments cannot change between
  asking and approving;
- single-use and expiring;
- decided out of band, by a human, over `POST /api/approvals/:id`;
- and re-entered into the conversation as a receipt, so the next turn reasons
  over a history in which the question was actually answered.

The same operation from the app's own UI passes ungated — a person clicking a
button in their own session has already expressed intent. One implementation,
two callers, and the difference between them is a policy input.

The in-memory coordinator this template ships forgets pending approvals on
restart. That is the honest zero-config choice, not a recommendation: a
deployment swaps in `createPgApprovalCoordinator` and turns on `strict: true`,
which is the setting that guarantees audit-before-effect — a promise only a
durable sink can keep.

## Prompt injection

The stack does not claim the model cannot be manipulated. It bounds what
manipulation can achieve:

- deny-by-default exposure on both planes — nothing incidental is callable;
- semantic capabilities, not DOM control — there is no "click anything" tool;
- bound and locked inputs — a hijacked model cannot re-aim a contextual call,
  because the field it would need is not in the schema it was given;
- server-side approval on consequential operations — the blast radius of a
  fooled model is a card a human declines;
- one execution path per operation — no quieter duplicate to abuse;
- server re-authorization — the blast radius of a fooled *frontend* is a 404;
- correlated audit on both planes — misuse is visible afterwards.

Tool results are data, never instructions. The system prompt says so, and the
redaction caps in `capabilities/redact.ts` bound how much of that data reaches
the model at all.

## Boundaries worth keeping

- No secrets in client code. The agent loop runs server-side, so the browser
  never needs a model key and never receives one.
- New mutations: authorize in the procedure, not in the component.
- New contextual references: bind from state the USER controls, and check
  `app/agent/domain/manifest.ts` — a component cannot bind what the manifest
  does not list, and that ceiling is the point.
- Gated capabilities stay OUT of the manifest. Binding one would downgrade a
  persisted server-side approval to a browser dialog.
