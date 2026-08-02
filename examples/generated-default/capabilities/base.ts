import { ORPCError, os } from "@orpc/server";
import { agentProcedure, type AgentInvocationInfo } from "@orpc-agent/core";

import type { SessionUser } from "../server/auth";

/**
 * Every capability's oRPC context. `session` is the authenticated user of the
 * request; `agent` is injected by the runtime on agent-originated calls, and
 * its absence is how a plain UI read tells itself apart from a governed one.
 */
export type AppContext = {
  session: SessionUser;
  agent?: AgentInvocationInfo;
};

export function contextFor(session: SessionUser): AppContext {
  return { session };
}

const requireSession = os.$context<AppContext>().middleware(async ({ context, next }) => {
  if (!context.session?.email) {
    throw new ORPCError("UNAUTHORIZED", { message: "No session." });
  }
  return next();
});

/** Base builder for all capabilities: meta lives under `agent`. */
export const agentBase = agentProcedure(os.$context<AppContext>()).use(requireSession);
