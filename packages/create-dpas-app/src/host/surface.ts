import { inputFingerprint } from "./domain.js";

export interface SurfaceIdentity {
  appId: string;
  buildId: string;
  sessionId: string;
  tabId: string;
}
export interface SurfaceCall {
  protocolVersion: 1;
  type: "surface-call";
  identity: SurfaceIdentity;
  connectionId: string;
  runId: string;
  toolCallId: string;
  invocation: {
    invocationId: string;
    capabilityId: string;
    registrationId: string;
    surfaceVersion: string;
  };
}
export interface SurfaceResult {
  protocolVersion: 1;
  type: "surface-result";
  identity: SurfaceIdentity;
  connectionId: string;
  runId: string;
  toolCallId: string;
  invocationId: string;
  result: unknown;
}
export interface SurfaceCallRecord {
  call: SurfaceCall;
  result?: SurfaceResult;
}
export interface SurfaceCallStore {
  /** Atomic insert-if-absent; return the existing record on a duplicate key. */
  reserve(key: string, call: SurfaceCall): Promise<SurfaceCallRecord>;
  get(key: string): Promise<SurfaceCallRecord | null>;
  /** Atomic first-result-wins; return existing result when already settled. */
  settle(key: string, result: SurfaceResult): Promise<SurfaceResult>;
}

/** Local tests only. Pending calls need application persistence across host replacement. */
export function createMemorySurfaceCallStore(): SurfaceCallStore {
  const records = new Map<string, SurfaceCallRecord>();
  return {
    async reserve(key, call) {
      if (!records.has(key)) records.set(key, { call: structuredClone(call) });
      return structuredClone(records.get(key)!);
    },
    async get(key) {
      return structuredClone(records.get(key) ?? null);
    },
    async settle(key, result) {
      const record = records.get(key);
      if (!record) throw new Error("Unknown browser tool call.");
      record.result ??= structuredClone(result);
      return structuredClone(record.result);
    },
  };
}

/**
 * Host half of @agent-surface/core/host. Authentication and compiled-contract
 * verification are REQUIRED application callbacks. Reconnect never retargets
 * a pending call to another tab or registration. Browser data stays untrusted.
 */
export function createSurfaceHost(options: {
  store: SurfaceCallStore;
  /** Check session/connection ownership and known build artifact on both phases.
   * Check current registration/availability only at dispatch; successful navigation
   * may change or remove the surface before its original result arrives. */
  authorizeCall: (
    call: SurfaceCall,
    authenticatedSessionId: string,
    phase: "dispatch" | "result",
  ) => void | Promise<void>;
}) {
  const keyOf = (call: Pick<SurfaceCall, "identity" | "runId" | "toolCallId">) =>
    JSON.stringify([call.identity.sessionId, call.runId, call.toolCallId]);
  return {
    async dispatch<Call extends SurfaceCall>(
      call: Call,
      authenticatedSessionId: string,
    ): Promise<Call> {
      validateIdentity(call.identity, authenticatedSessionId);
      if (
        call.protocolVersion !== 1 ||
        call.type !== "surface-call" ||
        !call.connectionId ||
        !call.runId ||
        !call.toolCallId ||
        !call.invocation?.invocationId ||
        !call.invocation.capabilityId ||
        !call.invocation.registrationId ||
        !call.invocation.surfaceVersion
      ) {
        throw new TypeError("Malformed browser call.");
      }
      await options.authorizeCall(call, authenticatedSessionId, "dispatch");
      const record = await options.store.reserve(keyOf(call), call);
      if (inputFingerprint(record.call) !== inputFingerprint(call))
        throw new Error(
          "Browser call identity conflict; pending calls cannot move between connections.",
        );
      return call;
    },
    async acceptResult<Result extends SurfaceResult>(
      result: Result,
      authenticatedSessionId: string,
    ) {
      validateIdentity(result.identity, authenticatedSessionId);
      if (result.protocolVersion !== 1 || result.type !== "surface-result")
        throw new TypeError("Malformed browser result.");
      const key = keyOf(result);
      const record = await options.store.get(key);
      if (!record) throw new Error("Unknown browser tool call.");
      const call = record.call;
      if (
        inputFingerprint(call.identity) !== inputFingerprint(result.identity) ||
        call.connectionId !== result.connectionId ||
        call.invocation.invocationId !== result.invocationId
      ) {
        throw new Error("Browser result does not match the outstanding call.");
      }
      await options.authorizeCall(call, authenticatedSessionId, "result");
      const settled = await options.store.settle(key, result);
      if (inputFingerprint(settled) !== inputFingerprint(result))
        throw new Error("Conflicting browser tool result.");
      return settled;
    },
  };
}

function validateIdentity(identity: SurfaceIdentity, authenticatedSessionId: string) {
  if (
    !identity ||
    identity.sessionId !== authenticatedSessionId ||
    ![identity.appId, identity.buildId, identity.sessionId, identity.tabId].every(
      (value) => typeof value === "string" && value,
    )
  ) {
    throw new TypeError("Surface identity does not match the authenticated session.");
  }
}
