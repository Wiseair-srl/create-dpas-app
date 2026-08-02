import { IconLayoutSidebarRightCollapse, IconMessageCircle } from "@tabler/icons-react";
import { History, MessageSquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

import { CopilotSurface } from "./CopilotSurface";
import { useCopilotSession } from "./session";

/**
 * The copilot, docked to the right of whatever screen you are on.
 *
 * This is what makes the presentation plane worth having. A capability exists
 * only while the component that owns it is mounted, so a full-page chat could
 * never see a table: the moment you opened it, the table was gone. Docked, the
 * live surface the agent is handed is the screen you are actually looking at —
 * its filters, its sort, its selection — and a bound domain action can bind to
 * what you can see.
 *
 * The conversation itself lives in the module-scoped message store, so it
 * survives navigation without any work here: the dock is rendered by the shell,
 * which does not remount when the route changes.
 */

const OPEN_KEY = "dpas-copilot-open";
const WIDTH_KEY = "dpas-copilot-width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;

/** ⌘J on Apple keyboards, Ctrl+J elsewhere. ⌘B is already the sidebar. */
const SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent)
    ? "⌘J"
    : "Ctrl+J";

function readWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
    ? stored
    : DEFAULT_WIDTH;
}

export function useCopilotDock() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === "1");

  const toggle = useCallback(() => {
    setOpen((current) => {
      localStorage.setItem(OPEN_KEY, current ? "0" : "1");
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "j" || e.altKey || e.shiftKey) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { open, toggle, shortcut: SHORTCUT };
}

/** Header affordance. Lives in the shell so it is reachable from every screen. */
export function CopilotDockToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onToggle}
          aria-label={open ? "Close copilot" : "Open copilot"}
          aria-expanded={open}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md outline-hidden transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring",
            open
              ? "bg-selected text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
        >
          <IconMessageCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2 whitespace-nowrap">
          {open ? "Close copilot" : "Ask the copilot"}
          <kbd className="rounded border border-border/60 px-1 text-[10px]">{SHORTCUT}</kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function CopilotDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useCopilotSession();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  // Below lg the dock would leave nothing for the page, so it overlays instead.
  const overlay = !useMediaQuery("(min-width: 1024px)");
  const dragFrom = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => setWidth(readWidth()), []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const from = dragFrom.current;
      if (!from) return;
      // The handle is on the panel's LEFT edge, so dragging left widens it.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, from.width + (from.x - e.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      dragFrom.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (!dragging) localStorage.setItem(WIDTH_KEY, String(width));
  }, [dragging, width]);

  // Escape closes the overlay form, where it covers the page.
  useEffect(() => {
    if (!open || !overlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, overlay, onClose]);

  if (!open) return null;

  const panel = (
    <aside
      aria-label="Copilot"
      style={overlay ? undefined : { width }}
      className={cn(
        "relative flex shrink-0 flex-col border-l border-border bg-background",
        overlay ? "fixed inset-y-0 right-0 z-50 w-[min(26rem,100vw)] shadow-2xl" : "",
      )}
    >
      {!overlay && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize copilot"
          onPointerDown={(e) => {
            dragFrom.current = { x: e.clientX, width };
            setDragging(true);
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize",
            "after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent",
            "hover:after:bg-primary/40",
            dragging && "after:bg-primary/60",
          )}
        />
      )}

      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="flex-1 truncate pl-1.5 text-sm font-medium">Copilot</span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={session.newThread}
              aria-label="New thread"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageSquarePlus size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New thread</TooltipContent>
        </Tooltip>

        {/* The full page has a rail; a 420px dock gets a menu instead. */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Recent threads"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <History size={15} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Recent threads</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
            {session.threads.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</div>
            )}
            {session.threads.slice(0, 20).map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => void session.openThread(t.id)}
                className={cn("truncate", t.id === session.conversationId && "bg-selected")}
              >
                <span className="truncate">{t.title === t.id ? "Untitled thread" : t.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              aria-label="Close copilot"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {overlay ? <X size={15} /> : <IconLayoutSidebarRightCollapse className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="flex items-center gap-2 whitespace-nowrap">
              Close
              <kbd className="rounded border border-border/60 px-1 text-[10px]">{SHORTCUT}</kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1">
        {session.loadingThread ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading thread…
          </div>
        ) : (
          <CopilotSurface session={session} compact />
        )}
      </div>
    </aside>
  );

  if (!overlay) return panel;
  return (
    <>
      {/* Dismiss-on-click backdrop; the dock never blocks the page silently. */}
      <button
        aria-label="Close copilot"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-foreground/10"
      />
      {panel}
    </>
  );
}
