/**
 * Application audit log. Two producers write here — the oRPC procedures
 * (authoritative domain audit) and the orpc-agent runtime sink (governance
 * events) — and the chat route subscribes for the duration of a turn to
 * forward events to the browser's Agent Inspector as protocol frames.
 *
 * Two properties this file is responsible for:
 *
 *   1. **Attribution.** Every entry carries the actor it belongs to. Readers
 *      filter by actor; an entry that cannot be attributed is never broadcast.
 *      A shared process-wide log with no filter would show every user's
 *      activity to every other user.
 *   2. **Boundedness.** A slow reader must not grow the process's memory or
 *      apply backpressure to the code being audited. Subscribers get a bounded
 *      queue and drops are counted, never silent.
 *
 * The durable destination is pluggable. The ring buffer is the zero-config
 * default (ADR-0004); `./postgres` writes through to a real table.
 */

export interface AuditEntry {
  id: string;
  at: string;
  source: "domain" | "orpc-agent" | "host";
  type: string;
  actorId?: string;
  capabilityId?: string;
  correlationId?: string;
  /** Host-sourced entries carry the protocol step they belong to. */
  stepId?: string;
  data?: Record<string, unknown>;
}

/**
 * Where entries are durably written. `recent` is a bounded diagnostics tail
 * for the Inspector, never the authoritative record — read the backing store
 * for that.
 */
export interface AuditBackend {
  append(entry: AuditEntry): void;
  recent(): AuditEntry[];
  flush?(): Promise<void>;
}

export interface AuditSubscription {
  /** Entries dropped because this subscriber's queue was full. */
  dropped(): number;
  close(): void;
}

export interface AuditReadOptions {
  /**
   * Return only entries attributed to this actor. Entries with no `actorId`
   * are excluded — an entry that cannot be attributed is not disclosed.
   */
  actorId?: string;
}

export interface AuditLog {
  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry;
  entries(options?: AuditReadOptions): AuditEntry[];
  subscribe(
    listener: (entry: AuditEntry) => void,
    options?: { maxQueue?: number },
  ): AuditSubscription;
}

const MAX_ENTRIES = 500;
/** Deep enough for a busy turn, shallow enough that a dead reader cannot grow. */
const DEFAULT_MAX_QUEUE = 256;

/** In-memory ring buffer: the zero-config default, and the dev/test backend. */
export function createRingBufferBackend(max: number = MAX_ENTRIES): AuditBackend {
  const entries: AuditEntry[] = [];
  return {
    append(entry) {
      entries.push(entry);
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    recent() {
      return [...entries];
    },
  };
}

export function createAuditLog(backend: AuditBackend = createRingBufferBackend()): AuditLog {
  const subscribers = new Set<(entry: AuditEntry) => void>();
  let counter = 0;

  return {
    record(partial) {
      const entry: AuditEntry = {
        id: `aud_${++counter}`,
        at: new Date().toISOString(),
        ...partial,
      };
      backend.append(entry);
      for (const push of subscribers) {
        try {
          push(entry);
        } catch {
          // Subscribers are diagnostics; never let one break the audited path.
        }
      }
      return entry;
    },

    entries(options) {
      const all = backend.recent();
      if (!options?.actorId) return all;
      return all.filter((entry) => entry.actorId === options.actorId);
    },

    subscribe(listener, options) {
      const maxQueue = options?.maxQueue ?? DEFAULT_MAX_QUEUE;
      const queue: AuditEntry[] = [];
      let dropped = 0;
      let draining = false;
      let closed = false;

      // Delivery is deferred so `record()` never waits on a reader, and the
      // queue is capped so a reader that stops consuming cannot grow it.
      const drain = () => {
        draining = false;
        while (queue.length > 0 && !closed) {
          const entry = queue.shift() as AuditEntry;
          try {
            listener(entry);
          } catch {
            // As above: diagnostics never break execution.
          }
        }
      };

      const push = (entry: AuditEntry) => {
        if (closed) return;
        if (queue.length >= maxQueue) {
          dropped += 1;
          return;
        }
        queue.push(entry);
        if (!draining) {
          draining = true;
          queueMicrotask(drain);
        }
      };

      subscribers.add(push);
      return {
        dropped: () => dropped,
        close() {
          // Detach first, then deliver what is already queued. Delivery is
          // deferred to a microtask, so closing without this final drain would
          // discard every entry recorded since the last tick — reliably losing
          // the tail of each step rather than an occasional event.
          subscribers.delete(push);
          drain();
          closed = true;
          queue.length = 0;
        },
      };
    },
  };
}

const logKey = "__dpasAuditLog" as const;
const backendKey = "__dpasAuditBackend" as const;

/**
 * Install a durable backend. Call once during server bootstrap, BEFORE the
 * first `getAuditLog()` — see `./postgres`. Without it the ring buffer is
 * used, which is right for the scaffold and wrong for production.
 */
export function setAuditBackend(backend: AuditBackend): void {
  const g = globalThis as Record<string, unknown>;
  g[backendKey] = backend;
  delete g[logKey];
}

export function getAuditLog(): AuditLog {
  const g = globalThis as Record<string, unknown>;
  if (!g[logKey]) {
    g[logKey] = createAuditLog((g[backendKey] as AuditBackend | undefined) ?? undefined);
  }
  return g[logKey] as AuditLog;
}
