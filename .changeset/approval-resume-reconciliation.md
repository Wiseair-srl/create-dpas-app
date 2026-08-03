---
"create-dpas-app": patch
---

Reconcile the query cache when an approved gated write actually executes, and
stop reconciling when it merely suspends — the two halves of one inversion.

The app had two reconciliation triggers, one per execution plane: the surface
subscription in `app/agent/surface/wiring.tsx` for capabilities the agent runs
in the browser, and the stream consumer in `app/agent/host/transport-client.ts`
for writes executed inside the server's model loop. A **gated** capability
(`GATED_CAPABILITIES` — the destructive ones) fits neither moment. Its first
result is the governed envelope `{ status: "approval-required", … }`: the
pipeline parks the call in an approval record and writes nothing. The write
itself happens only when the user approves, inside `POST /api/approvals/:id`
via `runtime.resume` — a plain JSON request, long after the stream that asked
for it closed. No `tool-result` frame, no `invocation-settled` event, no
trigger.

Worse than missing: inverted. The suspension envelope is `ok` on the wire (the
call did not fail; it is waiting), and its capability's declared `sideEffect`
is precisely the kind that reconciles — so the cache was invalidated at the
moment nothing had changed, with the Inspector logging "wrote · invalidating
query cache", and left alone at the moment everything had. An approved
`delete-invoice` executed, the receipt card said so, and the row stayed in the
table until `staleTime` lapsed or the window regained focus. Exactly the class
of bug the destructive capabilities are gated to avoid.

Two changes, one per half. `awaitingApproval` (protocol.ts) recognises the
suspension envelope and the stream consumer skips reconciling on it — matched
exactly, the opposite direction from `mutatesData`'s exclusion, so an envelope
this build cannot positively recognise as a suspension still errs toward
refetching. And the approval decision (`tool-ui.tsx` `decide`) becomes the
convention's **third trigger**: the response already carried the resolution,
so a `completed` resume now runs the same blanket `invalidateQueries()` every
human mutation runs. Completed only — a denied or failed resume wrote nothing,
and refetching would dress the refusal up as an update.

The stream-level cases are pinned in a new `reconcile.test.tsx` (write,
destructive, read, refused, suspended, multi-call), the envelope predicate in
`protocol.test.ts`. All three triggers now name each other in comments, in
`docs/concepts/dual-plane.md`, in the host protocol reference and in the
generated `docs/architecture.md`: one convention, three triggers, because
there are three moments a domain write can land. Writes reaching the server
from outside the tab entirely (an `/mcp` client) remain outside the tab's
knowledge — nothing here changes that.
