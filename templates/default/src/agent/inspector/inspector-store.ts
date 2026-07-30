"use client";

import { create } from "zustand";

/**
 * Developer-facing trace store for the Agent Inspector. Every layer feeds it:
 * Agent Surface events, host protocol frames (both directions), confirmation
 * lifecycle, and server-side audit events forwarded over the chat stream.
 * Purely diagnostic — nothing reads it back into application state.
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

interface InspectorState {
  events: InspectorEvent[];
  viewCatalog: CatalogRow[];
  domainCatalog: CatalogRow[];
  surfaceVersion: string | null;
  push: (event: Omit<InspectorEvent, "id" | "at"> & { at?: string }) => void;
  setViewCatalog: (rows: CatalogRow[], surfaceVersion: string) => void;
  setDomainCatalog: (rows: CatalogRow[]) => void;
  clear: () => void;
}

const MAX_EVENTS = 400;
let counter = 0;

export const useInspectorStore = create<InspectorState>((set) => ({
  events: [],
  viewCatalog: [],
  domainCatalog: [],
  surfaceVersion: null,
  push: (event) =>
    set((state) => {
      const entry: InspectorEvent = {
        id: `ins_${++counter}`,
        at: event.at ?? new Date().toISOString(),
        ...event,
      };
      const events = [...state.events, entry];
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      return { events };
    }),
  setViewCatalog: (rows, surfaceVersion) => set({ viewCatalog: rows, surfaceVersion }),
  setDomainCatalog: (rows) => set({ domainCatalog: rows }),
  clear: () => set({ events: [] }),
}));

/** Imperative accessor for non-React modules (host transport, demo runner). */
export const inspector = {
  push(event: Omit<InspectorEvent, "id" | "at"> & { at?: string }) {
    useInspectorStore.getState().push(event);
  },
  setViewCatalog(rows: CatalogRow[], surfaceVersion: string) {
    useInspectorStore.getState().setViewCatalog(rows, surfaceVersion);
  },
  setDomainCatalog(rows: CatalogRow[]) {
    useInspectorStore.getState().setDomainCatalog(rows);
  },
};
