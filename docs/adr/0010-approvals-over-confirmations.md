# ADR-0010 · Consequence is gated by server approval, not frontend confirmation

**Status:** accepted · 2026-08-02

## Context

Agent Surface can require a **confirmation** before a bound procedure executes:
the toolset blocks, the user decides in the page, and approval evidence rides
the call (ADR-0005). oRPC Agent can require an **approval**: the runtime
suspends the invocation into a persisted record, bound to the validated input by
hash, which a human decides out of band.

Both stop a model from acting alone. They are not interchangeable, and the
template previously used the first for everything.

The problem is where each one lives. A contextual binding executes in the
browser and reaches the server over the app's ordinary `/rpc` client, as
`surface: "direct"`. That is correct: it *is* the user's own session making the
call. But `gateModelWrites` deliberately lets `direct` through ungated, because
a person clicking a button has already expressed intent. So binding a gated
capability silently trades a persisted, server-side approval record for a
browser-side dialog: weaker authority, on exactly the operations that least
want it, with nothing in the type system to notice.

## Decision

Two shapes, chosen by what makes the operation dangerous.

**Bind for context.** When correctness depends on pointing at what the user is
looking at, expose it as a contextual reference: `expose.aiSdk: false`, an entry
in the frontend manifest, and a `useAgentProcedure` binding in the component
that owns the state. `update-collection-status` is the template's example.

**Gate for consequence.** When the risk is what the operation *does*, leave it a
direct governed tool and add its id to `GATED_CAPABILITIES`. A model-initiated
call suspends into an approval record; the same call from the app's own UI
passes ungated. `issue-invoice` and `delete-invoice` are the examples.

Gated capabilities are **deliberately absent** from
`app/agent/domain/manifest.ts`, which is the exposure ceiling for the
presentation plane. A component therefore cannot bind one even by mistake: the
manifest is the enforcement, and the comment in that file is the explanation.

## Consequences

- The template ships both mechanisms and one worked example of each, so the
  distinction is visible rather than described.
- Approvals need a coordinator. The in-memory one is the honest zero-config
  choice and forgets pending records on restart; `createPgApprovalCoordinator`
  is a one-line swap, and it is what `strict: true` audit needs to mean
  anything.
- A decided approval has to re-enter the conversation, or the next turn reasons
  over a history in which the model asked for something and nothing answered.
  `server/approval-receipt.ts` writes that message, from the record and the
  result, so approving something that then failed says so.
- The same loop closes over MCP without weakening the rule that deciding is
  impossible on that surface (orpc-agent 3.0): the suspension envelope
  deep-links the human to `/approvals/:id` in this app, and once they approve
  there, the requesting session executes the operation through the adapter's
  `approvals_resume` tool, which the runtime binds to that session's actor
  and surface. An MCP record is therefore never resumed by the decision
  endpoint; its output belongs to the session that asked.
