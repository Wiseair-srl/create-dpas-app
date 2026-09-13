import { createHash, randomUUID } from "node:crypto";

/** Public, structural subset of @orpc-agent/core/client. No backend router import. */
export interface DomainOutcome {
  status: "completed" | "approval-required" | "failed" | "cancelled" | "outcome-unknown";
  executionId?: string;
  invocationId?: string;
  approval?: { id: string };
  output?: unknown;
  error?: unknown;
}

export interface RemoteDomainClient<Outcome extends DomainOutcome = DomainOutcome> {
  invoke(
    capabilityId: string,
    input: unknown,
    options: {
      invocationId: string;
      correlationId?: string;
      contractDigest?: string;
      signal?: AbortSignal;
    },
  ): Promise<Outcome>;
  getInvocation(invocationId: string): Promise<{ outcome?: Outcome } | null>;
  resumeApproval(
    approvalId: string,
    options: {
      invocationId: string;
      correlationId?: string;
      signal?: AbortSignal;
    },
  ): Promise<Outcome>;
}

/** Keys come from authenticated server state and persisted model tool calls. */
export interface HostCallKey {
  sessionId: string;
  runId: string;
  toolCallId: string;
}

export interface HostCallRecord<Outcome extends DomainOutcome = DomainOutcome> extends HostCallKey {
  invocationId: string;
  capabilityId: string;
  inputFingerprint: string;
  contractDigest?: string;
  revision: number;
  outcome?: Outcome;
}

/**
 * Application persistence seam. reserve must atomically insert-if-absent;
 * compareAndSet must atomically update only the expected revision. Keep records
 * at least as long as recoverable runs. Never expire a pending effect and replay it.
 */
export interface HostCallStore<Outcome extends DomainOutcome = DomainOutcome> {
  reserve(
    proposed: HostCallRecord<Outcome>,
  ): Promise<{ record: HostCallRecord<Outcome>; created: boolean }>;
  get(key: HostCallKey): Promise<HostCallRecord<Outcome> | null>;
  compareAndSet(record: HostCallRecord<Outcome>, expectedRevision: number): Promise<boolean>;
}

export class HostCallConflictError extends Error {
  readonly code = "HOST_CALL_CONFLICT";
  constructor() {
    super("The persisted tool call has different arguments or capability metadata.");
  }
}

/** For tests/local examples only; use a transactional shared store across tasks. */
export function createMemoryHostCallStore<
  Outcome extends DomainOutcome = DomainOutcome,
>(): HostCallStore<Outcome> {
  const records = new Map<string, HostCallRecord<Outcome>>();
  const keyOf = (key: HostCallKey) => JSON.stringify([key.sessionId, key.runId, key.toolCallId]);
  return {
    async reserve(proposed) {
      const key = keyOf(proposed);
      const existing = records.get(key);
      if (existing) return { record: structuredClone(existing), created: false };
      records.set(key, structuredClone(proposed));
      return { record: structuredClone(proposed), created: true };
    },
    async get(key) {
      return structuredClone(records.get(keyOf(key)) ?? null);
    },
    async compareAndSet(record, expectedRevision) {
      const key = keyOf(record);
      if (records.get(key)?.revision !== expectedRevision) return false;
      records.set(key, structuredClone(record));
      return true;
    },
  };
}

export interface InvokeHostDomain extends HostCallKey {
  capabilityId: string;
  input: unknown;
  contractDigest?: string;
  signal?: AbortSignal;
}

/**
 * Reserves identity BEFORE dispatch. A replay only queries the backend journal;
 * a lost response never causes an automatic repeat of a potentially completed effect.
 * Construct per authenticated request with a freshly authorized remote client.
 */
export function createDomainHost<Outcome extends DomainOutcome>(options: {
  client: RemoteDomainClient<Outcome>;
  store: HostCallStore<Outcome>;
  newInvocationId?: () => string;
}) {
  const { client, store } = options;
  const unknown = (invocationId: string) => ({ status: "outcome-unknown" as const, invocationId });

  async function save(record: HostCallRecord<Outcome>, outcome: Outcome) {
    const updated = { ...record, revision: record.revision + 1, outcome };
    if (await store.compareAndSet(updated, record.revision)) return outcome;
    const current = await store.get(record);
    return current?.outcome ?? unknown(record.invocationId);
  }

  async function reconcileRecord(record: HostCallRecord<Outcome>) {
    try {
      const receipt = await client.getInvocation(record.invocationId);
      if (receipt?.outcome) return save(record, receipt.outcome);
    } catch {
      /* Authorization/network failures do not prove the effect failed. */
    }
    return unknown(record.invocationId);
  }

  return {
    async invoke(call: InvokeHostDomain) {
      assertKey(call);
      const fingerprint = inputFingerprint(call.input);
      const { record, created } = await store.reserve({
        sessionId: call.sessionId,
        runId: call.runId,
        toolCallId: call.toolCallId,
        invocationId: (options.newInvocationId ?? randomUUID)(),
        capabilityId: call.capabilityId,
        inputFingerprint: fingerprint,
        ...(call.contractDigest ? { contractDigest: call.contractDigest } : {}),
        revision: 0,
      });
      if (
        record.capabilityId !== call.capabilityId ||
        record.inputFingerprint !== fingerprint ||
        record.contractDigest !== call.contractDigest
      )
        throw new HostCallConflictError();
      // Every replay reauthorizes at the backend; cached outputs are not an auth cache.
      if (!created) return reconcileRecord(record);
      try {
        const outcome = await client.invoke(call.capabilityId, call.input, {
          invocationId: record.invocationId,
          correlationId: call.runId,
          ...(call.contractDigest ? { contractDigest: call.contractDigest } : {}),
          ...(call.signal ? { signal: call.signal } : {}),
        });
        return await save(record, outcome);
      } catch {
        return unknown(record.invocationId);
      }
    },
    async reconcile(key: HostCallKey) {
      assertKey(key);
      const record = await store.get(key);
      return record ? reconcileRecord(record) : null;
    },
    async resumeApproval(key: HostCallKey, signal?: AbortSignal) {
      assertKey(key);
      const record = await store.get(key);
      if (!record) return null;
      const current = await reconcileRecord(record);
      if (current.status !== "approval-required" || !current.approval) return current;
      // The original invocation identity binds approval continuation to this call.
      // Backend atomic approval consumption and invocation journal own deduplication.
      const latest = await store.get(key);
      if (!latest) return unknown(record.invocationId);
      try {
        return await save(
          latest,
          await client.resumeApproval(current.approval.id, {
            invocationId: record.invocationId,
            correlationId: key.runId,
            ...(signal ? { signal } : {}),
          }),
        );
      } catch {
        return unknown(record.invocationId);
      }
    },
  };
}

function assertKey(key: HostCallKey) {
  if (
    ![key.sessionId, key.runId, key.toolCallId].every(
      (part) => typeof part === "string" && part.length > 0,
    )
  ) {
    throw new TypeError("sessionId, runId and toolCallId must be nonempty trusted identifiers.");
  }
}

/** Canonical JSON + Date/BigInt fingerprints; unsupported object types fail closed. */
export function inputFingerprint(input: unknown): string {
  const seen = new Set<object>();
  function encode(value: unknown): unknown {
    if (value === undefined) return ["undefined"];
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return [typeof value, value];
    if (typeof value === "number" && Number.isFinite(value))
      return ["number", Object.is(value, -0) ? "-0" : value];
    if (typeof value === "bigint") return ["bigint", String(value)];
    if (value instanceof Date) return ["date", value.toISOString()];
    if (typeof value !== "object" || value === null || seen.has(value))
      throw new TypeError("Unsupported or cyclic tool input.");
    seen.add(value);
    try {
      if (Array.isArray(value)) return ["array", value.map(encode)];
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new TypeError("Unsupported tool input object.");
      return [
        "object",
        Object.keys(value)
          .sort()
          .map((key) => [key, encode((value as Record<string, unknown>)[key])]),
      ];
    } finally {
      seen.delete(value);
    }
  }
  return createHash("sha256")
    .update(JSON.stringify(encode(input)))
    .digest("hex");
}
