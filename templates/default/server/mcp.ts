import { createMCPServer } from "@orpc-agent/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { contextFor } from "../capabilities/base";
import type { SessionUser } from "./auth";
import { actorFor, runtime } from "./runtime";

/**
 * The same governed capabilities, over MCP.
 *
 * This endpoint exists to prove a claim the architecture makes and would
 * otherwise only assert: the registry is transport-agnostic. Nothing here
 * re-declares a capability, re-implements a policy or re-checks a permission —
 * it hands the same runtime a different surface name, and `expose.mcp` decides
 * what appears. `update-collection-status` is `aiSdk: false` because the in-app
 * agent must reach it through the live screen; it is `mcp: true` because an MCP
 * client has no screen to bind to and no pretence of one.
 *
 * Authorization is the demo session cookie, exactly as everywhere else. A real
 * deployment puts OAuth in front of this route and maps the token to an actor —
 * that is the only change, and it happens here rather than in any capability.
 */
export async function handleMcpRequest(request: Request, user: SessionUser): Promise<Response> {
  const server = createMCPServer(runtime, {
    serverInfo: { name: "dpas-receivables", version: "1.0.0" },
    createContext: async () => ({
      actor: actorFor(user),
      context: contextFor(user),
    }),
  });
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(request);
}
