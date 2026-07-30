"use client";

import { action, observation } from "@agent-surface/core";
import { useAgentComponent } from "@agent-surface/react";
import { Boxes, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

export function NavRail() {
  const pathname = usePathname();
  const router = useRouter();

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
        execute: ({ path }) => {
          router.push(path);
        },
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
