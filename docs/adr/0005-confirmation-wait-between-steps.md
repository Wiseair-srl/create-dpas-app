# ADR-0005 — Confirmation mode: `wait`, executed between protocol steps

**Status:** accepted · 2026-07-30 · **amended 2026-08-02**

> **Amendment.** The decision below — `topology: "remote"` with
> `confirmations: "wait"` — still stands and is still what the toolset is built
> with. What changed is which operations rely on it. The template's
> consequential capabilities (`issue-invoice`, `delete-invoice`) are now gated
> by a **server-side approval record** rather than a frontend confirmation
> (ADR-0010), because a contextual binding reaches the server as a direct call
> and would downgrade that authority. Frontend confirmation remains available
> and correct for bound operations that want a human pause without needing a
> persisted decision.

Agent Surface offers `wait` (toolset blocks until the user decides, then
auto-retries with evidence — one tool call, one result) and `two-phase`
(`CONFIRMATION_REQUIRED` returned to the model, which retries next turn).
docs/16 warns that `wait` in a *remote* topology holds the streaming response
open across a human decision.

Under the step-loop protocol (ADR-0002) that warning does not apply: frontend
tools — including the contextual `domain:invoices.issue` — execute in the
browser **between** HTTP requests, after a step's stream has already closed.
The confirmation dialog therefore blocks only browser-local code.

Decision: the template's toolset uses `topology: "remote"` with
`confirmations: "wait"`, explicitly, with a comment linking here. The
underlying registry still enforces single-use, input-bound, expiring evidence;
denial and expiry surface to the model as typed `CONFIRMATION_INVALID` /
`CONFIRMATION_REQUIRED` results. Unit tests cover approve, deny, expiry, and
input-mismatch through the same controller.
