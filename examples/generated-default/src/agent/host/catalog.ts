import type { AgentSurfaceSnapshot, AgentToolset } from "@agent-surface/core";
import type { CatalogRow } from "@/agent/inspector/inspector-store";
import type { WireToolDescriptor } from "./protocol";
import { canonicalIdFromWireName } from "./wire-names";

/**
 * Catalog projection — the browser half of per-turn composition.
 *
 * `buildFrontendToolDescriptors` turns the live Agent Surface toolset into
 * wire descriptors for the protocol (declaration only; the executors stay in
 * this tab). `snapshotToCatalogRows` renders the same surface for the
 * inspector, including unavailable capabilities and their reasons.
 */

export function buildFrontendToolDescriptors(
  toolset: AgentToolset,
  snapshot: AgentSurfaceSnapshot,
): WireToolDescriptor[] {
  const meta = indexSnapshot(snapshot);
  return toolset.tools().map((tool) => {
    const canonicalId = canonicalIdFromWireName(tool.name) ?? tool.name;
    const info = meta.get(canonicalId);
    return {
      wireName: tool.name,
      canonicalId,
      plane: canonicalId.startsWith("domain:") ? "domain" : "view",
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      effect: info?.effect ?? "unknown",
      confirmation: info?.confirmation ?? "never",
      available: info?.available ?? true,
      ...(info && !info.available && info.unavailableReason
        ? { unavailableReason: info.unavailableReason }
        : {}),
    };
  });
}

interface SnapshotCapabilityMeta {
  effect: string;
  confirmation: "never" | "optional" | "required";
  available: boolean;
  unavailableReason?: string;
}

function indexSnapshot(snapshot: AgentSurfaceSnapshot): Map<string, SnapshotCapabilityMeta> {
  const map = new Map<string, SnapshotCapabilityMeta>();
  for (const component of snapshot.components) {
    for (const obs of component.observations) {
      map.set(obs.capabilityId, {
        effect: "read",
        confirmation: "never",
        available: obs.available,
        ...(obs.unavailableReason ? { unavailableReason: obs.unavailableReason } : {}),
      });
    }
    for (const act of component.actions) {
      map.set(act.capabilityId, {
        effect: act.effect,
        confirmation: act.confirmation,
        available: act.available,
        ...(act.unavailableReason ? { unavailableReason: act.unavailableReason } : {}),
      });
    }
  }
  for (const proc of snapshot.procedures) {
    map.set(proc.procedureId, {
      effect: proc.effect,
      confirmation: proc.confirmation,
      available: proc.available,
      ...(proc.unavailableReason ? { unavailableReason: proc.unavailableReason } : {}),
    });
  }
  return map;
}

export function snapshotToCatalogRows(snapshot: AgentSurfaceSnapshot): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const component of snapshot.components) {
    for (const obs of component.observations) {
      rows.push({
        canonicalId: obs.capabilityId,
        plane: "view",
        kind: "observation",
        description: obs.description,
        effect: "read",
        executor: "browser",
        available: obs.available,
        ...(obs.unavailableReason ? { unavailableReason: obs.unavailableReason } : {}),
        confirmation: "never",
        registrationId: component.registrationId,
      });
    }
    for (const act of component.actions) {
      rows.push({
        canonicalId: act.capabilityId,
        plane: "view",
        kind: "action",
        description: act.description,
        effect: act.effect,
        executor: "browser",
        available: act.available,
        ...(act.unavailableReason ? { unavailableReason: act.unavailableReason } : {}),
        confirmation: act.confirmation,
        registrationId: component.registrationId,
      });
    }
  }
  for (const proc of snapshot.procedures) {
    rows.push({
      canonicalId: proc.procedureId,
      plane: "domain",
      kind: "procedure",
      description: proc.description,
      effect: proc.effect,
      executor: "browser→server",
      available: proc.available,
      ...(proc.unavailableReason ? { unavailableReason: proc.unavailableReason } : {}),
      confirmation: proc.confirmation,
      registrationId: proc.registrationId,
      boundFields: proc.boundFields.map(({ path, locked }) => ({ path, locked })),
    });
  }
  return rows;
}

/**
 * Duplicate-path detection (DPAS anti-duplication rule): a domain operation
 * may reach the model either as a direct server tool or as a contextual
 * surface reference — never both. Returns the offending canonical ids.
 */
export function findCatalogCollisions(
  frontendDescriptors: ReadonlyArray<Pick<WireToolDescriptor, "canonicalId">>,
  domainCanonicalIds: ReadonlyArray<string>,
): string[] {
  const frontend = new Set(frontendDescriptors.map((d) => d.canonicalId));
  return domainCanonicalIds.filter((id) => frontend.has(id));
}
