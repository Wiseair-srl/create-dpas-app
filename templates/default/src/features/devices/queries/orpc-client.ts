"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/server/orpc/router";

/**
 * The app's authenticated oRPC client — the same transport a human-clicked
 * button uses. The contextual agent path rides this exact client; when it
 * does, it attaches correlation metadata (invocation + confirmation ids) that
 * the server records for audit. The metadata is untrusted context, never
 * authorization — the session cookie decides what is allowed.
 */
export interface AgentCallClientContext {
  agentInvocationId?: string;
  confirmation?: { id: string; approvedAt: string };
}

const link = new RPCLink<AgentCallClientContext>({
  url: () => {
    if (typeof window === "undefined") {
      throw new Error("The oRPC browser client cannot be used during server rendering.");
    }
    return `${window.location.origin}/api/orpc`;
  },
  headers: ({ context }) => ({
    ...(context?.agentInvocationId ? { "x-dpas-invocation-id": context.agentInvocationId } : {}),
    ...(context?.confirmation ? { "x-dpas-confirmation-id": context.confirmation.id } : {}),
  }),
});

export const orpcClient: RouterClient<AppRouter, AgentCallClientContext> =
  createORPCClient(link);

export const orpcQuery = createTanstackQueryUtils(orpcClient);
