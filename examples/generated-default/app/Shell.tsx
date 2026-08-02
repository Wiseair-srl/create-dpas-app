import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  IconBoxMultiple,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconReceipt,
  type Icon,
} from "@tabler/icons-react";

import { AgentSurfaceRoot } from "./agent/surface/wiring";
import { CopilotDock, CopilotDockToggle, useCopilotDock } from "./features/copilot/CopilotDock";
import { SECTIONS, leafForPath, sectionForPath, type NavSection } from "./nav-config";
import { RoleSwitcher } from "./components/RoleSwitcher";
import { Kbd } from "./components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { ThemeToggle } from "./components/ui/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { useSession } from "./lib/session";

/**
 * The app shell: icon+label sections — multi-leaf ones expanded outright as a
 * heading over their leaves, single-leaf ones as a flat row — plus a
 * collapsible icon rail (hover flyouts stand in for the expanded groups only
 * while collapsed). The header carries the page title, the demo identity, the
 * theme toggle and the copilot.
 *
 * The dock lives HERE, not on a page, and that is the architectural point
 * rather than a layout preference. A capability exists only while the component
 * that owns it is mounted, so a full-page chat could never see a table: the
 * moment you opened it, the table would be gone. Docked, the live surface the
 * agent is handed is the screen you are actually looking at — its filters, its
 * sort, its selection — and a bound domain action can bind to what you can see.
 */

/**
 * One recipe for every rail row, so the collapsed rail is a clean column of
 * squares and the expanded rail keeps the icon+label line. The keyboard ring is
 * explicit because the UA default `outline: auto` paints an off-brand box —
 * which shows up after a hover flyout closes and Radix hands focus back.
 *
 * `rounded-xl` and the roomier padding match the reference shell's generous
 * pill geometry rather than the framework-default `rounded-md` row.
 */
function navRowClass(collapsed: boolean, active: boolean) {
  return [
    "flex items-center rounded-xl text-sm transition-colors outline-hidden",
    "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    collapsed ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2.5",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "text-foreground hover:bg-hover",
  ].join(" ");
}

/** ⌘B on Apple keyboards, Ctrl+B elsewhere — the label the tooltip chip shows. */
const SIDEBAR_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent)
    ? "⌘B"
    : "Ctrl+B";

const SECTION_ICONS: Record<string, Icon> = {
  receivables: IconReceipt,
  architecture: IconBoxMultiple,
};

/** Collapsed rows lose their label — a tooltip carries it instead of `title`. */
function RailTooltip({
  label,
  enabled,
  children,
}: {
  label: ReactNode;
  enabled: boolean;
  children: React.ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionLeaves({ section, onNavigate }: { section: NavSection; onNavigate?: () => void }) {
  return (
    <div className="space-y-4">
      {section.groups.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label ? (
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    [
                      "block rounded-xl px-3 py-2 text-[13px] transition-colors outline-hidden",
                      "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      isActive
                        ? "bg-selected font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground",
                    ].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Shell() {
  const location = useLocation();
  const { user } = useSession();
  const dock = useCopilotDock();
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("dpas-sidebar") === "collapsed",
  );

  // ONE flyout at a time, one shared close timer: per-section state lets a
  // closing panel linger under the newly opened one.
  const [flyout, setFlyout] = useState<string | null>(null);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFlyout = (key: string) => {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    setFlyout(key);
  };
  const scheduleFlyoutClose = () => {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    flyoutTimer.current = setTimeout(() => setFlyout(null), 80);
  };

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      localStorage.setItem("dpas-sidebar", current ? "expanded" : "collapsed");
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const activeSection = sectionForPath(location.pathname);
  const leaf = leafForPath(location.pathname);

  // The document title is what `view:app.navigation.readCurrentRoute` reports,
  // so it is set here rather than per screen: one writer, and the agent's
  // answer to "where am I" cannot drift from the tab.
  useEffect(() => {
    document.title = leaf ? `${leaf.label} — Receivables` : "Receivables";
  }, [leaf]);

  return (
    <AgentSurfaceRoot user={user}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-dvh overflow-hidden bg-background">
          <aside
            className={[
              "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-150",
              collapsed ? "w-14" : "w-60",
            ].join(" ")}
          >
            <div
              className={[
                "flex items-center gap-2.5 px-4 py-6",
                collapsed ? "justify-center border-b border-sidebar-border pb-4" : "",
              ].join(" ")}
            >
              <Link
                to="/receivables/pending"
                aria-label="Receivables home"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              >
                <DpasMark />
              </Link>
              {!collapsed ? (
                <span className="truncate text-lg font-semibold tracking-tight">Receivables</span>
              ) : null}
            </div>

            <nav
              aria-label="Primary"
              className={[
                "flex-1 space-y-3 overflow-y-auto pb-4",
                collapsed ? "flex flex-col items-center overflow-x-hidden px-2 pt-3" : "px-3",
              ].join(" ")}
            >
              {SECTIONS.map((section) => {
                const Icon = SECTION_ICONS[section.key] ?? IconReceipt;
                const active = activeSection?.key === section.key;
                const leaves = section.groups.flatMap((group) => group.items);

                // A section with nothing to expand is just a link — the
                // reference shell's "Payables & Receivables" / "Forecast" rows
                // have no children either, so there is nothing to reveal.
                if (leaves.length <= 1) {
                  return (
                    <RailTooltip key={section.key} label={section.label} enabled={collapsed}>
                      <NavLink
                        to={leaves[0]?.path ?? section.basePath}
                        className={navRowClass(collapsed, active)}
                      >
                        <Icon className="size-5 shrink-0" aria-hidden />
                        {!collapsed ? <span className="truncate">{section.label}</span> : null}
                      </NavLink>
                    </RailTooltip>
                  );
                }

                // Collapsed: the rail is a column of icons, so a multi-leaf
                // section needs a hover flyout to reach anything but its first
                // leaf. Expanded, there is room to show the whole group
                // outright — a static heading over its leaves, always open,
                // rather than gated behind "is this the active section".
                if (collapsed) {
                  return (
                    <div
                      key={section.key}
                      onMouseEnter={() => openFlyout(section.key)}
                      onMouseLeave={scheduleFlyoutClose}
                    >
                      <Popover open={flyout === section.key} onOpenChange={() => undefined}>
                        <PopoverTrigger asChild>
                          <NavLink
                            to={leaves[0]?.path ?? section.basePath}
                            className={navRowClass(collapsed, active)}
                          >
                            <Icon className="size-5 shrink-0" aria-hidden />
                          </NavLink>
                        </PopoverTrigger>
                        <PopoverContent
                          side="right"
                          align="start"
                          sideOffset={8}
                          className="w-56 p-2"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onMouseEnter={() => openFlyout(section.key)}
                          onMouseLeave={scheduleFlyoutClose}
                        >
                          <p className="px-2 pb-1.5 text-xs font-semibold">{section.label}</p>
                          <SectionLeaves section={section} onNavigate={() => setFlyout(null)} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                }

                return (
                  <div key={section.key}>
                    <div className="flex items-center gap-2.5 px-3 pb-2 text-sm font-semibold text-foreground">
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{section.label}</span>
                    </div>
                    <SectionLeaves section={section} />
                  </div>
                );
              })}
            </nav>

            <div
              className={[
                "border-t border-sidebar-border",
                collapsed ? "flex justify-center px-2 py-3" : "p-3",
              ].join(" ")}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleSidebar}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className={navRowClass(collapsed, false)}
                  >
                    {collapsed ? (
                      <IconLayoutSidebarLeftExpand className="size-4" aria-hidden />
                    ) : (
                      <IconLayoutSidebarLeftCollapse className="size-4" aria-hidden />
                    )}
                    {!collapsed ? <span className="text-[13px]">Collapse</span> : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {collapsed ? "Expand" : "Collapse"} <Kbd>{SIDEBAR_SHORTCUT}</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
              {/* A label, not the document heading — the page owns that (see
                  PageHeader). Two <h1>s saying the same thing is a document
                  with two titles, and a screen reader announces it as one. */}
              <p className="truncate text-sm font-semibold">{leaf?.label ?? "Receivables"}</p>
              <div className="flex items-center gap-1.5">
                <RoleSwitcher />
                <ThemeToggle />
                <CopilotDockToggle open={dock.open} onToggle={dock.toggle} />
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
                <Outlet />
              </main>
              <CopilotDock open={dock.open} onClose={dock.toggle} />
            </div>
          </div>
        </div>
      </TooltipProvider>
    </AgentSurfaceRoot>
  );
}

/** Two offset planes — the dual-plane mark. */
function DpasMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="6.5" y="6.5" width="7.5" height="7.5" rx="1.5" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}
