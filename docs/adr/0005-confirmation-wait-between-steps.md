# ADR-0005 — Confirmation mode: `wait`, executed between protocol steps

**Status:** accepted · 2026-07-30 · **amended 2026-08-02**

> **Amendment.** The decision below — `topology: "remote"` with
> `confirmations: "wait"` — still stands and is still what the toolset is built
> with. What changed is which operations rely on it. The template's
> consequential capabilities (`issue-invoice`, `delete-invoice`) are now gated by
> a **server-side approval record** rather than a frontend confirmation
> ([ADR-0010](0010-approvals-over-confirmations.md)), because a contextual
> binding reaches the server as a direct call and would downgrade that authority.
> Frontend confirmation remains available and correct for bound operations that
> want a human pause without needing a persisted decision.

## Context

Agent Surface offers two confirmation modes: `wait` — the toolset blocks until
the user decides, then retries with the evidence attached, so one tool call
produces one tool result — and `two-phase`, which returns
`CONFIRMATION_REQUIRED` to the model and expects it to retry on a later turn.

`wait` is the better shape: the model never has to be taught a two-step dance,
and it cannot "forget" to come back. The standing objection to it is that in a
*remote* topology it holds a streaming response open across a human decision,
which can take minutes.

## Decision

Use `topology: "remote"` with `confirmations: "wait"`, explicitly, with a
comment in the toolset linking here.

Under the step-loop protocol ([ADR-0002](0002-host-protocol-over-react-ai-sdk.md))
the objection does not apply. Frontend tools execute in the browser **between**
HTTP requests, after a step's stream has already closed, so the confirmation
dialog blocks only browser-local code. No connection is held by a decision, and
no decision is lost to a dropped connection.

## Consequences

- The registry still enforces the properties that make confirmation worth
  anything: evidence is single-use, bound to the exact effective input, and
  expiring. Denial and expiry reach the model as typed `CONFIRMATION_INVALID` /
  `CONFIRMATION_REQUIRED` results rather than as silence.
- Unit tests cover approve, deny, expiry and input-mismatch through the same
  controller, with no model involved.
- This is a *frontend* pause, and its authority ends with the tab. That
  limitation is what [ADR-0010](0010-approvals-over-confirmations.md) is about.
