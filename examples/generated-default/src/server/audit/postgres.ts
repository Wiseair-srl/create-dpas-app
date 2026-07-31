import type { PgQuery } from "@orpc-agent/postgres";
import { setAuditBackend, type AuditBackend, type AuditEntry } from "./log";

/**
 * Durable backend for the APPLICATION audit log (`AuditEntry`) — the record
 * that spans all three producers: domain procedures, the orpc-agent runtime
 * sink, and the host.
 *
 * This is deliberately separate from `@orpc-agent/postgres`'s
 * `createPgAuditSink`, which persists the library's own `AgentAuditEvent` to
 * its canonical ADR-013 table. The two are not interchangeable: domain and
 * host entries never pass through the runtime, so the library sink would miss
 * them. Register both — see `src/server/agent/runtime.ts`.
 *
 * The driver seam is the library's: a function taking SQL and positional
 * params. `pg.Pool`, pglite and serverless drivers all adapt in one line, so
 * the template takes on no database dependency of its own:
 *
 * ```ts
 * import { Pool } from "pg";
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * setAuditBackend(createPostgresAuditBackend({ query: (sql, params) => pool.query(sql, params) }));
 * ```
 */

export interface PostgresAuditBackendOptions {
  query: PgQuery;
  /** Default "dpas_audit_entries". Must be a plain lowercase identifier. */
  table?: string;
  /** Size of the in-memory tail kept for the Inspector. Default 200. */
  recentLimit?: number;
  /** Called when a write fails. Default logs to stderr. */
  onError?: (error: unknown, entry: AuditEntry) => void;
}

const DEFAULT_TABLE = "dpas_audit_entries";
const DEFAULT_RECENT_LIMIT = 200;

/** Canonical DDL for the default table name; adapt the name if you override it. */
export const APP_AUDIT_DDL = `create table if not exists ${DEFAULT_TABLE} (
  id             bigint generated always as identity primary key,
  entry_id       text not null,
  at             timestamptz not null,
  source         text not null,
  type           text not null,
  actor_id       text,
  capability_id  text,
  correlation_id text,
  step_id        text,
  data           jsonb not null
);
create index if not exists ${DEFAULT_TABLE}_actor_at_idx on ${DEFAULT_TABLE} (actor_id, at);
create index if not exists ${DEFAULT_TABLE}_type_at_idx on ${DEFAULT_TABLE} (type, at);
`;

function assertTableName(table: string): string {
  // Table names cannot be bound parameters, so they are interpolated — and
  // therefore validated as strict identifiers rather than trusted.
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new TypeError(
      `Invalid audit table name "${table}" — expected a lowercase identifier ([a-z_][a-z0-9_]*)`,
    );
  }
  return table;
}

export function createPostgresAuditBackend(
  options: PostgresAuditBackendOptions,
): AuditBackend {
  if (typeof options?.query !== "function") {
    throw new TypeError("createPostgresAuditBackend: options.query is required");
  }
  const table = assertTableName(options.table ?? DEFAULT_TABLE);
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const onError =
    options.onError ??
    ((error: unknown, entry: AuditEntry) => {
      console.error(`[audit] failed to persist ${entry.type} (${entry.id})`, error);
    });

  const sql =
    `insert into ${table} ` +
    "(entry_id, at, source, type, actor_id, capability_id, correlation_id, step_id, data) " +
    "values ($1, $2, $3, $4, $5, $6, $7, $8, $9)";

  // A bounded tail so the Inspector keeps working without a round trip. The
  // durable record is the table; this is a diagnostics cache.
  const recent: AuditEntry[] = [];
  // Writes are serialised so rows land in the order they were recorded.
  let pending: Promise<void> = Promise.resolve();

  return {
    append(entry) {
      recent.push(entry);
      if (recent.length > recentLimit) recent.splice(0, recent.length - recentLimit);

      pending = pending.then(async () => {
        try {
          await options.query(sql, [
            entry.id,
            entry.at,
            entry.source,
            entry.type,
            entry.actorId ?? null,
            entry.capabilityId ?? null,
            entry.correlationId ?? null,
            entry.stepId ?? null,
            JSON.stringify(entry.data ?? {}),
          ]);
        } catch (error) {
          onError(error, entry);
        }
      });
    },

    recent() {
      return [...recent];
    },

    async flush() {
      await pending;
    },
  };
}

// ---------------------------------------------------------------------------

const queryKey = "__dpasGovernanceAuditQuery" as const;

/**
 * Turn on durable audit for BOTH records, from one call. Run once during
 * server bootstrap, before the first `getAuditLog()` or `getAgentRuntime()`:
 *
 * ```ts
 * // instrumentation.ts
 * import { Pool } from "pg";
 * import { configureDurableAudit } from "@/server/audit/postgres";
 *
 * export async function register() {
 *   if (!process.env.DATABASE_URL) return;      // scaffold default: ring buffer
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   configureDurableAudit((sql, params) => pool.query(sql, params));
 * }
 * ```
 *
 * Create the tables first: `APP_AUDIT_DDL` here, and `AUDIT_DDL` from
 * `@orpc-agent/postgres` for the governance table.
 */
export function configureDurableAudit(query: PgQuery, options?: { table?: string }): void {
  setAuditBackend(
    createPostgresAuditBackend({ query, ...(options?.table ? { table: options.table } : {}) }),
  );
  (globalThis as Record<string, unknown>)[queryKey] = query;
}

/** The governance-sink half of the above, read by `src/server/agent/runtime.ts`. */
export function getGovernanceAuditQuery(): PgQuery | undefined {
  return (globalThis as Record<string, unknown>)[queryKey] as PgQuery | undefined;
}
