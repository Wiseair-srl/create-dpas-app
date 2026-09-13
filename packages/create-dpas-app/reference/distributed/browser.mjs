import { createBrowserSurfaceSession } from "@agent-surface/core/host";
import { createHostTransport } from "create-dpas-app/host/transport";
import { buildId } from "./surface-contract.mjs";
import { createReferenceSurface } from "./surface-definition.ts";

const registry = createReferenceSurface(() => {
  document.querySelector("#invoice").style.background = "#ffdd66";
});
const session = createBrowserSurfaceSession({
  registry,
  identity: { appId: "reference", buildId, sessionId: "local-user", tabId: crypto.randomUUID() },
});
session.connect(crypto.randomUUID());
// Vite proxies to independent origins. Real apps supply current token/cookie auth.
const transport = createHostTransport({
  backendUrl: "/backend",
  agentUrl: "/agent",
  fetch: (url, init) =>
    fetch(url, { ...init, headers: { ...init?.headers, authorization: "Bearer local-demo" } }),
});
const output = document.querySelector("#output");
const post = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
function display(value) {
  output.textContent = JSON.stringify(value, null, 2);
}
async function run(prompt) {
  const response = await transport.agent(
    "turn",
    post({
      message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] },
      announcement: session.announcement(),
    }),
  );
  const turn = await response.json();
  if (!response.ok) throw new Error(turn.error);
  for (const call of turn.pending) {
    const result = await session.invoke(call);
    const accepted = await transport.agent("surface/result", post(result));
    if (!accepted.ok) throw new Error("Browser result rejected");
    turn.browserResult = await accepted.json();
  }
  display(turn);
  for (const event of turn.outcomes) {
    if (event.outcome.status !== "approval-required") continue;
    const button = document.createElement("button");
    button.textContent = `Approve ${event.capabilityId}`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const decision = await transport.backend(
          `approvals/${event.outcome.approval.id}`,
          post({ approved: true }),
        );
        if (!decision.ok) throw new Error("Decision rejected");
        const resumed = await transport.agent(
          `resume/${turn.runId}`,
          post({ toolCallId: event.toolCallId }),
        );
        display(await resumed.json());
      } catch (error) {
        display({ error: error.message });
      }
    });
    document.querySelector("#approvals").append(button);
  }
}
for (const button of document.querySelectorAll("[data-prompt]"))
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await run(button.dataset.prompt);
    } catch (error) {
      display({ error: error.message });
    } finally {
      button.disabled = false;
    }
  });
window.addEventListener("pagehide", () => {
  session.dispose();
  registry.dispose();
});
