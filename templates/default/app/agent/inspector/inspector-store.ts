import { useSyncExternalStore } from "react";

/**
 * Developer-facing trace store for the agent pipeline. Every layer feeds it:
 * Agent Surface events, host protocol frames (both directions), confirmation
 * lifecycle, and server-side audit events forwarded over the chat stream.
 * Purely diagnostic — nothing reads it back into application state, and
 * nothing here may throw into the app.
 *
 * THIS TEMPLATE SHIPS NO PANEL over it, and that is a deliberate omission
 * rather than an unfinished one. The store is load-bearing: the host modules
 * report every catalog reduction into it — a collision, a truncation, an
 * undecodable wire name, an audit entry dropped because a reader fell behind —
 * and a drop nothing records reads as "nothing happened". What that trace is
 * worth *looking at* through is a product decision, so `useInspector` is a
 * React subscription you can render however your app wants, and the host never
 * has to know you did.
 *
 * The same events also leave the server as `inspector` protocol frames, so a
 * consumer outside the browser (a log pipeline, a test) can read them without
 * mounting anything at all.
 */

export type InspectorLane = "surface" | "host" | "runtime" | "domain" | "experience";

export interface InspectorCorrelation {
  conversationId?: string;
  turnId?: string;
  stepId?: string;
  toolCallId?: string;
  invocationId?: string;
  capabilityId?: string;
  registrationId?: string;
  confirmationId?: string;
  executionId?: string;
}

export interface InspectorEvent {
  id: string;
  at: string;
  lane: InspectorLane;
  type: string;
  summary: string;
  correlation?: InspectorCorrelation;
  data?: unknown;
  status?: "ok" | "error" | "pending" | "info";
  durationMs?: number;
}

export interface CatalogRow {
  canonicalId: string;
  plane: "view" | "domain";
  kind: "observation" | "action" | "procedure" | "direct-tool";
  description: string;
  effect: string;
  executor: "browser" | "server" | "browser→server";
  available: boolean;
  unavailableReason?: string;
  confirmation: "never" | "optional" | "required";
  registrationId?: string;
  boundFields?: Array<{ path: string; locked: boolean }>;
  hiddenReason?: string;
}

interface InspectorSnapshot {
  events: InspectorEvent[];
  viewCatalog: CatalogRow[];
  domainCatalog: CatalogRow[];
  surfaceVersion: string | null;
}

const MAX_EVENTS = 400;
let counter = 0;

let snapshot: InspectorSnapshot = {
  events: [],
  viewCatalog: [],
  domainCatalog: [],
  surfaceVersion: null,
};

const listeners = new Set<() => void>();

function commit(next: Partial<InspectorSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Imperative accessor for non-React modules (host transport, dispatch). */
export const inspector = {
  push(event: Omit<InspectorEvent, "id" | "at"> & { at?: string }) {
    const entry: InspectorEvent = {
      id: `ins_${++counter}`,
      at: event.at ?? new Date().toISOString(),
      ...event,
    };
    const events = [...snapshot.events, entry];
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    commit({ events });
  },
  setViewCatalog(rows: CatalogRow[], surfaceVersion: string) {
    commit({ viewCatalog: rows, surfaceVersion });
  },
  setDomainCatalog(rows: CatalogRow[]) {
    commit({ domainCatalog: rows });
  },
  clear() {
    commit({ events: [] });
  },
  read(): InspectorSnapshot {
    return snapshot;
  },
};

/** React binding for a future Inspector panel. */
export function useInspector(): InspectorSnapshot {
  return useSyncExternalStore(subscribe, inspector.read, inspector.read);
}
