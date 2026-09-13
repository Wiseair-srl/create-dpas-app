import assert from "node:assert/strict";
import { createServer } from "vite";
import { createBrowserSurfaceSession } from "@agent-surface/core/host";
import { buildId } from "./surface-contract.mjs";

const headers = { authorization: "Bearer local-demo", "content-type": "application/json" };
const post = async (origin, path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
const host = "http://127.0.0.1:4312";
const backend = "http://127.0.0.1:4311";
const turn = (text, announcement) =>
  post(host, "/turn", {
    message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
    announcement,
  });
const read = await turn("Read invoice");
assert.equal(read.outcomes[0].outcome.status, "completed");
assert.equal(read.outcomes[0].outcome.output.id, "invoice-1");
assert.equal(read.pending.length, 0);
const payment = await turn("Pay invoice");
const pending = payment.outcomes[0];
assert.equal(pending.outcome.status, "approval-required");
await post(backend, `/approvals/${pending.outcome.approval.id}`, { approved: true });
const resumed = await post(host, `/resume/${payment.runId}`, { toolCallId: pending.toolCallId });
assert.equal(resumed.outcomes[0].outcome.status, "completed");
assert.equal(resumed.outcomes[0].outcome.invocationId, pending.outcome.invocationId);
assert.equal(resumed.outcomes[0].outcome.output.paid, true);
let highlights = 0;
// Load the real compiler transform and virtual authority, exactly as Vite serves
// the browser. No repository-only authority bypass or handcrafted proof.
const compiler = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let registry;
try {
  const { createReferenceSurface } = await compiler.ssrLoadModule("/surface-definition.ts");
  registry = createReferenceSurface(() => {
    highlights += 1;
  });
} finally {
  await compiler.close();
}
const session = createBrowserSurfaceSession({
  registry,
  identity: { appId: "reference", buildId, sessionId: "local-user", tabId: crypto.randomUUID() },
});
const viewTurn = await turn("Highlight invoice", session.connect(crypto.randomUUID()));
assert.equal(viewTurn.pending.length, 1);
const call = viewTurn.pending[0];
const result = await session.invoke(call);
assert.equal(result.result.status, "ok");
const settled = await post(host, "/surface/result", result);
assert.equal(settled.accepted, true);
assert.match(settled.text, /Browser result:/);
assert.equal((await post(host, "/surface/result", result)).accepted, true);
await session.invoke(call);
assert.equal(highlights, 1);
session.disconnect();
assert.equal((await session.invoke(call)).result.reason, "disconnected");
session.dispose();
registry.dispose();
