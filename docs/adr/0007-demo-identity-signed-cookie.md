# ADR-0007 — Demo identity: a server-signed role cookie

**Status:** accepted · 2026-07-30

## Context

The app needs two identities to be worth looking at — an `analyst` who may not
write and a `controller` who may — and a way to switch between them, because
"authority hides" is a claim you have to *see* to believe. It also has to run
with zero configuration, which rules out standing up an auth provider first.

The trap is the switcher. The easy version puts the role in the request the
browser sends, and then every authorization decision in the app is downstream of
a value the caller chose. That is not a demo of an authority model; it is a
demo of not having one.

## Decision

A `dpas_session` cookie carries `{ userId, role }`, signed with HMAC-SHA256
under `AUTH_SECRET` (defaulted, so it runs on first start). `server/auth.ts`
verifies the signature on **every** request and derives the actor from it; a
missing or invalid cookie yields the default `controller` demo user, so the app
works on first load.

The switcher (`POST /api/session`) re-signs the cookie server-side. Browser code
only ever *reads* the resolved session, from `GET /api/session`, to shape the UI
— hide versus disable. The server re-derives identity independently for every
oRPC call, every chat turn and every MCP request. **Role fields in request
bodies and tool inputs are never read anywhere in the app.**

## Consequences

- The property that makes the demo honest is also the property that makes the
  swap safe: everything downstream consumes only `SessionUser` and
  `sessionFromRequest`, so replacing this file with a real auth provider touches
  neither capability plane.
- It is explicitly not authentication — there is no login, and the default
  signing secret is in the repository. [Deploying](../guides/deploying.md) lists
  it first among the four seams, and the switcher endpoint goes with it.
- Until it is replaced, `AUTH_SECRET` is the minimum a shared deployment must
  set.
