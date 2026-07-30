import { resolveSession, type Session } from "@/server/auth/session";
import { getDeviceStore, type DeviceStore } from "@/server/db/store";
import { getAuditLog, type AuditLog } from "@/server/audit/log";

/**
 * Per-request oRPC context. `session` is server-derived (signed cookie);
 * `agentCall` carries UNTRUSTED correlation metadata forwarded by the
 * browser half of the Agent Host (invocation and confirmation ids). It is
 * recorded for audit only and must never influence authorization.
 */
export interface AgentCallMeta {
  invocationId?: string;
  confirmationId?: string;
}

export interface AppContext {
  session: Session | null;
  devices: DeviceStore;
  audit: AuditLog;
  agentCall?: AgentCallMeta;
}

export const AGENT_INVOCATION_HEADER = "x-dpas-invocation-id";
export const AGENT_CONFIRMATION_HEADER = "x-dpas-confirmation-id";

export function createContextFromRequest(request: Request): AppContext {
  const headers = request.headers;
  const invocationId = headers.get(AGENT_INVOCATION_HEADER) ?? undefined;
  const confirmationId = headers.get(AGENT_CONFIRMATION_HEADER) ?? undefined;
  return {
    session: resolveSession(headers.get("cookie")),
    devices: getDeviceStore(),
    audit: getAuditLog(),
    ...(invocationId || confirmationId
      ? { agentCall: { ...(invocationId ? { invocationId } : {}), ...(confirmationId ? { confirmationId } : {}) } }
      : {}),
  };
}

/** Context for server-internal execution under an already-resolved session. */
export function createContextForSession(session: Session | null): AppContext {
  return {
    session,
    devices: getDeviceStore(),
    audit: getAuditLog(),
  };
}
