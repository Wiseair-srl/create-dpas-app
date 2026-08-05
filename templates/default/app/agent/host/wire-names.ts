import { encodeWireName } from "@agent-surface/core";

/**
 * Canonical id → provider-safe wire name for BOTH planes, on one convention
 * (":" → "_", "." → "__"):
 *
 *   view:invoices.pending.setFilters  →  view_invoices__pending__setFilters
 *   domain:list-invoices              →  domain_list-invoices
 *
 * Encoding is deliberately NOT reversible by string surgery. A canonical id
 * whose encoding would exceed 64 characters is shortened and hashed, and
 * `decodeWireName` refuses those rather than returning a plausible wrong id
 * (agent-surface D30). Multi-instance surface tools also carry an
 * `_at_<instance>` suffix that decodes to nothing on its own.
 *
 * Reversal is therefore always a MAP LOOKUP:
 *
 *   - browser — `toolset.wireNameMap()`, authoritative for the catalog it just
 *     built;
 *   - server — the domain map captured while naming the tools, plus the
 *     frontend ids the wire descriptors already carry.
 *
 * The canonical id is the audit identity, so a name that cannot be mapped
 * means the capability is withheld from the model rather than offered under a
 * guessed identity.
 */

export function domainToolName(capabilityId: string): string {
  return encodeWireName(`domain:${capabilityId}`);
}

/**
 * Canonical id → the key a chat renderer is registered under
 * (`app/chat-renderers.tsx`). The pill shows the canonical id whole, because
 * which plane a call ran on is worth seeing; the renderers are keyed by BARE
 * capability id — the registry key, which is also the only plane that has any,
 * and the id the approval receipt carries.
 *
 * The two must agree or the native card never draws and nothing errs, so
 * chat-renderers.test.ts pins the round trip.
 */
export function rendererKey(canonicalId: string): string {
  return canonicalId.startsWith("domain:") ? canonicalId.slice("domain:".length) : canonicalId;
}

/** The three generic tools meta mode projects instead of one per capability. */
export const META_TOOL_NAMES = new Set(["surface_discover", "surface_read", "surface_act"]);

export function isMetaToolName(wireName: string): boolean {
  return META_TOOL_NAMES.has(wireName);
}

/**
 * The canonical id a tool CALL acts on — the audit identity (invariant 8).
 *
 * In direct mode the wire name IS the capability, so the catalog's map answers
 * and `mapped` is passed straight through. In meta mode the model calls one of
 * three generic tools and names its target in `capabilityId`: the tool is
 * `surface_act`, but the operation being audited is whatever it was pointed
 * at. Recording `surface_act` would collapse every action in the application
 * into one audit identity.
 *
 * A meta call with no usable `capabilityId` falls back to naming the meta tool
 * itself — that call cannot reach a capability anyway, so there is nothing
 * else it could honestly be attributed to.
 */
export function canonicalIdOfCall(
  wireName: string,
  input: unknown,
  mapped: string | undefined,
): string | undefined {
  if (!isMetaToolName(wireName)) return mapped;
  const target = (input as { capabilityId?: unknown } | null | undefined)?.capabilityId;
  return typeof target === "string" && target.length > 0 ? target : `meta:${wireName}`;
}

export { encodeWireName };
