# Host protocol

> **This page:** the versioned browser↔server contract the Agent Host speaks over `POST /api/chat` — request, frames, composition rules, limits and error codes. It is application code in `src/agent/host/`, not a dependency ([ADR-0002](../adr/0002-host-protocol-over-react-ai-sdk.md)).

**Current version: `1`.**

## The shape

One POST is **one model step-run**. The server streams NDJSON frames back and holds no run state — *the messages are the state*.

1. The browser snapshots the live Agent Surface into wire descriptors (declaration only; executors stay in the tab) and posts them with the model-message history.
2. The server resolves the session from the cookie, composes the catalog — governed domain tools for that actor **plus** the declared frontend tools — rejects duplicate paths, runs one Mastra step and streams frames.
3. If the run ends at frontend tool calls, it **suspends**: the browser executes them through Agent Surface, appends the results and posts the next step.

The third point is the reason the protocol exists in this shape: **confirmations wait between requests**, not inside a held-open stream ([ADR-0005](../adr/0005-confirmation-wait-between-steps.md)). A human decision never blocks a connection, and a dropped connection never strands a decision.

## Request

```ts
{
  protocolVersion: 1,
  conversationId: string,      // ≤ 64 chars — one chat thread
  turnId: string,              // ≤ 64 chars — one user message and all it causes
  stepIndex: number,           // 0…64
  messages: WireModelMessage[],// 1…200 — the whole history; the server is stateless
  frontendTools: WireToolDescriptor[],  // ≤ 64
}
```

A `WireToolDescriptor` is what the model gets to know about a browser-side capability:

| Field | Meaning |
|---|---|
| `wireName` | Provider-safe name the model calls (≤ 64 chars) |
| `canonicalId` | `view:…` or `domain:…` — the audit identity |
| `plane` | `view` or `domain` |
| `description` | Model-facing description |
| `inputSchema` | JSON Schema, bound keys already removed |
| `effect` | `local-state`, `navigation`, `destructive`, … |
| `confirmation` | `never` · `optional` · `required` |
| `available` + `unavailableReason` | State disclosure — present but not callable, and why |

Declaring a frontend tool grants **visibility only**. Its executor never leaves the browser, and the server never gains a way to run it.

## Frames (NDJSON, server → browser)

| Frame | Carries |
|---|---|
| `step-start` | `stepId`, ids, and the **domain half of the composed catalog** for the Inspector |
| `text-delta` | Answer text |
| `reasoning-delta` | Model reasoning, on its own frame so the UI can fold it and never confuse it with the answer |
| `tool-call` | `toolCallId`, `wireName`, `canonicalId`, `executor: "server" \| "browser"`, `input` |
| `tool-result` | The same ids plus `ok` and `result` |
| `inspector` | Correlated events from `runtime`, `domain` or `host` lanes — forwarded audit activity |
| `step-finish` | `finishReason`, `responseMessages`, `pendingToolCalls`, optional `usage` |
| `error` | `{ code, message }` — a typed host error, never an exception |

`step-finish.responseMessages` are the model messages this run produced, reconstructed server-side; the browser appends them to its history. `pendingToolCalls` are the frontend calls it must execute before posting the next step.

A malformed frame is itself reported as an `error` frame with `PROTOCOL_DECODE_ERROR` rather than throwing inside the reader.

## Catalog composition rules

- **Per actor, per turn, never cached across users.** The domain half is produced by the oRPC Agent runtime for the session's actor, so exposure and policy are re-evaluated every step.
- **One uniform namespace.** Both planes use the same reversible mapping (`:` → `_`, `.` → `__`), so `domain:devices.list` reaches the model as `domain_devices__list`. The canonical id stays the audit identity.
- **Duplicate paths are rejected for the whole request.** If a domain operation appears both as a direct tool and as a contextual frontend declaration, the server returns **409 `CATALOG_COLLISION`** and records `catalog.collision` in the audit log. One operation, one model-visible path.

### Orphaned server calls

A model may call a server tool and a browser tool in the *same* message. Mastra executes the server tool but suspends the run for the browser **without emitting that result** — it appears in neither `fullStream` nor `stream.toolResults`. The host captures domain results as they are produced and answers any call Mastra left open (`settleOrphanedServerCalls`). Without it the model would receive a tool-call with no tool-result — which providers reject — and the UI would show a card stuck on *running*. A call that cannot be answered at all comes back as `TOOL_NOT_EXECUTED` with `retry: "yes"`, never silence ([ADR-0009](../adr/0009-orphaned-server-tool-calls.md)).

## End to end workflow example

The sections above define the contract in the abstract. This one follows a single user message through every hop of it, showing what each party sends, to whom, and why.

**The scenario.** Olivia Operator (`u-operator`, role `operator`, permissions `devices:read` + `devices:disable`) is on `/dashboard` with no filters and nothing selected. She types:

> Disable the offline devices in Milan.

In the seed data three devices match: `d-mi-03`, `d-mi-05`, `d-mi-07`. Fulfilling this takes six protocol steps, because the agent has to look before it acts — read state, narrow the filters, re-read, select, mutate, report.

**Two transports, and the difference matters.** Model traffic goes to `POST /api/chat` and carries no authority. The actual mutation goes to `POST /api/orpc`, authorized from the session cookie. The destructive call never travels over the chat endpoint.

| Hop | Direction | Purpose |
|---|---|---|
| ① | browser → server | Post the history plus the **live view catalog** |
| ② | server, internal | Build the domain catalog for this actor; reject duplicate paths |
| ③ | server → model | One provider request: system, messages, **both planes as one tool list** |
| ④ | model → server | Which tools to call, with arguments |
| ⑤ | server → browser | Stream frames; hand back the run's messages and what to execute |
| ⑥ | browser, internal | Execute through Agent Surface against live component state |
| ⑦ | browser → server | The mutation itself, over oRPC — a different endpoint entirely |

### ① Browser → server: the step request

The browser is the only party that knows what is on screen, so **it, not the server, decides what the model may see**. Before each step it snapshots the live registry and projects every mounted capability into a wire descriptor (`transport-client.ts`). Nothing is registered ahead of time; the catalog is rebuilt from scratch on every step so that `available` is never stale.

```json
{
  "protocolVersion": 1,
  "conversationId": "conv_7f3a",
  "turnId": "turn_01",
  "stepIndex": 0,
  "messages": [
    { "role": "user", "content": "Disable the offline devices in Milan." }
  ],
  "frontendTools": [
    {
      "wireName": "view_devices__table__readState",
      "canonicalId": "view:devices.table.readState",
      "plane": "view",
      "description": "[view · read] Visible rows (in view order), current selection, current sorting",
      "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
      "effect": "read",
      "confirmation": "never",
      "available": true
    },
    {
      "wireName": "domain_devices__disable",
      "canonicalId": "domain:devices.disable",
      "plane": "domain",
      "description": "[domain · destructive · requires confirmation] [currently unavailable: Select at least one device first] Disable the given devices. Destructive: they stop reporting data. Currently bound to the 0 selected device(s).",
      "inputSchema": {
        "type": "object",
        "properties": { "reason": { "type": "string" } },
        "additionalProperties": false
      },
      "effect": "destructive",
      "confirmation": "required",
      "available": false,
      "unavailableReason": "Select at least one device first"
    }
    // …10 more: filters.read/set, table.selectRows/sort,
    //           drawer.readState/open/close,
    //           app.navigation.readCurrentRoute/goTo, app.session.read
  ]
}
```

Three details in that payload carry most of the design:

**`deviceIds` is missing from `domain_devices__disable`, and that is deliberate.** The table binds it to the live selection and does not mark it overridable, so `reduceInputSchema` deletes the key from `properties` and `required` before the descriptor is ever built. The model is not *asked* to leave the selection alone — it is given no field in which to express one. `additionalProperties: false` closes the remaining gap.

**The unavailable capability is still sent.** Rather than hide it, the host declares it with `available: false` and folds the reason into the description. The model can then plan the enabling step ("select rows first") instead of discovering a missing tool and guessing. This is a deliberate token cost paid for better planning.

**`domain:devices.disable` appears here, in the *browser* catalog.** It is `expose.aiSdk: false` on the server, so it is not a server tool at all. It reaches the model only as a contextual reference owned by the component that has the selection — which is what makes the binding above possible.

### ② Server, internal: composing the other half

The browser's catalog is untrusted input describing a UI. The server independently builds the **domain** half from the authenticated session, so a tampered request can add view declarations but can never grant itself a governed capability.

`describePipeline` walks the capability registry and applies the exposure filter and any discovery-phase policies for this actor:

```
registry:  devices.list ✓   devices.get ✓   devices.disable ✗ (aiSdk:false)   devices.enable ✗ (test-only)
       →   domain_devices__list, domain_devices__get
```

Then the anti-duplication rule runs across both halves:

```ts
findCatalogCollisions(step.frontendTools, ["domain:devices.list", "domain:devices.get"])  // → []
```

Empty, so the step proceeds. Had `devices.disable` also been `expose.aiSdk: true`, it would have reached the model twice — once governed and bound, once raw and unbound — and the server would have returned **409 `CATALOG_COLLISION`** instead of running the step.

Finally the 12 view descriptors become **execute-less** AI SDK tools. The model can call them; there is no code path by which the server could run one:

```ts
tool({ description: d.description, inputSchema: jsonSchema(d.inputSchema) })  // no execute
```

### ③ Server → model: one flat tool list

Both planes are flattened into a single provider request. **The model is never told which tools run where** — it sees fourteen tools, distinguished only by the `view_` / `domain_` naming convention and the effect prefix in each description. Where execution happens is host bookkeeping.

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "system": "You are the assistant embedded in a device operations dashboard.\nTools prefixed \"view_\" read or change what the user currently sees…",
  "messages": [
    { "role": "user", "content": "Disable the offline devices in Milan." }
  ],
  "tools": [
    { "name": "view_devices__table__readState",  "description": "[view · read] …",                                "input_schema": {} },
    { "name": "view_devices__table__selectRows", "description": "[view · local-state] …",                         "input_schema": {} },
    { "name": "domain_devices__disable",         "description": "[domain · destructive · requires confirmation] [currently unavailable: …]", "input_schema": {} },
    { "name": "domain_devices__list",            "description": "List devices with optional status/city filters. Read-only.", "input_schema": {} },
    { "name": "domain_devices__get",             "description": "Fetch one device by id… Read-only.",             "input_schema": {} }
    // …14 total: 12 browser-executed, 2 server-executed
  ]
}
```

The system prompt shapes *planning*, not permissions. Delete every guideline in it and the enforcement below is unchanged — availability, schema surgery, confirmation and server authorization all hold regardless of what the model decides to attempt.

### ④ Model → server: the tool calls

Told to read before it changes, the model asks for current state first. Both requested tools are execute-less, so the AI SDK cannot run them and the step suspends.

```json
{ "stop_reason": "tool_use", "content": [
  { "type": "text",     "text": "Let me check the current filters and visible rows." },
  { "type": "tool_use", "id": "toolu_01A", "name": "view_devices__filters__read",    "input": {} },
  { "type": "tool_use", "id": "toolu_01B", "name": "view_devices__table__readState", "input": {} }
]}
```

### ⑤ Server → browser: frames, then hand back control

The server streams what happened, then returns two things it will immediately forget: the messages this run produced, and the calls the browser must execute. **After the last frame the server holds no run state** — the browser owns the conversation.

```jsonl
{"type":"step-start","stepId":"st_9c2","turnId":"turn_01","conversationId":"conv_7f3a","domainTools":[{"canonicalId":"domain:devices.list","wireName":"domain_devices__list","description":"List devices…","requiresApproval":false},{"canonicalId":"domain:devices.get","wireName":"domain_devices__get","description":"Fetch one device…","requiresApproval":false}]}
{"type":"text-delta","text":"Let me check the current filters"}
{"type":"tool-call","toolCallId":"toolu_01A","wireName":"view_devices__filters__read","canonicalId":"view:devices.filters.read","executor":"browser","input":{}}
{"type":"tool-call","toolCallId":"toolu_01B","wireName":"view_devices__table__readState","canonicalId":"view:devices.table.readState","executor":"browser","input":{}}
{"type":"step-finish","stepId":"st_9c2","finishReason":"tool-calls","responseMessages":[…],"pendingToolCalls":[{"toolCallId":"toolu_01A","wireName":"view_devices__filters__read","canonicalId":"view:devices.filters.read","input":{}},{"toolCallId":"toolu_01B","wireName":"view_devices__table__readState","canonicalId":"view:devices.table.readState","input":{}}],"usage":{"inputTokens":3480,"outputTokens":96}}
```

`domainTools` on `step-start` is **Inspector data only** — descriptions without schemas, so the panel can show the domain half of the catalog. The model's tool definitions never travel back to the browser.

### ⑥ Browser, internal: execution against live state

`dispatchFrontendToolCall` resolves each `wireName` against the **live** toolset rather than a handler cached when the step began — a component unmounted mid-step yields a typed `CAPABILITY_NOT_FOUND`, never a call into a stale closure. The model's `toolCallId` becomes the Agent Surface `invocationId`, so a retried transport cannot double-execute.

```jsonc
// toolu_01A
{ "ok": true, "value": { "status": "all", "city": null } }

// toolu_01B — 24 rows, all cities, nothing selected
{ "ok": true, "value": {
    "visibleRows": [
      { "id": "d-mi-01", "name": "milan-duomo-01",  "status": "online",  "city": "Milan", "disabled": false },
      { "id": "d-mi-03", "name": "milan-navigli-01","status": "offline", "city": "Milan", "disabled": false }
      // …22 more
    ],
    "selectedIds": [],
    "sorting": null } }
```

### Steps 1–3: narrowing, and why the catalog changes underneath

Each subsequent step repeats hops ①–⑥ with the history grown by one exchange **and the catalog re-derived from scratch**. That re-derivation is the point: as the UI changes, so does what the model is offered.

| Step | Model calls | Effect on the surface |
|---|---|---|
| 1 | `view_devices__filters__set { "status": "offline", "city": "Milan" }` | Table re-renders to 3 rows; surface version bumps |
| 2 | `view_devices__table__readState` | Sees `d-mi-03`, `d-mi-05`, `d-mi-07` |
| 3 | `view_devices__table__selectRows { "ids": ["d-mi-03","d-mi-05","d-mi-07"] }` | Selection set; **`domain:devices.disable` becomes available** |

The `selectRows` precondition verifies every id is currently visible, so the model cannot select a row the filters are hiding. On step 3 the procedure's `when: () => selectedIds.length > 0` flips true, and the descriptor posted at step 4 differs from the one posted at step 0:

```jsonc
{
  "wireName": "domain_devices__disable",
  "description": "[domain · destructive · requires confirmation] Disable the given devices. Destructive: they stop reporting data. Currently bound to the 3 selected device(s).",
  "inputSchema": { "type": "object", "properties": { "reason": { "type": "string" } }, "additionalProperties": false },
  "effect": "destructive",
  "confirmation": "required",
  "available": true          // ← was false; unavailableReason gone
}
```

The binding's `describe()` re-ran, so the count is live. `deviceIds` is still absent — availability changed, the exposure ceiling did not.

### Step 4: the destructive call

The model now calls the only tool it has for this, supplying the only field left in the schema:

```json
{ "type": "tool_use", "id": "toolu_05A", "name": "domain_devices__disable",
  "input": { "reason": "Offline in Milan; requested by operator." } }
```

**The confirmation happens in the browser, between two HTTP requests.** Agent Surface returns `CONFIRMATION_REQUIRED`; the toolset — built `topology: "remote"` with `confirmations: "wait"` — awaits the dialog in the gap before the next step is posted. No server stream is held open across the human decision, and a dropped connection cannot strand it ([ADR-0005](../adr/0005-confirmation-wait-between-steps.md)). The approval is single-use and bound to this exact effective input.

### ⑦ Browser → server: the mutation, over oRPC

Only after approval does the real call go out — to a **different endpoint**, through the same authenticated client every button in the app uses:

```http
POST /api/orpc  →  devices.disable
x-dpas-invocation-id: toolu_05A
x-dpas-confirmation-id: cnf_4d81

{
  "deviceIds": ["d-mi-03", "d-mi-05", "d-mi-07"],   // injected by the binding, never by the model
  "reason": "Offline in Milan; requested by operator."
}
```

Those headers are **audit correlation, never authorization**. The procedure authorizes from the session cookie alone: a forged `x-dpas-confirmation-id` buys nothing, and a viewer posting this request by hand is refused identically whether the headers are present or not. The agent path and the human path differ only in what gets *recorded*, not in what gets *allowed*.

The response comes back, and reconciliation closes the loop: `invocation-settled(ok)` for a `domain:` capability invalidates the devices query, TanStack refetches, and the table updates for the human **through the same data path a button click would have used**. The agent has no privileged write channel into the UI.

```json
{ "disabled": 3, "devices": [ /* … */ ] }
```

### Step 5: reporting

The tool result returns as `{ "ok": true, "value": { "disabled": 3, … } }`, the model emits its answer, and the run finishes with `finishReason: "stop"` and an empty `pendingToolCalls`. The turn ends having spent six of the eight steps the browser allows.

### What the trace demonstrates

**The catalog is a per-step push, not a session registration.** Six POSTs carried six freshly derived catalogs. That is what keeps `available` honest, and it is also the protocol's main cost — every descriptor is re-serialized and re-tokenized on every step.

**Three independent gates stopped the model from overreaching, none of them the prompt.** Schema surgery removed `deviceIds`; `when()` withheld the capability until a selection existed; the server re-authorized from the cookie. Each holds on its own.

**Visibility and authority stayed separated throughout.** The browser decided what could be *seen*; the server decided what could be *done*. The one payload that changed real data never went near the chat endpoint.

For the same run viewed as correlated Inspector events rather than wire payloads, see [Tracing a tool call](../guides/tracing-a-tool-call.md).

## Run limits

Enforced by host code on both sides, not by prompt text:

| Limit | Value | Side |
|---|---|---|
| Model steps per request | 5 | server (`RUN_LIMITS.maxStepsPerRequest`) |
| Inactivity between chunks | 45 s | server (`RUN_LIMITS.modelTimeoutMs`) |
| Protocol steps per turn | 8 | browser (`MAX_STEPS_PER_TURN`) |
| Turn deadline | 180 s | browser (`TURN_DEADLINE_MS`) |
| Identical consecutive failures | 3 | browser (`MAX_IDENTICAL_FAILURES`) |

## Host error codes

Distinct from capability errors — these are transport and runtime conditions:

| Code | HTTP | Meaning |
|---|---|---|
| `PROTOCOL_VERSION_MISMATCH` | 409 | Browser and server speak different versions. Reload |
| `PROTOCOL_DECODE_ERROR` | 400 | Malformed request or frame |
| `CATALOG_COLLISION` | 409 | One operation exposed through two model-visible paths |
| `MODEL_NOT_CONFIGURED` | 503 | No live provider configured |
| `MODEL_TIMEOUT` | — | No chunk within the inactivity window |
| `MODEL_ERROR` | — | The provider rejected the request |
| `RUN_LIMIT_EXCEEDED` | — | A limit above was hit; the message says which |
| `TRANSPORT_FAILED` | — | The stream failed |

Capability-level failures are in [Error codes](errors.md); the identifiers that tie a run together are in [Tracing a tool call](../guides/tracing-a-tool-call.md).
