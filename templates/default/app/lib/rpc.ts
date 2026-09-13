import { applicationFetch, backendEndpoint } from "./transport";
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
 * Same-origin by default; transport.ts supplies configurable backend URLs and
 * authenticated fetch when the backend and agent are deployed independently.
 */
const link = new RPCLink({
  url: () => backendEndpoint("/rpc"),
  fetch: applicationFetch,
});

export const client: RouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
