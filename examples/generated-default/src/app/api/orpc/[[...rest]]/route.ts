import { RPCHandler } from "@orpc/server/fetch";
import { router } from "@/server/orpc/router";
import { createContextFromRequest } from "@/server/orpc/context";

/**
 * The oRPC HTTP surface. Both the dashboard UI and the contextual agent path
 * (Agent Surface → authenticated oRPC client) arrive here; the procedures'
 * own middleware re-derives identity and authorization on every call.
 */
const handler = new RPCHandler(router);

async function handle(request: Request) {
  const { matched, response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: createContextFromRequest(request),
  });
  if (matched) return response;
  return new Response("Not found", { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
