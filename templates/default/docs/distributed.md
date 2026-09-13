# Separate backend, agent and browser deployments

The starter remains a single-process application. Existing projects can install
`create-dpas-app` as an integration kit without adopting its router, UI or database.

| Runtime              | Owns                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Backend / Lambda     | Domain procedures, authentication, authorization, approvals, invocation receipts and audit delivery |
| Agent host / Fargate | Mastra loop and memory, fresh remote clients, durable run/tool/invocation correlation               |
| Browser              | Agent Surface registrations, live context bindings, local confirmations and UI execution            |

## Install the host kit

```bash
pnpm add create-dpas-app@^0.6.0 @orpc-agent/core@^5.0.0 ai@^6
```

Exports:

- `create-dpas-app/host`: `createDomainHost`, host call/store types,
  `prepareMastraTurn`, `createSurfaceHost`, surface call/store types.
- `create-dpas-app/host/mastra`: `createMastraDomainTools`,
  `createMastraClientTools`, `stopOnHostSuspension`.
- `create-dpas-app/host/postgres`: `createPgHostCallStore`, `HOST_CALLS_DDL`.
- `create-dpas-app/host/transport`: browser-safe `createHostTransport`.

AI SDK is an optional peer: the CLI, storage and transport imports do not load it.
The Mastra adapter supports AI SDK 5 and 6; the new integration tests run AI SDK
6.0.191 and Mastra 1.53.0. The original starter retains its AI SDK 5 protocol.

## Backend authority

Mount `createCapabilityGateway` from `@orpc-agent/core/server` with your existing
oRPC `RPCHandler`. Supply authentication, shared resource authorization, a fresh
runtime for each request, an invocation journal and a deployment revision. Fix
`surface: "aiSdk"` at the route. The caller cannot select `surface: "direct"`.

Use `registerZodSchemaConverter()` from `@orpc-agent/core/schema/zod` before
constructing the registry in standalone Lambda bundles. Keep immutable governance
and database pools outside the handler. The gateway owns bounded audit draining;
choose its request deadline below the deployment's full HTTP request budget.

Production persistence uses `createPgApprovalCoordinator`,
`createPgInvocationJournal` and `createPgAuditSink` from `@orpc-agent/postgres`.
Apply their DDL through application migrations. Approval decisions are separate,
authenticated human endpoints; never add approve/deny to the model toolset.

The portable model wire contract is JSON. Date outputs become ISO strings;
normalize Date inputs to a reviewed JSON input schema before invocation.
Discovery, static contracts and invocation authorization remain separate checks.
Only expose capabilities on the intended surface; MCP exposure does not grant
AI SDK exposure.

## Fargate tools and durable correlations

```ts
import { createHttpCapabilityClient } from "@orpc-agent/core/http";
import { createMastraDomainTools } from "create-dpas-app/host/mastra";
import { createPgHostCallStore, HOST_CALLS_DDL } from "create-dpas-app/host/postgres";

// Run HOST_CALLS_DDL through your migration system once.
const store = createPgHostCallStore({ query: (sql, params) => pool.query(sql, params) });

// Inside an authenticated request or an authorized resumed run:
const client = createHttpCapabilityClient({
  url: `${backendUrl}/capabilities`,
  headers: async () => ({ authorization: `Bearer ${await getFreshToken()}` }),
});
const tools = createMastraDomainTools({
  client,
  store,
  descriptors: await client.describe(),
  sessionId: trustedTenantAndUserId,
  runId: persistedRunId,
  onOutcome: async (event) => publishAuthorizedReceipt(event),
});
```

The store reserves `sessionId → runId → toolCallId → invocationId` **before**
network dispatch. Re-instantiating the host reconciles the same backend receipt.
Changed arguments or capability contracts conflict. A missing receipt or failed
fresh authorization returns `outcome-unknown`; it does not replay a possible
effect or disclose a cached result.

`HostCallStore.reserve` must atomically insert if absent; `compareAndSet` updates
only its expected revision. The shipped Postgres implementation provides both.
Keep receipt retention at least as long as recoverable runs. The in-memory
implementation is for local examples and tests.

The host journal cannot close the crash window between an external effect and
its backend receipt. Domain handlers still need transactional business constraints,
outboxes or downstream idempotency using the gateway's stable effect key. Long
jobs should enqueue work and return a task ID within the Lambda request.

## Mastra memory and approval continuation

Create request-scoped agents with a stable ID and shared application storage:

```ts
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";

function createAgent() {
  const agent = new Agent({
    id: "application-copilot",
    name: "Copilot",
    instructions,
    model,
    memory: new Memory(),
  });
  new Mastra({ agents: { copilot: agent }, storage: sharedMastraStorage });
  return agent;
}
```

Keep your existing model, memory configuration and shared Postgres store. Use
this factory for each initial turn and continuation; it avoids sharing captured
request credentials across users. This pattern is tested with Mastra 1.53.0 and
Memory 1.20.0 in the reference.

```ts
import { prepareMastraTurn } from "create-dpas-app/host";

// Authorize the thread first; identities here are server-derived.
const turn = prepareMastraTurn(requestBody, {
  resourceId: authenticatedUserId,
  threadId: authorizedThreadId,
  runId: persistedRunId,
});
const stream = await createAgent().stream(turn.messages, {
  ...turn.options,
  toolsets: { domain: tools },
  clientTools,
});
```

`requestBody` contains exactly `{ message: { id, role: "user", parts:
[{ type: "text", text }] } }`. Configure Mastra Memory and persistent storage on
the agent. The browser sends only the newest user message. Full histories,
client-authored system messages, tool receipts, roles and memory identities are
rejected. A server UUID replaces the client message ID so a browser cannot overwrite a
previous stored message. For idempotent HTTP request retries, persist and supply
a server-generated `identity.messageId`. File/image inputs require an
application-owned validation extension.

On `approval-required` or `outcome-unknown`, the adapter calls Mastra's native
`suspend` extension. After an authorized human decision reaches the backend,
rebuild tools with fresh credentials and construct a **fresh Agent instance**
with the same agent ID and shared Mastra storage, then call:

```ts
const freshAgent = createAgent();
const resumed = await freshAgent.resumeStream(
  { continue: true },
  {
    runId: originalRunId,
    toolCallId: originalToolCallId,
    memory: { thread: authorizedThreadId, resource: authenticatedUserId },
    toolsets: { domain: rebuiltTools },
  },
);
```

Mastra 1.53 retains original tool executor closures when resuming the same Agent
instance, even if replacement toolsets are supplied. The native integration test
invalidates the original client and verifies that a fresh Agent uses the newly
authorized client and observer. Reuse storage/pools, not credential-bearing
Agent execution closures.

Resume data is only a continuation signal. It cannot approve the operation.
The tool checks the persisted mapping and calls backend `resumeApproval` with
the original invocation ID. Pending decisions suspend again. AI SDK-only callers
must set `stopWhen: [stepCountIs(limit), stopOnHostSuspension]` and use
`createDomainHost.resumeApproval` for authorized continuation.

Mastra conversation storage, suspended snapshots and uninterrupted running-turn
recovery are different concerns. This kit does not supply a workflow engine,
event replay transport or distributed run lease. Configure and test those with
your pinned Mastra runtime before promising recovery of active turns across task
replacement. Do not persist request-local bearer credentials or start two owners
for the same run during a rolling deployment.

## Browser capabilities

Use `createBrowserSurfaceSession` from `@agent-surface/core/host` around the live
registry. Give each document a fresh tab ID; connect using an authenticated
connection ID. Announcements go through application transport. Load known build
contracts on the host and validate the announced identity and offered capabilities.
Never derive trusted tool descriptions or schemas solely from browser input.

`createMastraClientTools` creates execute-less tools from those verified
descriptors. `createSurfaceHost.dispatch` persists each call's app/build/session,
tab, connection, run/tool call, registration and surface revision. Send that exact
call to `session.invoke`, then submit the resulting envelope to
`createSurfaceHost.acceptResult`. Continue Mastra with a server-constructed
`tool-result` message whose tool ID/name come from the stored dispatch and whose
value is the verified result. The reference demonstrates this with a fresh Agent
and shared Memory; it deduplicates continuation promises locally. Production
run coordination must also deduplicate continuation across host replacements. Identical results are deduplicated; wrong tabs,
unknown calls, moved connections and conflicting results are rejected.

Supply `SurfaceCallStore` persistence if pending browser calls must survive host
replacement. `authorizeCall(call, sessionId, phase)` checks owner, connection and
known build in both phases. Check current registration/availability at dispatch
only: successful navigation may remove the original surface before its result
arrives. The result must still match the stored original call.

Headless runs receive no client tools. A disconnected or reloaded browser does not
transfer pending UI mutations to another tab. Ambiguous UI effects require
reconciliation; browser deduplication is bounded by document/session lifetime.
Browser observations never grant backend resource authority.

For contextual domain operations, use `createOrpcAgentManifest` and
`createGovernedOrpcAgentBridge` from `@agent-surface/orpc`. The browser resolves
locked UI fields, then calls the same governed backend gateway. Server approval
remains separate from local confirmation. The host omits descriptors marked
`discovery: "contextual"`; if a mixed presentation hides additional direct tools,
supply their backend IDs through `contextualCapabilityIds`. When registry IDs
are overridden, use `manifest.tools[procedurePath].capabilityId` for deduplication,
not the surface's `domain:<procedurePath>` identity.

## Configurable starter transport

The generated app uses same-origin requests by default. Set `VITE_BACKEND_URL`
and `VITE_AGENT_URL`, or call `configureApplicationTransport` from
`app/lib/transport.ts` during bootstrap to supply deployment URLs, credentials
and an authenticated fetch function. Domain RPC, approvals and session requests
use the backend; chat and thread persistence use the agent host. Your deployments
must provide those routes and their CORS/authentication policies.

`createHostTransport` provides equivalent separate `backend(path, init)` and
`agent(path, init)` methods to existing frontend shells.

## Run the distributed reference

The published package includes `reference/distributed`: three local processes,
real oRPC governance, a scripted AI SDK 6 model in Mastra, Memory, and browser
Agent Surface dispatch. It needs no cloud or model credentials.

```bash
pnpm add -D create-dpas-app@^0.6.0
cp -R node_modules/create-dpas-app/reference/distributed ./dpas-distributed
cd dpas-distributed
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4310`. Try Read invoice, Pay invoice → Approve, and
Highlight in this tab. With the processes running, `pnpm test` verifies remote
reads, approval/resume correlation and browser result deduplication/disconnection.

The example binds loopback only, uses a fixed local demonstration credential and
in-memory stores. Its purpose is to exercise the runtime boundaries; replace
those explicit development choices for deployment. Automated tests additionally
exercise host replacement against shared Postgres receipt persistence, stale
browser calls and native Mastra suspend/resume. No AWS deployment or active-turn
process recovery is asserted by the reference.
