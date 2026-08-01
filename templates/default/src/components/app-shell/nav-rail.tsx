"use client";

import { action, observation } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";
import { Boxes, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { zs } from "@/agent/surface/schema";
import { NavigateSchema, RouteStateSchema } from "@/features/devices/capabilities/schemas";

/**
 * Navigation rail. Owns `view:app.navigation.*`: the agent navigates by
 * semantic route, exactly like a user clicking these links — never by URL
 * manipulation or DOM clicks.
 */

const LINKS = [
  { href: "/dashboard" as const, label: "Dashboard", icon: LayoutGrid },
  { href: "/architecture" as const, label: "Architecture", icon: Boxes },
];

interface PendingNavigation {
  path: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Pushes a route and resolves when the router COMMITS the transition — the D23
 * authoring contract (agent-surface `docs/03` §lifecycle) for a `navigation`
 * action.
 *
 * `router.push` returns immediately. Resolving there reports success while the
 * old page is still mounted, so the host loop's next catalog is the one from
 * the route the agent just left: it navigates, and is then told the
 * destination has no capabilities. Waiting for `usePathname` to report the new
 * route makes the result mean what it says.
 *
 * At most one entry, and no queue of our own: actions are serialized per
 * component instance (D13), so a second `goTo` cannot start until this one
 * settles.
 *
 * This works because the rail lives in the app LAYOUT and survives the
 * transition it starts. A navigation capability owned by the page it navigates
 * away from cannot observe its own success — it is gone before the new route
 * commits — which is the authoring reason to put it here.
 */
function useRouteCommit(pathname: string): (path: string, signal: AbortSignal) => Promise<void> {
  const router = useRouter();
  const pending = useRef<PendingNavigation | null>(null);

  useEffect(() => {
    const inFlight = pending.current;
    if (!inFlight || inFlight.path !== pathname) return;
    pending.current = null;
    inFlight.resolve();
  }, [pathname]);

  return useCallback(
    (path, signal) =>
      new Promise<void>((resolve, reject) => {
        pending.current = { path, resolve, reject };
        // Timeout, cancellation, unmount. Rejecting while the signal is
        // aborted settles the invocation CANCELLED rather than
        // EXECUTION_FAILED (D23) — and the guard means a transition that has
        // already committed is never retracted by a late abort.
        signal.addEventListener(
          "abort",
          () => {
            if (pending.current?.resolve !== resolve) return;
            pending.current = null;
            reject(new Error("The navigation was abandoned before the route committed."));
          },
          { once: true },
        );
        router.push(path);
      }),
    [router],
  );
}

export function NavRail() {
  const pathname = usePathname();
  const commitRoute = useRouteCommit(pathname ?? "/");

  useAgentComponent({
    type: "app.navigation",
    description: "Application navigation between top-level sections",
    observations: {
      readCurrentRoute: observation({
        description: "The route currently open",
        output: zs(RouteStateSchema),
        read: () => ({ path: pathname ?? "/" }),
      }),
    },
    actions: {
      goTo: action({
        description: "Navigate to another section of the app",
        input: zs(NavigateSchema),
        effect: "navigation",
        idempotent: true,
        // Already there: idempotent, and no commit is coming to wait for.
        execute: ({ path }, ctx) =>
          path === pathname ? Promise.resolve() : commitRoute(path, ctx.signal),
      }),
    },
  });

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-14 flex-col items-center gap-1 border-r border-border bg-surface py-3"
    >
      <div
        aria-hidden
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-accent font-semibold text-accent-foreground"
      >
        <DpasMark />
      </div>
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md",
              active
                ? "bg-accent-soft text-accent"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}

/** Two offset planes — the dual-plane mark. */
function DpasMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="6.5"
        y="6.5"
        width="7.5"
        height="7.5"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.9"
      />
    </svg>
  );
}
