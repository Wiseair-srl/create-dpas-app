"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CircleOff, EyeOff, Lock, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import {
  useInspectorStore,
  type CatalogRow,
  type InspectorEvent,
} from "@/agent/inspector/inspector-store";
import { ArchitectureMap } from "./architecture-map";

/**
 * The Agent Inspector: what the model can currently see (and why not), and a
 * correlated timeline of everything that happened across all layers.
 *
 * The core distinction on display — "authority hides, state discloses":
 * a capability the identity may never use is ABSENT; a capability blocked by
 * current state is VISIBLE with its reason.
 */
export function InspectorPanel() {
  const [tab, setTab] = useState<"catalog" | "timeline" | "map">("catalog");
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inspector-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2" role="tablist">
        {(["catalog", "timeline", "map"] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "h-6 rounded px-2 text-xs font-medium capitalize",
              tab === key
                ? "bg-surface-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {key}
          </button>
        ))}
      </div>
      <div className="dpas-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "catalog" ? <CatalogView /> : tab === "timeline" ? <TimelineView /> : <ArchitectureMap />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog

interface DomainCatalogResponse {
  actor: { userId: string; role: string };
  visible: Array<{
    canonicalId: string;
    wireName: string;
    description: string;
    sideEffect: string;
    risk: string;
    requiresApproval: boolean;
  }>;
  hiddenForActor: Array<{ canonicalId: string; reason: string }>;
  notAgentExposed: Array<{ path: string; reason: string }>;
}

function CatalogView() {
  const viewCatalog = useInspectorStore((s) => s.viewCatalog);
  const surfaceVersion = useInspectorStore((s) => s.surfaceVersion);
  const { session } = useSession();
  const domain = useQuery<DomainCatalogResponse>({
    queryKey: ["agent-catalog", session?.role],
    queryFn: async () => {
      const res = await fetch("/api/agent/catalog");
      if (!res.ok) throw new Error("catalog fetch failed");
      return (await res.json()) as DomainCatalogResponse;
    },
    enabled: Boolean(session),
    refetchOnMount: "always",
  });

  const viewRows = viewCatalog.filter((row) => row.plane === "view");
  const contextualRows = viewCatalog.filter((row) => row.plane === "domain");

  return (
    <div className="space-y-5 text-xs" data-testid="inspector-catalog">
      <section aria-label="View plane capabilities">
        <CatalogHeading
          badge={<Badge variant="view">view:*</Badge>}
          title="Presentation plane"
          note={`live surface v${surfaceVersion ?? "…"} · executes in this browser tab`}
        />
        <ul className="mt-2 space-y-1">
          {viewRows.map((row) => (
            <CapabilityLine key={row.canonicalId + (row.registrationId ?? "")} row={row} />
          ))}
          {viewRows.length === 0 ? (
            <li className="text-muted-foreground">No view capabilities registered (loading?).</li>
          ) : null}
        </ul>
      </section>

      <section aria-label="Contextual domain references">
        <CatalogHeading
          badge={<Badge variant="domain">domain:* contextual</Badge>}
          title="Contextual references"
          note="declared by the surface · executed browser → oRPC → server"
        />
        <ul className="mt-2 space-y-1">
          {contextualRows.map((row) => (
            <CapabilityLine key={row.canonicalId} row={row} showBindings />
          ))}
          {contextualRows.length === 0 ? (
            <li className="flex items-center gap-1.5 text-muted-foreground">
              <EyeOff aria-hidden className="h-3.5 w-3.5" />
              None on this surface for the current identity — for a viewer,
              domain:devices.disable is hidden by authority, not merely disabled.
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-label="Domain plane capabilities">
        <CatalogHeading
          badge={<Badge variant="domain">domain:* direct</Badge>}
          title="Domain plane (server tools)"
          note={`governed by oRPC Agent for ${domain.data?.actor.role ?? "…"} · executes on the server`}
        />
        <ul className="mt-2 space-y-1">
          {(domain.data?.visible ?? []).map((row) => (
            <li key={row.canonicalId} className="rounded border border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <code className="font-mono">{row.canonicalId}</code>
                <span className="text-faint-foreground">{row.sideEffect}</span>
                <AvailabilityChip available />
              </div>
            </li>
          ))}
          {(domain.data?.hiddenForActor ?? []).map((row) => (
            <li
              key={row.canonicalId}
              className="rounded border border-dashed border-border px-2 py-1.5 text-muted-foreground"
            >
              <div className="flex items-center gap-2">
                <EyeOff aria-hidden className="h-3.5 w-3.5" />
                <code className="font-mono line-through opacity-70">{row.canonicalId}</code>
                <span>{row.reason}</span>
              </div>
            </li>
          ))}
        </ul>
        {domain.data && domain.data.notAgentExposed.length > 0 ? (
          <p className="mt-2 text-[11px] leading-4 text-faint-foreground">
            Not agent-exposed at all:{" "}
            {domain.data.notAgentExposed.map((p) => p.path).join(", ")} — procedures without agent
            metadata never become tools.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function CatalogHeading({
  badge,
  title,
  note,
}: {
  badge: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {badge}
      <h3 className="font-semibold">{title}</h3>
      <span className="text-[11px] text-faint-foreground">{note}</span>
    </div>
  );
}

function CapabilityLine({ row, showBindings = false }: { row: CatalogRow; showBindings?: boolean }) {
  return (
    <li
      className={cn(
        "rounded border px-2 py-1.5",
        row.available ? "border-border" : "border-dashed border-border text-muted-foreground",
      )}
      data-capability={row.canonicalId}
      data-available={row.available}
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono">{row.canonicalId}</code>
        <span className="text-faint-foreground">{row.kind}</span>
        {row.confirmation === "required" ? (
          <Badge variant="danger">confirmation</Badge>
        ) : null}
        <AvailabilityChip available={row.available} reason={row.unavailableReason} />
      </div>
      {showBindings && row.boundFields && row.boundFields.length > 0 ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-faint-foreground">
          <Lock aria-hidden className="h-3 w-3" />
          bound from UI state:{" "}
          {row.boundFields.map((f) => `${f.path}${f.locked ? " (locked)" : ""}`).join(", ")}
        </p>
      ) : null}
    </li>
  );
}

function AvailabilityChip({ available, reason }: { available: boolean; reason?: string }) {
  if (available) {
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-success">
        <Check aria-hidden className="h-3 w-3" /> available
      </span>
    );
  }
  return (
    <span className="ml-auto inline-flex items-center gap-1">
      <CircleOff aria-hidden className="h-3 w-3" />
      {reason ?? "unavailable"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Timeline

function TimelineView() {
  const events = useInspectorStore((s) => s.events);
  const clear = useInspectorStore((s) => s.clear);

  // Precompute turn boundaries so render stays pure (no reassignment).
  const rows = useMemo(
    () =>
      events.map((event, index) => {
        const turn = event.correlation?.turnId;
        const prevTurn = events
          .slice(0, index)
          .map((e) => e.correlation?.turnId)
          .filter(Boolean)
          .at(-1);
        return { event, turn, showTurnBreak: Boolean(turn && turn !== prevTurn) };
      }),
    [events],
  );

  return (
    <div data-testid="inspector-timeline">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {events.length} events · correlated across surface, host, runtime and domain
        </p>
        <Button size="sm" variant="ghost" onClick={clear} className="text-muted-foreground">
          <Trash2 aria-hidden className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
      <ol className="space-y-1 text-xs">
        {rows.map(({ event, showTurnBreak, turn }) => (
          <Fragment key={event.id}>
            {showTurnBreak ? (
              <li
                aria-hidden
                className="mt-3 border-t border-dashed border-border pt-1 font-mono text-[10px] text-faint-foreground first:mt-0"
              >
                turn {turn}
              </li>
            ) : null}
            <EventLine event={event} />
          </Fragment>
        ))}
        {events.length === 0 ? (
          <li className="text-muted-foreground">
            No events yet. Run the guided demo or send a message — every layer reports here.
          </li>
        ) : null}
      </ol>
    </div>
  );
}

const LANE_STYLES: Record<InspectorEvent["lane"], string> = {
  surface: "bg-plane-view-soft text-plane-view",
  host: "bg-accent-soft text-accent",
  runtime: "bg-surface-muted text-muted-foreground",
  domain: "bg-plane-domain-soft text-plane-domain",
  experience: "bg-surface-muted text-muted-foreground",
};

function EventLine({ event }: { event: InspectorEvent }) {
  return (
    <li className="flex items-start gap-2 rounded border border-border/70 px-2 py-1" data-lane={event.lane}>
      <span
        className={cn(
          "mt-px inline-block w-[4.5rem] shrink-0 rounded px-1 py-px text-center text-[10px] font-medium",
          LANE_STYLES[event.lane],
        )}
      >
        {event.lane}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate leading-4">
          <span
            className={cn(
              event.status === "error" && "text-danger",
              event.status === "ok" && "text-success",
            )}
          >
            {event.summary}
          </span>
          {typeof event.durationMs === "number" ? (
            <span className="text-faint-foreground"> · {event.durationMs}ms</span>
          ) : null}
        </p>
        {event.correlation ? (
          <p className="truncate font-mono text-[10px] leading-4 text-faint-foreground">
            {[
              event.correlation.toolCallId && `call:${event.correlation.toolCallId}`,
              event.correlation.confirmationId && `cnf:${event.correlation.confirmationId}`,
              event.correlation.registrationId && `reg:${event.correlation.registrationId.slice(0, 12)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
      <time className="shrink-0 font-mono text-[10px] text-faint-foreground">
        {event.at.slice(11, 19)}
      </time>
    </li>
  );
}
