import { NextResponse } from "next/server";
import { getAgentRuntime, capabilities } from "@/server/agent/runtime";
import { createContextForSession } from "@/server/orpc/context";
import { DEMO_USERS, resolveSession } from "@/server/auth/session";
import { domainToolName } from "@/agent/host/wire-names";

/**
 * Inspector support: the domain half of the catalog for the CURRENT actor,
 * plus which capability ids exist but are hidden from this actor by
 * authority ("authority hides — state discloses"). Names only, no schemas,
 * and clearly a developer-facing diagnostic endpoint.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = resolveSession(request.headers.get("cookie"));
  const runtime = getAgentRuntime();

  const visible = await runtime.describe("aiSdk", {
    actor: { id: session.userId, kind: "user" },
    context: createContextForSession(session),
  });

  // Probe with the operator identity to compute the authority-hidden set.
  const operatorView = await runtime.describe("aiSdk", {
    actor: { id: DEMO_USERS.operator.userId, kind: "user" },
    context: createContextForSession(DEMO_USERS.operator),
  });

  const visibleIds = new Set(visible.map((d) => d.id));
  const hiddenForActor = operatorView
    .filter((d) => !visibleIds.has(d.id))
    .map((d) => ({ canonicalId: `domain:${d.id}`, reason: "hidden by policy for this role" }));

  const inspect = capabilities.inspect();

  return NextResponse.json({
    actor: { userId: session.userId, role: session.role },
    visible: visible.map((descriptor) => ({
      canonicalId: `domain:${descriptor.id}`,
      wireName: domainToolName(descriptor.id),
      description: descriptor.description,
      sideEffect: descriptor.sideEffect,
      risk: descriptor.risk,
      requiresApproval: Boolean(descriptor.requiresApproval),
    })),
    hiddenForActor,
    /** Procedures that exist in the router but are not agent-exposed at all. */
    notAgentExposed: [
      ...inspect.excluded.map((entry) => ({ path: entry.path, reason: "no agent metadata" })),
      ...inspect.unexposed.map((id) => ({ path: id, reason: "no surface exposure" })),
    ],
  });
}
