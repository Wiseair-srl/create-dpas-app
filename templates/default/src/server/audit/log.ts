/**
 * Application audit log: a bounded in-memory ring buffer with subscriptions.
 * Two producers write here — the oRPC procedures (authoritative domain audit)
 * and the orpc-agent runtime sink (governance events). The chat route
 * subscribes for the duration of a turn to forward events to the browser's
 * Agent Inspector as protocol frames.
 */

export interface AuditEntry {
  id: string;
  at: string;
  source: "domain" | "orpc-agent" | "host";
  type: string;
  actorId?: string;
  capabilityId?: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

export interface AuditLog {
  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry;
  entries(): AuditEntry[];
  subscribe(listener: (entry: AuditEntry) => void): () => void;
}

const MAX_ENTRIES = 500;

function createAuditLog(): AuditLog {
  const entries: AuditEntry[] = [];
  const listeners = new Set<(entry: AuditEntry) => void>();
  let counter = 0;

  return {
    record(partial) {
      const entry: AuditEntry = {
        id: `aud_${++counter}`,
        at: new Date().toISOString(),
        ...partial,
      };
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      for (const listener of listeners) {
        try {
          listener(entry);
        } catch {
          // Listeners are diagnostics; never let them break execution.
        }
      }
      return entry;
    },
    entries() {
      return [...entries];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const globalKey = "__dpasAuditLog" as const;
export function getAuditLog(): AuditLog {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = createAuditLog();
  return g[globalKey] as AuditLog;
}
