import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";

import type { AppRouter } from "../../capabilities/registry";

/**
 * The typed data layer. `client["list-invoices"](input)` calls /rpc; writes are
 * transparently governed server-side (server/rpc.ts), so a button and the agent
 * reach the same procedure under the same policy. `orpc` exposes the TanStack
 * Query utils over the same client.
 *
 * Relative URL on purpose: in development Vite proxies /rpc to the Hono server,
 * in production the same server serves both. The client never learns which.
 */
const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client: RouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
