import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import type { ApprovalRecord, ExecutionResult } from "@orpc-agent/core";
import * as z from "zod";

import { contextFor } from "../capabilities/base";
import { router } from "../capabilities/registry";
import { approvalReceiptMessage } from "./approval-receipt";
import { handleChatStep } from "./agent/host";
import {
  deleteThread as removeThread,
  getThread,
  listThreads,
  persistStep,
} from "./agent/thread-store";
import {
  DEMO_USERS,
  RoleSchema,
  SESSION_COOKIE,
  encodeSessionCookie,
  sessionFromRequest,
  type SessionUser,
} from "./auth";
import { resetStore } from "./db";
import { env, logBootConfig } from "./env";
import { handleMcpRequest } from "./mcp";
import { allowedModels, defaultModel } from "./mastra";
import { buildGovernedRouter } from "./rpc";
import { actorFor, runtime } from "./runtime";

/**
 * One process serves everything: the SPA, the typed data layer, the agent
 * host, approvals, threads and MCP.
 *
 * In development Vite serves the SPA on its own port and proxies these paths
 * here (vite.config.ts), so the URLs the client uses are identical either way
 * and the client never needs to know which mode it is in.
 */

const app = new Hono();

/** Identity, re-derived per request. Nothing reads it from a body. */
function currentUser(c: { req: { raw: Request } }): SessionUser {
  return sessionFromRequest(c.req.raw);
}

app.get("/api/health", (c) => c.json({ ok: true }));

// --- demo identity ---------------------------------------------------------

app.get("/api/session", (c) => {
  const user = currentUser(c);
  return c.json({
    user,
    models: allowedModels(),
    defaultModel: defaultModel(),
  });
});

/**
 * The demo identity switcher. The browser asks for a ROLE; the server signs the
 * cookie. A role claim in a request body is never read anywhere in this app,
 * and this endpoint is the only reason the browser can influence identity at
 * all — replace it, and auth.ts, with a real provider.
 */
app.post("/api/session", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RoleSchema.safeParse((body as { role?: unknown } | null)?.role);
  if (!parsed.success) return c.json({ error: "Unknown role." }, 400);
  const user = DEMO_USERS[parsed.data];
  c.header(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeSessionCookie(user)}; Path=/; SameSite=Lax; HttpOnly`,
  );
  return c.json({ user });
});

/** Demo convenience: restore the seeded ledger. Not an agent capability. */
app.post("/api/demo/reset", (c) => {
  resetStore();
  return c.json({ ok: true });
});

// --- oRPC: reads plain, writes governed via runtime.invoke -----------------

const rpc = new RPCHandler(buildGovernedRouter(router));
app.use("/rpc/*", async (c, next) => {
  const user = currentUser(c);
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/rpc",
    context: contextFor(user),
  });
  if (matched) return response;
  await next();
});

// --- the agent host --------------------------------------------------------

app.post("/agent/chat", (c) => handleChatStep(c.req.raw, currentUser(c)));

// --- MCP -------------------------------------------------------------------

app.all("/mcp", (c) => handleMcpRequest(c.req.raw, currentUser(c)));

// --- approvals -------------------------------------------------------------

function approvalCard(record: ApprovalRecord) {
  return {
    id: record.id,
    capabilityId: record.capabilityId,
    status: record.status,
    // Which surface suspended it. The approver page words the consequence of
    // approving differently for an MCP record (the requesting session runs
    // it) than for a copilot one (this server runs it in the decision POST).
    surface: record.surface,
    // Why it was gated, and by whom it was decided. The card renders both:
    // "approved" with no approver is a decision nobody can be asked about.
    reasons: record.reasons,
    risk: record.risk,
    input: record.input,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    ...(record.decision
      ? {
          decision: {
            status: record.decision.status,
            approver: record.decision.approver.displayName ?? record.decision.approver.id,
            decidedAt: record.decision.decidedAt,
          },
        }
      : {}),
  };
}

function serializeResult(result: ExecutionResult<unknown>) {
  switch (result.status) {
    case "completed":
      return { status: "completed" as const, output: result.output };
    case "failed":
    case "cancelled":
      return { status: result.status, error: { message: result.error.publicMessage } };
    default:
      return { status: "pending" as const };
  }
}

app.get("/api/approvals", async (c) => {
  const user = currentUser(c);
  const pending = (await runtime.approvals.list?.({ status: "pending" })) ?? [];
  // Scoped to the requester. An approval carries its input verbatim, so the
  // pending list is a read of somebody's arguments — never a shared inbox.
  return c.json(pending.filter((r) => r.actor.id === user.email).map(approvalCard));
});

/**
 * One approval at ANY status — the thread's history read. A decided approval
 * drops out of the pending list, so the card reads it here to keep showing what
 * was asked and what was decided instead of vanishing on reload.
 */
app.get("/api/approvals/:id", async (c) => {
  const user = currentUser(c);
  const record = await runtime.approvals.get(c.req.param("id"));
  if (!record || record.actor.id !== user.email) return c.json({ error: "not found" }, 404);
  return c.json(approvalCard(record));
});

const DecideBody = z.object({ approved: z.boolean(), threadId: z.string().optional() });

app.post("/api/approvals/:id", async (c) => {
  const user = currentUser(c);
  const parsed = DecideBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid decision body." }, 400);
  const id = c.req.param("id");

  // Read BEFORE deciding: the receipt names the capability and its arguments,
  // and after `decide` the record is no longer pending.
  const record = await runtime.approvals.get(id);
  if (!record || record.actor.id !== user.email) return c.json({ error: "not found" }, 404);

  try {
    await runtime.approvals.decide(id, {
      status: parsed.data.approved ? "approved" : "rejected",
      approver: actorFor(user),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Decision failed." }, 409);
  }

  // Resume here only for records suspended in THIS app's own loop. An MCP
  // record's output belongs to the session that asked: it executes over there,
  // through the adapter's `approvals_resume` tool — resuming it here would
  // consume the record out from under that session and strand the result in a
  // response nobody reads.
  const result =
    parsed.data.approved && record.surface !== "mcp"
      ? await runtime.resume(id, { context: contextFor(user) })
      : undefined;
  const receipt = approvalReceiptMessage(record, parsed.data.approved ? "approved" : "denied", result);

  // The decision re-enters the conversation as an assistant message. Without
  // this, the next turn reasons over a history in which the model asked for
  // something and nothing ever answered.
  if (parsed.data.threadId) {
    persistStep({
      threadId: parsed.data.threadId,
      resourceId: user.email,
      stepIndex: 1,
      inputMessages: [],
      responseMessages: [{ role: "assistant", content: receipt.text }],
    });
  }

  return c.json({
    receipt,
    resolution: result
      ? serializeResult(result)
      : parsed.data.approved
        ? { status: "approved" as const }
        : { status: "rejected" as const },
  });
});

// --- threads ---------------------------------------------------------------

app.get("/api/threads", (c) => c.json(listThreads(currentUser(c).email)));

/**
 * One thread's metadata — title, timestamps, and what it has cost so far.
 *
 * Separate from the rail's list because the rail is polled on a timer, and a
 * token total read off a poll that landed before the last turn is a wrong
 * number rather than a stale label. Separate from `/model-messages` because
 * that route's contract is "exactly what the browser would have sent", and
 * usage is not part of the conversation.
 */
app.get("/api/threads/:threadId", (c) => {
  const thread = getThread(currentUser(c).email, c.req.param("threadId"));
  if (!thread) return c.json({ error: "not found" }, 404);
  const { messages: _messages, ...meta } = thread;
  return c.json(meta);
});

/**
 * Reload a thread as MODEL messages, not UI messages.
 *
 * Under the host protocol the browser owns the conversation and re-posts it
 * every step, so what it needs back is exactly what it would have sent. The
 * rendered transcript is derived from these client-side (rehydrate.ts) — one
 * source, one conversion, so a reloaded thread cannot render one history and
 * reason over another.
 */
app.get("/api/threads/:threadId/model-messages", (c) => {
  const thread = getThread(currentUser(c).email, c.req.param("threadId"));
  if (!thread) return c.json({ error: "not found" }, 404);
  return c.json(thread.messages);
});

app.delete("/api/threads/:threadId", (c) => {
  const ok = removeThread(currentUser(c).email, c.req.param("threadId"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// --- static SPA (production build; dev uses the vite server + proxy) -------

const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: "./dist" }));
  // Client-side routing: anything unmatched is a route the SPA owns.
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

logBootConfig();
serve({ fetch: app.fetch, port: env.PORT });
