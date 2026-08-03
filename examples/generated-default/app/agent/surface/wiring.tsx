import { AgentSurfaceProvider, useAgentComponent, useAgentSurface } from "@agent-surface/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { SECTIONS } from "@/nav-config";

import { appNavigationContract, appSessionContract } from "./contracts";
import { getSurfaceRegistry, setSurfaceRoute, setSurfaceSession, type SurfaceUser } from "./registry";

/**
 * Mounts the Agent Surface registry into React and wires the runtime couplings
 * the architecture requires:
 *
 * 1. Reconciliation — a successful `domain:` invocation invalidates the query
 *    cache, exactly as a button's mutation does. The agent writes through the
 *    same data layer as every human path; it has no privileged channel into
 *    the UI.
 *
 *    A THIRD of the story, and the fraction is the point: this subscription
 *    sees only what the agent runs in the BROWSER. Most domain capabilities
 *    are composed server-side and execute inside the model loop, where no
 *    surface event is ever emitted — those reconcile from the stream instead,
 *    in `agent/host/transport-client.ts` (`onDomainMutation`). And a GATED
 *    write executes in neither moment: the stream sees only its suspension,
 *    and the write itself happens inside the approval decision, which
 *    reconciles in `features/copilot/tool-ui.tsx` (`decide`). One convention,
 *    three triggers, because there are three moments a domain write can land.
 *    Reading any one of them as complete is exactly the bug that made agent
 *    writes update the screen sometimes.
 * 2. Route + session — kept in refs the registry reads lazily at snapshot and
 *    invoke time.
 *
 * The two app-level capabilities live here because the shell owns that state.
 * They are what a hand-rolled chat integration usually implements as ungoverned
 * `navigate` / `whoami` tool calls: same two operations, now with schemas,
 * preconditions, a canonical audit id and a lifetime.
 *
 * What they expose is declared in ./contracts.ts; this file supplies only the
 * behaviour behind it.
 */

/** Every route the shell can reach — the precondition set for `goTo`. */
export const KNOWN_ROUTES: readonly string[] = SECTIONS.flatMap((section) =>
  section.groups.flatMap((group) => group.items.map((item) => item.path)),
);

function AppCapabilities({ user }: { user: SurfaceUser }) {
  const location = useLocation();
  const navigate = useNavigate();

  useAgentComponent(appNavigationContract, {
    observations: {
      readCurrentRoute: {
        read: () => ({
          path: location.pathname,
          title: document.title,
          knownRoutes: [...KNOWN_ROUTES],
        }),
      },
    },
    actions: {
      goTo: {
        precondition: ({ path }) =>
          KNOWN_ROUTES.includes(path)
            ? undefined
            : {
                message: `"${path}" is not a route in this app.`,
                details: { knownRoutes: [...KNOWN_ROUTES] },
              },
        execute: ({ path }) => navigate(path),
      },
    },
  });

  useAgentComponent(appSessionContract, {
    observations: {
      read: {
        read: () => ({ email: user.email, name: user.name, role: user.role }),
      },
    },
  });

  return null;
}

function SurfaceWiring({ user }: { user: SurfaceUser | null }) {
  const registry = useAgentSurface();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Route info feeds snapshots; the registry reads it lazily. The search
    // string rides along unread by the snapshot: it is what tells the host that
    // a router-applied change (a filter, a sort) has actually COMMITTED, since
    // the URL moves a transition ahead of the tree.
    setSurfaceRoute(location.pathname, location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    setSurfaceSession(user);
  }, [user]);

  useEffect(
    () =>
      registry.subscribe((event) => {
        if (event.type !== "invocation-settled") return;
        const capabilityId = "capabilityId" in event ? event.capabilityId : undefined;
        const ok = "status" in event && event.status === "ok";
        // Blanket invalidation is the app-wide convention — do not narrow it
        // here, or the agent and the buttons would refresh the page
        // differently, and the difference would be a bug nobody can see.
        // The server plane runs the identical line from the stream consumer,
        // and the approval decision from tool-ui.tsx; narrowing one of the
        // three would also make them disagree.
        if (ok && typeof capabilityId === "string" && capabilityId.startsWith("domain:")) {
          void queryClient.invalidateQueries();
        }
      }),
    [registry, queryClient],
  );

  // Keyed by email: registering bumps the surface version, so per-turn toolsets
  // recompute when the identity changes under the tab.
  return user ? <AppCapabilities key={user.email} user={user} /> : null;
}

export function AgentSurfaceRoot({
  user,
  children,
}: {
  user: SurfaceUser | null;
  children: ReactNode;
}) {
  return (
    <AgentSurfaceProvider registry={getSurfaceRegistry()}>
      <SurfaceWiring user={user} />
      {children}
    </AgentSurfaceProvider>
  );
}
