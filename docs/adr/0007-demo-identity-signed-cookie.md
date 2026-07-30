# ADR-0007 — Demo identity: server-signed role cookie

**Status:** accepted · 2026-07-30

The directive requires a demo identity system (`viewer` / `operator`) resolved
on the server, with a development role switcher that must not trust a role in
a tool-call body.

Decision: a `dpas_session` cookie carries `{ userId, role }` signed with
HMAC-SHA256 (`AUTH_SECRET`, defaulted for local dev). `src/server/auth/`
verifies the signature on every request and derives the actor; a missing or
invalid cookie yields the default `operator` demo user so the app works on
first load, with the switcher (`POST /api/auth/role`) re-signing server-side.
Browser code only ever *reads* the resolved session from `GET
/api/auth/session` to drive UI policy (hide vs disable); the server
re-derives it independently for every oRPC call and every chat turn. Roles in
request bodies are never read.

This is explicitly a demo: the docs point at the seam (`src/server/auth/`)
where a real auth provider replaces the cookie code without touching either
capability plane.
