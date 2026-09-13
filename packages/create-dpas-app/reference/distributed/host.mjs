import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import { createHttpCapabilityClient } from "@orpc-agent/core/http";
import {
  createMemoryHostCallStore,
  createMemorySurfaceCallStore,
  createSurfaceHost,
  prepareMastraTurn,
  inputFingerprint,
} from "create-dpas-app/host";
import { createMastraDomainTools, createMastraClientTools } from "create-dpas-app/host/mastra";
import { buildId, surfaceTool } from "./surface-contract.mjs";
import { scriptedModel } from "./model.mjs";

const store = createMemoryHostCallStore();
const surfaceStore = createMemorySurfaceCallStore();
const announcements = new Map();
const turns = new Map();
const continuations = new Map();
const storage = new InMemoryStore();
// Mastra1.53 retains execute closures on same-instance resume. Reconstruct the
// Agent with the same ID/shared storage to bind every continuation to fresh auth.
function createAgent() {
  const agent = new Agent({
    id: "distributed-reference",
    name: "Reference",
    instructions: "Use the offered tools. Pause for approvals.",
    model: scriptedModel(),
    memory: new Memory(),
  });
  new Mastra({ agents: { agent }, storage });
  return agent;
}
const sessionId = "local-user";
function authenticate(request) {
  if (request.headers.get("authorization") !== "Bearer local-demo") throw new Error("Unauthorized");
  return sessionId;
}
function clientFor(request) {
  // Rebuilt per authorized request. No bearer token in memory, tool receipts or traces.
  return createHttpCapabilityClient({
    url: "http://127.0.0.1:4311/capabilities",
    headers: () => ({ authorization: request.headers.get("authorization") }),
  });
}
const surface = createSurfaceHost({
  store: surfaceStore,
  authorizeCall: (call, authenticatedSessionId, phase) => {
    const announcement = announcements.get(call.identity.tabId);
    if (
      authenticatedSessionId !== sessionId ||
      !announcement ||
      call.identity.buildId !== buildId ||
      call.identity.appId !== "reference" ||
      announcement.connectionId !== call.connectionId ||
      call.invocation.capabilityId !== surfaceTool.canonicalId ||
      (phase === "dispatch" &&
        (announcement.snapshot.surfaceVersion !== call.invocation.surfaceVersion ||
          !announcement.snapshot.components.some(
            (c) =>
              c.registrationId === call.invocation.registrationId &&
              c.actions.some((a) => a.capabilityId === surfaceTool.canonicalId),
          )))
    )
      throw new Error("Unrecognized or stale browser capability");
  },
});
const app = new Hono();
app.onError((_error, c) => c.json({ error: "Request rejected" }, 400));
app.get("/health", (c) => c.json({ ok: true }));
app.post("/turn", async (c) => {
  authenticate(c.req.raw);
  const body = await c.req.json();
  const runId = crypto.randomUUID();
  const turn = prepareMastraTurn(
    { message: body.message },
    { resourceId: sessionId, threadId: "reference-thread", runId },
  );
  const announcement = body.announcement;
  if (announcement) {
    if (
      announcement.protocolVersion !== 1 ||
      announcement.type !== "surface-announcement" ||
      announcement.identity.sessionId !== sessionId ||
      announcement.identity.buildId !== buildId ||
      announcement.identity.appId !== "reference"
    )
      throw new Error("Unknown announcement");
    announcements.set(announcement.identity.tabId, announcement);
  }
  const client = clientFor(c.req.raw);
  const outcomes = [];
  const tools = createMastraDomainTools({
    client,
    store,
    descriptors: await client.describe(),
    sessionId,
    runId,
    onOutcome: (event) => outcomes.push(event),
  });
  const component = announcement?.snapshot.components.find((c) => c.type === "reference.panel");
  const clientTools = await createMastraClientTools({
    descriptors: component ? [surfaceTool] : [],
    authorizeDescriptor: (descriptor) => {
      if (inputFingerprint(descriptor) !== inputFingerprint(surfaceTool))
        throw new Error("Unknown build contract");
    },
  });
  turns.set(runId, { announcement, component });
  const stream = await createAgent().stream(turn.messages, {
    ...turn.options,
    toolsets: { domain: tools },
    clientTools,
    maxSteps: 3,
  });
  const pending = [];
  for await (const chunk of stream.fullStream) {
    if (chunk.type === "tool-call" && chunk.payload.toolName === surfaceTool.wireName) {
      if (!announcement || !component) throw new Error("No live browser");
      pending.push(
        await surface.dispatch(
          {
            protocolVersion: 1,
            type: "surface-call",
            identity: announcement.identity,
            connectionId: announcement.connectionId,
            runId,
            toolCallId: chunk.payload.toolCallId,
            invocation: {
              invocationId: crypto.randomUUID(),
              capabilityId: surfaceTool.canonicalId,
              registrationId: component.registrationId,
              surfaceVersion: announcement.snapshot.surfaceVersion,
              input: chunk.payload.args,
            },
          },
          sessionId,
        ),
      );
    }
  }
  return c.json({ runId, text: await stream.text, outcomes, pending });
});
app.post("/surface/result", async (c) => {
  authenticate(c.req.raw);
  const result = await surface.acceptResult(await c.req.json(), sessionId);
  // Construct the receipt from the persisted host call, never client-authored history.
  const key = JSON.stringify([sessionId, result.runId, result.toolCallId]);
  if (!continuations.has(key))
    continuations.set(
      key,
      (async () => {
        const client = clientFor(c.req.raw);
        const tools = createMastraDomainTools({
          client,
          store,
          descriptors: await client.describe(),
          sessionId,
          runId: result.runId,
        });
        const stream = await createAgent().stream(
          [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: result.toolCallId,
                  toolName: surfaceTool.wireName,
                  output: { type: "json", value: result.result },
                },
              ],
            },
          ],
          {
            runId: crypto.randomUUID(),
            memory: { thread: "reference-thread", resource: sessionId },
            toolsets: { domain: tools },
            maxSteps: 3,
          },
        );
        await stream.consumeStream();
        return { accepted: true, result, text: await stream.text };
      })(),
    );
  return c.json(await continuations.get(key));
});
app.post("/resume/:runId", async (c) => {
  authenticate(c.req.raw);
  const runId = c.req.param("runId");
  if (!turns.has(runId)) return c.notFound();
  const { toolCallId } = await c.req.json();
  if (!(await store.get({ sessionId, runId, toolCallId }))) return c.notFound();
  const client = clientFor(c.req.raw);
  const outcomes = [];
  const tools = createMastraDomainTools({
    client,
    store,
    descriptors: await client.describe(),
    sessionId,
    runId,
    onOutcome: (event) => outcomes.push(event),
  });
  const stream = await createAgent().resumeStream(
    { continue: true },
    {
      runId,
      toolCallId,
      memory: { thread: "reference-thread", resource: sessionId },
      toolsets: { domain: tools },
      maxSteps: 3,
    },
  );
  await stream.consumeStream();
  return c.json({ text: await stream.text, outcomes });
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 4312 });
