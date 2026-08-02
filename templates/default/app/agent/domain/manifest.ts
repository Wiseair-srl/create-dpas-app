import type { OrpcAgentManifest } from "@agent-surface/orpc";

import { collectionStatusInput, collectionStatusOutput } from "../../../capabilities/schemas";
import { toJsonSchema } from "@/agent/surface/schema";

/**
 * The frontend's declaration of which domain procedures may be referenced
 * contextually — the exposure ceiling for the presentation plane. A procedure
 * missing from this manifest cannot be bound by any component, whatever the
 * component code says.
 *
 * The entry here is `expose: { aiSdk: false }` in its capability file: one
 * operation, one model-visible path. It stays on `mcp` and `direct`, so the
 * MCP server and the UI are unaffected — only the in-app agent is required to
 * come through the live surface, where the input is bound to what the user is
 * actually looking at.
 *
 * DELIBERATELY ABSENT: everything in `GATED_CAPABILITIES`
 * (capabilities/policies.ts) — `issue-invoice` and `delete-invoice`. A
 * contextual binding reaches the server over /rpc as `surface: "direct"`,
 * which `gateModelWrites` lets through ungated by design, so binding a gated
 * capability would trade a persisted server-side approval record for a
 * browser-side dialog. Weaker authority, on exactly the operations that least
 * want it. Those stay direct governed tools with their approval card.
 *
 * That is the whole rule in one sentence: bind for CONTEXT, gate for
 * CONSEQUENCE.
 */
export const domainManifest: OrpcAgentManifest = {
  tools: {
    "update-collection-status": {
      description:
        "Record a collections chase against the invoice whose dialog is open: last reminder " +
        "date, reminders sent, expected payment date, note. Patch semantics — only the fields " +
        "you pass are written.",
      inputSchema: toJsonSchema(collectionStatusInput),
      // The chase record as it stands after the write. Declared so the bridge's
      // ref is typed rather than `unknown` — which is also what lets the
      // compiled contract state a return shape instead of shrugging.
      outputSchema: toJsonSchema(collectionStatusOutput),
      effect: "server-mutation",
    },
  },
};
