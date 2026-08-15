# Host protocol

> **This page:** the versioned browser↔server contract the Agent Host speaks over `POST /agent/chat`: request, frames, composition rules, limits and error codes. It is application code in `app/agent/host/` and `server/agent/host.ts`, not a dependency ([ADR-0002](../adr/0002-host-protocol-over-react-ai-sdk.md)).

**Current version: `2`.** v1 is served alongside it for one minor release, so a tab open across a deploy keeps working.

## The shape

One POST is **one model step-run**. The server streams NDJSON frames back and holds no run state: *the messages are the state*.

1. The browser snapshots the live Agent Surface into wire descriptors (declaration only; executors stay in the tab) and posts them with the model-message history.
2. The server resolves the session from the cookie, composes the catalog (governed domain tools for that actor **plus** the declared frontend tools), rejects duplicate paths, runs one Mastra step and streams frames.
3. If the run ends at frontend tool calls, it **suspends**: the browser executes them through Agent Surface, waits for the surface to absorb them, appends the results and posts the next step.

The third point is the reason the protocol exists in this shape: **frontend tools execute between requests**, never inside a held-open stream. A view capability runs against the live screen, and anything that waits on a human (a confirmation dialog, a file picker) waits in that gap. No connection is blocked by a decision, and no decision is stranded by a dropped connection ([ADR-0005](../adr/0005-confirmation-wait-between-steps.md)).

## Request

Two versions are served side by side for one minor release, so a tab that was
open across a deploy keeps working instead of breaking on its next message. The
server branches on `protocolVersion` and normalises both to one internal shape;
the response echoes the version the exchange actually used in
`x-dpas-protocol-version`.

**v2, current.**

```ts
{
  protocolVersion: 2,
  conversationId: string,      // ≤ 64 chars — one chat thread
  turnId: string,              // ≤ 64 chars — one user message and all it causes
  stepIndex: number,           // 0…64
  pathname: string,            // the route; the server derives the scope floor
  messages: WireModelMessage[],// 1…400 — the whole history; the server is stateless
  catalog: {
    mode: "direct" | "meta",   // "direct" = one tool per capability
    scope?: string[],          // ≤ 32 — a REQUEST, intersected with the server floor
    frontendTools: WireToolDescriptor[],  // ≤ 128
    truncated?: { dropped: number, reason: "budget" | "limit" | "undecodable" },
  },
}
```

**v1, accepted but deprecated.** No `pathname` and no `catalog`; `frontendTools`
sits at the top level, capped at 64, and `messages` at 200. A v1 request is
normalised to an unscoped direct catalog. Its one behavioural difference is
[collisions](#catalog-composition-rules): v1 aborts the turn, v2 drops the
duplicate and continues.

### Limits

Checked in the browser before posting and again on the server, which is the
authority. Exceeding one is a **legal request that is too large**: it answers
`413 CATALOG_TOO_LARGE` naming plane, count and limit, never
`PROTOCOL_DECODE_ERROR`.

| Limit | Value |
|---|---|
| `maxFrontendTools` | 128 |
| `maxDomainTools` | 128 |
| `maxTotalTools` | 192 |
| `maxMessages` | 400 |

### Catalog mode

`direct` gives the model one tool per capability. `meta` gives it three
(`surface_discover`, `surface_read`, `surface_act`) and it names the capability
it wants in `capabilityId`. Both run against the same registry and the same
capabilities; the choice is a projection, not a different application, and the
template ships a toggle so the two can be compared side by side.

Meta bounds the **view** half only. The domain half is projected by
`toAISDKTools`, which has no meta mode, so a wide domain surface is bounded by
scope instead. The two compose rather than competing.

Three consequences for a host:

- `toolset.wireNameMap()` is **empty** in meta mode: the three tool names are
  not capability ids. Do not treat that as "nothing could be mapped".
- The **audit identity moves into the arguments**. `surface_act` is the tool;
  the operation is whatever `capabilityId` names. Recording the tool name would
  collapse every action in the application into one identity.
- The **system prompt is part of the projection**, so `catalogMode` has to
  reach it. A prompt describing `view_`/`domain_` tools is not merely stale
  under meta; those names do not exist there, and a model that goes looking
  for them guesses at `surface_discover({scope})`. A scope token outside the
  route's floor returns an *empty* surface rather than falling back to it
  (`AS-META-002`), which is indistinguishable from a page with nothing
  mounted. Tell the model to call `surface_discover` with no arguments and
  never to invent a token. This bites hardest on a capability whose only path
  to the model is the surface: an `expose.aiSdk: false` procedure such as
  `invoices.issue` disappears entirely, while direct mode carries on working.

### Scope

`scope` shapes **discovery only** and is never an authority boundary: `invoke`
does not consult it on either plane, and a capability outside the scope stays
fully invocable by an authorized actor. Use exposure or a policy to make one
unreachable.

One token covers both planes because both already declare it at the feature:
the view plane matches it against the component `type` as a prefix, the domain
plane against `meta.tags`. The browser's `scope` is a request: the server
intersects it with the route's floor and can only narrow, never widen. An empty
scope means *unscoped*, not *empty*.

A `WireToolDescriptor` is what the model gets to know about a browser-side capability:

| Field | Meaning |
|---|---|
| `wireName` | Provider-safe name the model calls (≤ 64 chars) |
| `canonicalId` | `view:…` or `domain:…`, the audit identity |
| `plane` | `view` or `domain` |
| `description` | Model-facing description |
| `inputSchema` | JSON Schema, bound keys already removed |
| `effect` | `local-state`, `navigation`, `destructive`, … |
| `confirmation` | `never` · `optional` · `required` |
| `available` + `unavailableReason` | State disclosure: present but not callable, and why |

Declaring a frontend tool grants **visibility only**. Its executor never leaves the browser, and the server never gains a way to run it.

## Frames (NDJSON, server → browser)

| Frame | Carries |
|---|---|
| `step-start` | `stepId`, ids, the **domain half of the composed catalog**, plus the effective `catalogMode` and `scope`: what the model was actually offered, on the record |
| `text-delta` | Answer text |
| `reasoning-delta` | Model reasoning, on its own frame so the UI can fold it and never confuse it with the answer |
| `tool-call` | `toolCallId`, `wireName`, `canonicalId`, `executor: "server" \| "browser"`, `input` |
| `tool-result` | The same ids plus `ok` and `result` |
| `inspector` | Correlated diagnostics from the `runtime`, `domain` or `host` lanes: forwarded audit activity, filtered to this session's actor. Also carries `catalog.collision`, `catalog.truncated`, `catalog.undecodable` and `inspector.dropped`, so every reduction is visible. The browser collects these in `app/agent/inspector/inspector-store.ts`; this template renders no panel over it, so subscribe to the store, or read the frames |
| `step-finish` | `finishReason`, `responseMessages`, `pendingToolCalls`, optional `usage` |
| `error` | `{ code, message }`: a typed host error, never an exception |

`step-finish.responseMessages` are the model messages this run produced, reconstructed server-side; the browser appends them to its history. `pendingToolCalls` are the frontend calls it must execute before posting the next step.

`step-finish.usage` reports what **this step-request** cost: `inputTokens`, `outputTokens`, `totalTokens`, and `reportedSteps`, the number of model steps that reported anything. A request may run several model steps (`RUN_LIMITS.maxStepsPerRequest`) and a turn several requests, so a client that wants the turn or the conversation adds them up; that sum is also what gets billed, because every step resends the conversation so far. The runtime reports usage twice (per model step, and again as a run total on its closing chunk) and the host reconciles the two rather than adding them, keeping the running sum when a run ends at a timeout or an error before any total arrives. The field is **absent entirely** when the provider reported nothing, so an unmeasured step never reads as a measured zero.

Two optional fields come with it, and **both are subsets, never additions**:

| Field | Subset of | Why it is carried |
|---|---|---|
| `cachedInputTokens` | `inputTokens` | Cache reads bill at a fraction of the normal rate, so a large cached share means the input figure overstates the bill |
| `reasoningTokens` | `outputTokens` | Reasoning bills **as output** and is already inside it; this only says how much of the output was thinking rather than answer |

Adding either to its parent produces a number nobody is charged. Each is absent when the provider said nothing about it, which is not the same as zero: no reported reasoning is not proof the model did none. This is also why the counter in the template shows input and output **separately and never their sum**: output bills at several times input, so a combined figure corresponds to no rate at all. It counts tokens, not money; nothing here applies a price.

A malformed frame is itself reported as an `error` frame with `PROTOCOL_DECODE_ERROR` rather than throwing inside the reader.

## Catalog composition rules

- **Per actor, per turn, never cached across users.** The domain half is produced by the oRPC Agent runtime for the session's actor, so exposure and policy are re-evaluated every step.
- **One uniform namespace, reversed by map only.** Both planes use the same encoding (`:` → `_`, `.` → `__`), so `domain:list-invoices` reaches the model as `domain_list-invoices`. Encoding is *not* reversible by string surgery: a name that would exceed 64 characters is shortened and hashed, and `decodeWireName` refuses those rather than returning a plausible wrong id. The browser reverses through `toolset.wireNameMap()`; the server captures names as it assigns them. A name that cannot be mapped is **withheld from the model** and reported as `catalog.undecodable`: a capability that cannot be audited under its canonical id is not offered at all.
- **Duplicate paths cost the duplicate, not the turn.** If a domain operation appears both as a direct tool and as a contextual frontend declaration, v2 drops the frontend declaration, keeps the governed server tool, records `catalog.collision` in the audit log, emits an `inspector` frame, and runs the step. v1 returns **409 `CATALOG_COLLISION`** instead. Across a large codebase a double-exposure is a matter of when, and taking down the whole assistant is a disproportionate response to one misconfigured capability. `pnpm view:check` catches it earlier, at build time.
- **No silent reduction.** Every drop (collision, truncation, undecodable name, or an audit entry dropped because a reader fell behind) emits a frame. A gap nobody is told about reads as "nothing happened".

### Orphaned server calls

A model may call a server tool and a browser tool in the *same* message. Mastra executes the server tool but suspends the run for the browser **without emitting that result**: it appears in neither `fullStream` nor `stream.toolResults`. The host captures domain results as they are produced and answers any call Mastra left open (`settleOrphanedServerCalls`). Without it the model would receive a tool-call with no tool-result, which providers reject, and the UI would show a card stuck on *running*. A call that cannot be answered at all comes back as `TOOL_NOT_EXECUTED` with `retry: "yes"`, never silence ([ADR-0009](../adr/0009-orphaned-server-tool-calls.md)).

## End to end workflow example

The sections above define the contract in the abstract. This one follows a
single user message through every hop of it, showing what each party sends, to
whom, and why.

**The scenario.** Carla Controller (`carla@example.com`, role `controller`) is on
`/receivables/pending` with no filters. She types:

> Which invoices are overdue, and by how much?

Seven of the thirteen pending invoices are past due, worth €102,600 together.
Answering takes three protocol steps, and the first one is the interesting one,
because the model calls a **server** tool and a **browser** tool in the same
message.

**Two transports, and the difference matters.** Model traffic goes to
`POST /agent/chat` and carries no authority. Any actual mutation goes to
`POST /rpc`, authorized from the session cookie. The two never mix.

| Hop | Direction | Purpose |
|---|---|---|
| ① | browser → server | Post the history plus the **live view catalog** |
| ② | server, internal | Build the domain catalog for this actor, scoped by route |
| ③ | server → model | One provider request: system, messages, **both planes as one tool list** |
| ④ | model → server | Which tools to call, with arguments |
| ⑤ | server → browser | Stream frames; hand back the run's messages and what to execute |
| ⑥ | browser, internal | Execute through Agent Surface against live component state |

### ① Browser → server: the step request

The browser is the only party that knows what is on screen, so **it, not the
server, decides what the model may see**. Before each step it snapshots the live
registry and projects every mounted capability into a wire descriptor
(`transport-client.ts`). Nothing is registered ahead of time; the catalog is
rebuilt from scratch on every step.

```json
{
  "protocolVersion": 2,
  "conversationId": "conv_7f3a",
  "turnId": "turn_01",
  "stepIndex": 0,
  "pathname": "/receivables/pending",
  "messages": [
    { "role": "user", "content": "Which invoices are overdue, and by how much?" }
  ],
  "catalog": {
    "mode": "direct",
    "scope": ["app", "invoices", "reporting", "collections"],
    "frontendTools": [
      {
        "wireName": "view_invoices__pending__readState",
        "canonicalId": "view:invoices.pending.readState",
        "plane": "view",
        "description": "[view · read] The rows currently visible in this table, in view order (at most 100), with the row counts and the active sort. Read this before acting on rows.",
        "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
        "effect": "read",
        "confirmation": "never"
      },
      {
        "wireName": "domain_update-collection-status",
        "canonicalId": "domain:update-collection-status",
        "plane": "domain",
        "description": "[domain · server-mutation] Upsert the chase status of the invoice whose dialog is open…",
        "inputSchema": {
          "type": "object",
          "properties": { "remindersSent": { "type": "integer" }, "note": { "type": "string" } },
          "additionalProperties": false
        },
        "effect": "server-mutation",
        "confirmation": "never"
      }
      // …13 more: setFilters, clearFilters, sort, selectRows, readFilters,
      //           readSelection, readColumns, readColumnFilters,
      //           setColumnFilters, setColumnVisibility, moveColumn,
      //           app.navigation.*, app.session.read
    ],
    "frontendState": [
      { "wireName": "domain_update-collection-status", "available": false,
        "unavailableReason": "Open an invoice's chase dialog first" }
    ]
  }
}
```

Three details in that payload carry most of the design.

**`invoiceId` is missing from `domain_update-collection-status`, and that is
deliberate.** The chase dialog binds it to the invoice on screen and does not
mark it overridable, so `reduceInputSchema` deletes the key from `properties`
and `required` before the descriptor is built. The model is not *asked* to leave
the invoice alone; it is given no field in which to name one.
`additionalProperties: false` closes the remaining gap.

**Availability is in `frontendState`, not in the descriptor.** The stable half
(name, description, schema) goes in the provider's tool block, which sits at the
front of the prompt; folding live state into it would invalidate the cached
prefix behind the whole conversation on every step. The volatile half is
rendered as one compact system message *after* the conversation, where it costs
a few hundred tokens and invalidates nothing.

**`domain:update-collection-status` appears here, in the *browser* catalog.** It
is `expose.aiSdk: false` on the server, so it is not a server tool at all. It
reaches the model only as a contextual reference owned by the component that has
the invoice, which is what makes the binding above possible.

### ② Server, internal: composing the other half

The browser's catalog is untrusted input describing a UI. The server
independently builds the **domain** half from the authenticated session, so a
tampered request can add view declarations but can never grant itself a governed
capability.

`toAISDKTools` walks the registry and applies exposure and any discovery-phase
policies for this actor, scoped by the route's floor:

```
scope         app · invoices · reporting · collections
registry      10 capabilities
  →  list-invoices ✓   create-invoice ✓   update-invoice ✓   issue-invoice ✓
     delete-invoice ✓  mark-invoice-paid ✓  receivables-summary ✓  collections-aging ✓
     update-collection-status ✗ (aiSdk: false)
     list-clients ✗ (tagged `clients` — out of scope on this route)
  →  8 domain tools
```

Had Ada Analyst asked instead, `analyst-hides-writes` would have removed the
five writes at **discovery**, and the model would have been offered three reads.
Not three reads and five errors: three reads.

Then the anti-duplication rule runs across both halves:

```ts
findCatalogCollisions(step.catalog.frontendTools, domainInfo.map((d) => d.canonicalId))  // → []
```

Empty, so the step proceeds. Had `update-collection-status` also been
`expose.aiSdk: true`, it would have reached the model twice: once governed and
bound, once raw and unbound. Under v2 the duplicate frontend declaration is
dropped and the governed server tool kept, and the reduction is reported as an
`inspector` frame rather than silently applied.

Finally the 15 view descriptors become **execute-less** AI SDK tools. The model
can call them; there is no code path by which the server could run one.

### ③ Server → model: one flat tool list

Both planes are flattened into a single provider request. **The model is never
told which tools run where**: it sees 23 tools, distinguished only by the
`view_` / `domain_` naming convention and the effect prefix in each description.
Where execution happens is host bookkeeping.

The system prompt shapes *planning*, not permissions. Delete every guideline in
it and the enforcement below is unchanged: exposure, schema surgery, approvals
and server authorization all hold regardless of what the model decides to
attempt.

### ④ Model → server: the tool calls

The model reads the ageing ladder and narrows the screen **in the same message**:

```json
{ "stop_reason": "tool_use", "content": [
  { "type": "text",     "text": "Checking the ageing ladder and narrowing to overdue." },
  { "type": "tool_use", "id": "toolu_01A", "name": "domain_collections-aging",           "input": {} },
  { "type": "tool_use", "id": "toolu_01B", "name": "view_invoices__pending__setFilters", "input": { "due": "overdue" } }
]}
```

**This is the sharp edge the host exists to absorb.** Mastra executes the server
tool (the procedure really runs, the audit record is really written) and then
suspends the run for the browser *without emitting that result*. It appears in
neither `fullStream` nor `stream.toolResults`. Left alone, the model would
receive a `tool-call` with no `tool-result`, which most providers reject
outright, and the UI would show a card stuck on "running" forever.

So the host captures domain results as they are produced and answers any call
Mastra left open (`settleOrphanedServerCalls`). A call with **no** captured
result never ran, and is told so plainly (`TOOL_NOT_EXECUTED`, `retry: "yes"`)
rather than being reported as a failure it did not have ([ADR-0009](../adr/0009-orphaned-server-tool-calls.md)).

### ⑤ Server → browser: frames, then hand back control

The server streams what happened, then returns two things it will immediately
forget: the messages this run produced, and the calls the browser must execute.
**After the last frame the server holds no run state**: the browser owns the
conversation.

```jsonl
{"type":"step-start","stepId":"stp_qdb6","turnId":"turn_01","conversationId":"conv_7f3a","scope":["app","invoices","reporting","collections"],"domainTools":[…8 entries…]}
{"type":"reasoning-delta","text":"Read the ageing, then narrow the table to what is overdue."}
{"type":"text-delta","text":"Checking the **ageing ladder** and narrowing to `overdue`.\n"}
{"type":"tool-call","toolCallId":"toolu_01A","wireName":"domain_collections-aging","canonicalId":"domain:collections-aging","executor":"server","input":{}}
{"type":"tool-call","toolCallId":"toolu_01B","wireName":"view_invoices__pending__setFilters","canonicalId":"view:invoices.pending.setFilters","executor":"browser","input":{"due":"overdue"}}
{"type":"inspector","lane":"runtime","eventType":"capability.requested","summary":"capability.requested · collections-aging"}
{"type":"inspector","lane":"runtime","eventType":"capability.completed","summary":"capability.completed · collections-aging"}
{"type":"tool-result","toolCallId":"toolu_01A","wireName":"domain_collections-aging","canonicalId":"domain:collections-aging","ok":true,"result":[…]}
{"type":"inspector","lane":"runtime","eventType":"model.usage","summary":"16 in · 16 out (4 reasoning) · 1 model step"}
{"type":"step-finish","stepId":"stp_qdb6","finishReason":"tool-calls","responseMessages":[…],"pendingToolCalls":[{"toolCallId":"toolu_01B","wireName":"view_invoices__pending__setFilters","canonicalId":"view:invoices.pending.setFilters","input":{"due":"overdue"}}],"usage":{…}}
```

That `tool-result` for `toolu_01A` is the orphan settler at work: Mastra never
emitted it, and the host wrote it from the result it captured while the tool ran.

`domainTools` on `step-start` carries descriptions without schemas, so a
consumer can show the domain half of the catalog. The model's tool definitions
never travel back to the browser.

One field on it is load-bearing rather than diagnostic: `sideEffect`, copied
from each capability's own `meta.sideEffect`. The domain plane executes inside
the model loop on the server, so those writes never pass through the browser's
data layer and nothing in the tab knows the database moved. The browser builds a
wire-name → `sideEffect` map from this frame, per step, since the catalog is
composed per request, and invalidates its query cache on every `tool-result`
that is both `ok` and not a declared read. Anything that is not `"read"` or
`"none"`, including a value the browser does not recognise and the field being
absent altogether, counts as a write: one refetch too many costs a request, one
missed leaves the user reading numbers that have already changed.

One `ok` result is exempt: the approval suspension. A gated capability's first
result is `{ status: "approval-required", … }`: the pipeline parked the call in
an approval record and wrote **nothing**, so the browser does not reconcile on
it (`awaitingApproval` in `protocol.ts`, matched exactly so an unrecognised
envelope still errs toward refetching). The write it defers executes later,
inside `POST /api/approvals/:id`, when no stream is open anywhere, so the
decision response carries the resolution and the browser invalidates there
instead, on `resolution.status === "completed"`. Same convention, third
trigger; without it a gated write refetched at the suspension, when nothing had
changed, and stayed silent at the execution, when everything had.

The `inspector` frames are filtered by actor. The audit log is process-wide and
concurrent users write to it simultaneously, so an entry is forwarded only when
it is positively attributable to this session; one carrying no actor is dropped
rather than broadcast.

### ⑥ Browser, internal: execution against live state

`dispatchFrontendToolCall` resolves the wire name against the **live** toolset
rather than a handler cached when the step began: a component unmounted
mid-step yields a typed `CAPABILITY_NOT_FOUND`, never a call into a stale
closure. The model's `toolCallId` becomes the Agent Surface `invocationId`, so a
retried transport can never double-execute.

`setFilters` routes through the same setter the toolbar calls, which writes the
URL. The table re-renders to seven rows, and the address bar now reads
`?due=overdue`, and the view the agent produced is one the user can bookmark.

### ⑥b Browser, internal: waiting for the surface to catch up

Re-deriving the catalog every step is only half of "live". The other half is
*when*: a tool call returns to the loop across **microtasks**, while the surface
it changed moves on a **React commit**. Microtasks drain first, so a snapshot
taken the instant a call resolves is the surface as it was *before* the call.

So the loop waits (`settle.ts`): after any call whose effect is not `read`, it
yields task boundaries until the registry has been quiet for a whole one, with a
floor of two ticks and a ceiling that stops a never-settling screen from holding
the turn.

**Quiet is not done.** React Router wraps navigation *and* `setSearchParams`
(which is how this app's filters and sort are applied) in `startTransition`. The URL
has already moved; the tree commits tens to hundreds of milliseconds later,
across task boundaries that are perfectly silent. So the caller passes a
predicate (`until`), and quiet does not count until the committed location
agrees with the URL. Without it, step 2 would be handed the catalog of a screen
the user has already left.

### Steps 2–3: reading back, and answering

| Step | Model calls | Result |
|---|---|---|
| 1 | `view_invoices__pending__readState` | 7 rows, `totalRows: 13`, `truncated: false` |
| 2 | *(none)* | The answer, from what step 1 returned |

`readState` reports `rowCount` **and** `totalRows`, which is what makes the
narrowing legible: seven alone could be the whole ledger, and a model that
cannot tell will not think to widen. The answer, *"7 invoices are overdue,
worth €102,600"*, matches the Overdue KPI card exactly, because the screen and
the capability compute it with the same function.

### What the trace demonstrates

**The catalog is a per-step push, not a session registration.** Three POSTs
carried three freshly derived catalogs. That is what keeps availability honest,
and it is also the protocol's main cost: every descriptor is re-serialized on
every step, which is why the volatile half is kept out of the tool block.

**Scope shaped what the model was offered, and authority shaped what existed.**
The route's floor removed `list-clients`; `expose.aiSdk: false` removed the
contextual capability from the *server* half; for an analyst, `analyst-hides-writes`
would have removed five more at discovery. Three different mechanisms, three
different questions, none of them the prompt.

**Visibility and authority stayed separated throughout.** The browser decided
what could be *seen*; the server decided what could be *done*. Had the model
asked to issue an invoice, `gateModelWrites` would have suspended it into an
approval record and the ledger would not have moved ([ADR-0010](../adr/0010-approvals-over-confirmations.md)).

## Run limits

Enforced by host code on both sides, not by prompt text:

| Limit | Value | Side |
|---|---|---|
| Model steps per request | 5 | server (`RUN_LIMITS.maxStepsPerRequest`) |
| Inactivity between chunks | 45 s | server (`RUN_LIMITS.modelTimeoutMs`) |
| Protocol steps per turn | 8 | browser (`MAX_STEPS_PER_TURN`) |
| Turn deadline | 180 s | browser (`TURN_DEADLINE_MS`) |
| Identical consecutive failures | 3 | browser (`LOOP_LIMITS.maxIdenticalFailures`) |
| Any consecutive failures | 4 | browser (`LOOP_LIMITS.maxConsecutiveFailures`) |

## Host error codes

Distinct from capability errors, these are transport and runtime conditions. A
code with no HTTP status arrives as an `error` frame on an open stream:

| Code | HTTP | Meaning |
|---|---|---|
| `PROTOCOL_VERSION_MISMATCH` | 409 | The request names a version the server does not serve. Reload. A request that omits `protocolVersion` entirely is malformed, not a mismatch |
| `PROTOCOL_DECODE_ERROR` | 400 | Malformed request or frame. Never used for a legal catalog that is merely too large |
| `CATALOG_TOO_LARGE` | 413 | A named limit was exceeded; the message carries plane, count and limit |
| `CATALOG_COLLISION` | 409 | One operation exposed through two model-visible paths. **v1 only**; under v2 the duplicate is dropped and the turn continues |
| `MODEL_NOT_CONFIGURED` | 503 | No provider key is set, so there is no model to run |
| `MODEL_TIMEOUT` | frame | No chunk within the inactivity window |
| `MODEL_ERROR` | frame | The provider rejected the request |
| `RUN_LIMIT_EXCEEDED` | frame | A limit above was hit; the message says which |
| `TRANSPORT_FAILED` | frame | The stream failed. The cause is deliberately not relayed: a fetch rejection carries the URL and sometimes the body, and this message reaches the model |
| `NO_SUCH_TOOL` | frame | The model named a tool in neither plane. Answered with `retry: "no"`, since the step's catalog is the complete set that exists |

Capability-level failures are in [Error codes](errors.md); the layers the identifiers tie together are in [Architecture](../concepts/architecture.md).
