import type { DomainOutcome, HostCallKey, HostCallRecord, HostCallStore } from "./domain.js";

/** Adapt pg.Pool, PGlite, or a serverless driver without coupling the host to a driver. */
export type HostPgQuery = (
  sql: string,
  params: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

export interface PgHostCallStoreOptions {
  query: HostPgQuery;
  /** Lowercase SQL identifier, optionally schema-qualified. Default: dpas_host_calls. */
  table?: string;
}

/** Apply through application migrations. Retain receipts for the whole recoverable run lifetime. */
export const HOST_CALLS_DDL = `
CREATE TABLE IF NOT EXISTS dpas_host_calls (
  session_id text NOT NULL,
  run_id text NOT NULL,
  tool_call_id text NOT NULL,
  invocation_id text NOT NULL,
  capability_id text NOT NULL,
  input_fingerprint text NOT NULL,
  contract_digest text,
  revision integer NOT NULL CHECK (revision >= 0),
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, run_id, tool_call_id),
  UNIQUE (session_id, invocation_id)
);
`;

/**
 * Shared receipt store for replacement/concurrent hosts. Identity is immutable;
 * writes require compare-and-set. This stores tool-call receipts, not a Mastra
 * workflow checkpoint or a distributed run lease. No pending record is expired
 * automatically, because expiration must never authorize repeating an effect.
 */
export function createPgHostCallStore<Outcome extends DomainOutcome = DomainOutcome>(
  options: PgHostCallStoreOptions,
): HostCallStore<Outcome> {
  if (typeof options?.query !== "function") throw new TypeError("query is required.");
  const table = options.table ?? "dpas_host_calls";
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(table)) {
    throw new TypeError("table must be a lowercase SQL identifier, optionally schema-qualified.");
  }
  const { query } = options;

  async function get(key: HostCallKey): Promise<HostCallRecord<Outcome> | null> {
    const params = keyParams(key);
    const result = await query(
      `SELECT * FROM ${table} WHERE session_id=$1 AND run_id=$2 AND tool_call_id=$3`,
      params,
    );
    return result.rows[0] ? fromRow<Outcome>(result.rows[0]) : null;
  }

  return {
    get,
    async reserve(proposed) {
      assertRecord(proposed);
      if (proposed.revision !== 0 || proposed.outcome !== undefined) {
        throw new TypeError("A new host call must have revision 0 and no outcome.");
      }
      const result = await query(
        `INSERT INTO ${table}
          (session_id, run_id, tool_call_id, invocation_id, capability_id,
           input_fingerprint, contract_digest, revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0)
         ON CONFLICT (session_id, run_id, tool_call_id) DO NOTHING RETURNING *`,
        [
          ...keyParams(proposed),
          proposed.invocationId,
          proposed.capabilityId,
          proposed.inputFingerprint,
          proposed.contractDigest ?? null,
        ],
      );
      if (result.rows[0]) return { record: fromRow<Outcome>(result.rows[0]), created: true };
      // A separate statement observes the winner after INSERT waited for its
      // commit. INSERT + SELECT in one CTE can miss it under READ COMMITTED.
      const existing = await get(proposed);
      if (!existing) throw new Error("The host call disappeared during reservation.");
      return { record: existing, created: false };
    },
    async compareAndSet(record, expectedRevision) {
      assertRecord(record);
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        record.revision !== expectedRevision + 1
      ) {
        throw new TypeError("A host update must advance exactly one revision.");
      }
      const result = await query(
        `UPDATE ${table} SET revision=$8, outcome=$9::jsonb, updated_at=now()
         WHERE session_id=$1 AND run_id=$2 AND tool_call_id=$3
           AND invocation_id=$4 AND capability_id=$5 AND input_fingerprint=$6
           AND contract_digest IS NOT DISTINCT FROM $7 AND revision=$10
         RETURNING revision`,
        [
          ...keyParams(record),
          record.invocationId,
          record.capabilityId,
          record.inputFingerprint,
          record.contractDigest ?? null,
          record.revision,
          record.outcome === undefined ? null : JSON.stringify(encodeValue(record.outcome)),
          expectedRevision,
        ],
      );
      return result.rows.length === 1;
    },
  };
}

function keyParams(key: HostCallKey): string[] {
  const values = [key.sessionId, key.runId, key.toolCallId];
  if (!values.every((value) => typeof value === "string" && value.length > 0)) {
    throw new TypeError("Host call identifiers must be nonempty strings.");
  }
  return values;
}

function assertRecord(record: HostCallRecord) {
  keyParams(record);
  if (
    ![record.invocationId, record.capabilityId, record.inputFingerprint].every(
      (value) => typeof value === "string" && value.length > 0,
    ) ||
    (record.contractDigest !== undefined && typeof record.contractDigest !== "string") ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    record.revision >= 2_147_483_647
  ) {
    throw new TypeError("Invalid host call record.");
  }
}

function fromRow<Outcome extends DomainOutcome>(
  row: Record<string, unknown>,
): HostCallRecord<Outcome> {
  const record: HostCallRecord<Outcome> = {
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    toolCallId: row.tool_call_id as string,
    invocationId: row.invocation_id as string,
    capabilityId: row.capability_id as string,
    inputFingerprint: row.input_fingerprint as string,
    revision: row.revision as number,
    ...(row.contract_digest === null ? {} : { contractDigest: row.contract_digest as string }),
  };
  assertRecord(record);
  if (row.outcome !== null && row.outcome !== undefined) {
    const encoded = typeof row.outcome === "string" ? JSON.parse(row.outcome) : row.outcome;
    const decoded = decodeValue(encoded) as Outcome;
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !["completed", "approval-required", "failed", "cancelled", "outcome-unknown"].includes(
        decoded.status,
      )
    ) {
      throw new TypeError("Invalid stored host outcome.");
    }
    record.outcome = decoded;
  }
  return record;
}

// Tagged tuples avoid collisions with application objects and preserve oRPC
// Date/BigInt/undefined results. Never serialize errors, classes, or cycles by
// accidentally invoking toJSON; remote failures must already be safe envelopes.
function encodeValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string" || typeof value === "boolean") return [typeof value, value];
  if (typeof value === "number" && Number.isFinite(value)) {
    return ["number", Object.is(value, -0) ? "-0" : value];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (typeof value !== "object" || value === null || seen.has(value)) {
    throw new TypeError("Unsupported or cyclic host outcome.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value))
      return ["array", Array.from(value, (item) => encodeValue(item, seen))];
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError("Unsupported host outcome object.");
    }
    return ["object", Object.entries(value).map(([key, item]) => [key, encodeValue(item, seen)])];
  } finally {
    seen.delete(value);
  }
}

function decodeValue(encoded: unknown): unknown {
  if (!Array.isArray(encoded)) throw new TypeError("Invalid stored host value.");
  const [tag, value] = encoded;
  switch (tag) {
    case "undefined":
      if (encoded.length === 1) return undefined;
      break;
    case "null":
      if (encoded.length === 1) return null;
      break;
    case "string":
      if (typeof value === "string") return value;
      break;
    case "boolean":
      if (typeof value === "boolean") return value;
      break;
    case "number":
      if (value === "-0") return -0;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      break;
    case "bigint":
      if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
      break;
    case "date": {
      if (typeof value !== "string") break;
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date;
      break;
    }
    case "array":
      if (Array.isArray(value)) return value.map(decodeValue);
      break;
    case "object":
      if (
        Array.isArray(value) &&
        value.every(
          (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string",
        )
      ) {
        return Object.fromEntries(value.map(([key, item]) => [key, decodeValue(item)]));
      }
      break;
  }
  throw new TypeError("Invalid stored host value.");
}
