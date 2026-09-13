import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { os, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { z } from "zod";
import {
  agentProcedure,
  createAgentRuntime,
  createCapabilityRegistry,
  createInMemoryApprovalCoordinator,
  defineGovernance,
  definePolicy,
  allow,
  requireApproval,
} from "@orpc-agent/core";
import { registerZodSchemaConverter } from "@orpc-agent/core/schema/zod";
import { createCapabilityGateway, createInMemoryInvocationJournal } from "@orpc-agent/core/server";

registerZodSchemaConverter();
const invoice = { id: "invoice-1", amount: 10000, paid: false };
const base = agentProcedure(os);
const router = {
  readInvoice: base
    .meta({
      agent: {
        description: "Read the invoice",
        expose: { aiSdk: true },
        sideEffect: "read",
        risk: "low",
        adapters: { aiSdk: { toolName: "read_invoice" } },
      },
    })
    .input(z.object({}))
    .handler(() => ({ ...invoice })),
  payInvoice: base
    .meta({
      agent: {
        description: "Record payment after human approval",
        expose: { aiSdk: true },
        sideEffect: "write",
        risk: "medium",
        adapters: { aiSdk: { toolName: "pay_invoice" } },
      },
    })
    .input(z.object({ id: z.literal("invoice-1") }))
    .handler(() => {
      invoice.paid = true;
      return { ...invoice };
    }),
};
const governance = defineGovernance({
  registry: createCapabilityRegistry(router),
  policies: [
    definePolicy("approve-writes", ({ capability }) =>
      capability.meta.sideEffect === "write"
        ? requireApproval({ reason: "Confirm the payment", approvalType: "human-confirmation" })
        : allow(),
    ),
  ],
});
// Development choices. Production uses Postgres coordinators, journals and audit sinks.
const approvals = createInMemoryApprovalCoordinator();
const journal = createInMemoryInvocationJournal();
const createRuntime = () =>
  createAgentRuntime({
    governance,
    approvals: { coordinator: approvals, rejectSelfApproval: false },
    audit: () => {}, // Explicit development choice; production supplies durable sinks.
  });
const actor = { id: "local-user", kind: "user" };
function authenticate(request) {
  if (request.headers.get("authorization") !== "Bearer local-demo")
    throw new ORPCError("UNAUTHORIZED");
  return { actor, namespace: "local-reference", context: {} };
}
const gateway = createCapabilityGateway({
  authenticate: async ({ request }) => authenticate(request),
  authorize: async ({ principal }) => {
    if (principal.actor.id !== actor.id) throw new ORPCError("FORBIDDEN");
  },
  createRuntime,
  journal,
  surface: "aiSdk",
  revision: "reference-v1",
});
const handler = new RPCHandler(gateway);
const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.all("/capabilities/*", async (c) => {
  const result = await handler.handle(c.req.raw, {
    prefix: "/capabilities",
    context: { request: c.req.raw },
  });
  return result.response ?? c.notFound();
});
// Human decision route: absent from agent tools, authenticated independently.
app.post("/approvals/:id", async (c) => {
  const principal = authenticate(c.req.raw);
  const record = await approvals.get(c.req.param("id"));
  if (!record || record.actor.id !== principal.actor.id) return c.notFound();
  const body = await c.req.json();
  if (typeof body.approved !== "boolean")
    return c.json({ error: "Expected approved boolean" }, 400);
  await approvals.decide(record.id, {
    status: body.approved ? "approved" : "rejected",
    approver: principal.actor,
  });
  return c.json({ decided: true });
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 4311 });
