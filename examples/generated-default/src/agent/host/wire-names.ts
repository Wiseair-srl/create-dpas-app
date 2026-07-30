import { decodeWireName, encodeWireName } from "@agent-surface/core";

/**
 * Canonical id ↔ provider-safe wire name mapping for BOTH planes, aligned on
 * one convention (":" → "_", "." → "__"):
 *
 *   view:devices.filters.set   ↔  view_devices__filters__set
 *   domain:devices.list        ↔  domain_devices__list
 *
 * Agent Surface encodes its own tools; the domain side uses `domainToolName`
 * as the orpc-agent `toolNaming` override so the model sees one uniform,
 * reversible namespace. The canonical id remains the audit identity.
 */

export function domainToolName(capabilityId: string): string {
  return encodeWireName(`domain:${capabilityId}`);
}

/** Reverse a wire name to its canonical id. Returns undefined for truncated names. */
export function canonicalIdFromWireName(wireName: string): string | undefined {
  // Multi-instance surface tools carry an `_at_<instance>` suffix; the
  // canonical id is the part before it.
  const [base] = wireName.split("_at_");
  return decodeWireName(base ?? wireName);
}

export { encodeWireName };
