import type { AgentAuditEvent } from "@orpc-agent/core";

/**
 * An in-process fan-out over the governed pipeline's audit stream, so a live
 * chat step can show the user what the server actually did on their behalf.
 *
 * This is a best-effort TAP, not the record. It is bounded per subscriber,
 * lossy under back-pressure, and it reports what it lost rather than silently
 * dropping it. A real deployment adds a durable sink beside it
 * (`createPgAuditSink` from @orpc-agent/postgres) — that one is the record.
 *
 * Attribution matters here. The log is process-wide and concurrent users write
 * to it simultaneously, so a step discloses an entry only when it is
 * positively attributable to that session's actor. An entry carrying no actor
 * is dropped rather than broadcast: the cost is that a genuinely actor-less
 * runtime event misses the Inspector, which is the right trade against showing
 * one tenant another's activity.
 */

export interface AuditEntry {
  id: string;
  at: string;
  source: "domain" | "orpc-agent" | "host";
  type: string;
  /** Actor id — the ONLY basis on which an entry may be disclosed to a tab. */
  actorId?: string;
  capabilityId?: string;
  correlationId?: string;
  executionId?: string;
  /** Set on host-sourced entries so a step can recognise its own. */
  stepId?: string;
  data?: unknown;
}

export interface AuditSubscription {
  /** Entries this subscriber missed because it fell behind. */
  dropped: () => number;
  close: () => void;
}

/** Per-subscriber queue depth. Beyond this, entries are counted, not kept. */
const MAX_PENDING = 200;

interface Subscriber {
  deliver: (entry: AuditEntry) => void;
  dropped: number;
  pending: number;
}

let counter = 0;
const subscribers = new Set<Subscriber>();

function emit(entry: AuditEntry): void {
  for (const subscriber of subscribers) {
    if (subscriber.pending >= MAX_PENDING) {
      subscriber.dropped += 1;
      continue;
    }
    subscriber.pending += 1;
    try {
      subscriber.deliver(entry);
    } catch {
      // A diagnostics consumer must never disturb the pipeline.
    } finally {
      subscriber.pending -= 1;
    }
  }
}

export interface AuditLog {
  record: (entry: Omit<AuditEntry, "id" | "at"> & { at?: string }) => void;
  subscribe: (listener: (entry: AuditEntry) => void) => AuditSubscription;
  /** Bridge for the orpc-agent runtime's own audit sink. */
  sink: (event: AgentAuditEvent) => void;
}

const log: AuditLog = {
  record(entry) {
    emit({ id: `aud_${++counter}`, at: entry.at ?? new Date().toISOString(), ...entry });
  },

  subscribe(listener) {
    const subscriber: Subscriber = { deliver: listener, dropped: 0, pending: 0 };
    subscribers.add(subscriber);
    return {
      dropped: () => subscriber.dropped,
      close: () => {
        subscribers.delete(subscriber);
      },
    };
  },

  sink(event) {
    emit({
      id: `aud_${++counter}`,
      at: event.timestamp.toISOString(),
      source: "orpc-agent",
      type: event.type,
      ...(event.actor?.id ? { actorId: event.actor.id } : {}),
      ...(event.capabilityId ? { capabilityId: event.capabilityId } : {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.executionId ? { executionId: event.executionId } : {}),
      data: (event as { data?: unknown }).data,
    });
  },
};

export function getAuditLog(): AuditLog {
  return log;
}
