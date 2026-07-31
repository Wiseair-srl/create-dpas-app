import type { AgentSurfaceSnapshot, AgentToolset } from "@agent-surface/core";
import type { CatalogRow } from "@/agent/inspector/inspector-store";
import type { WireToolDescriptor, WireToolState } from "./protocol";
import type { CatalogMode } from "./catalog-mode";

/**
 * Catalog projection — the browser half of per-turn composition.
 *
 * `buildFrontendToolDescriptors` turns the live Agent Surface toolset into
 * wire descriptors for the protocol (declaration only; the executors stay in
 * this tab). `snapshotToCatalogRows` renders the same surface for the
 * inspector, including unavailable capabilities and their reasons.
 */

export interface FrontendCatalogProjection {
  /** Stable half — goes in the provider tool block. No live state. */
  descriptors: WireToolDescriptor[];
  /** Volatile half — rendered outside the tool block, after the messages. */
  state: WireToolState[];
  /**
   * Wire names the toolset could not map back to a canonical id. Never
   * silently discarded — the caller reports these (invariant 7).
   */
  undecodable: string[];
}

export function buildFrontendToolDescriptors(
  toolset: AgentToolset,
  snapshot: AgentSurfaceSnapshot,
  mode: CatalogMode = "direct",
): FrontendCatalogProjection {
  const meta = indexSnapshot(snapshot);
  // Authoritative reversal for the catalog `tools()` just built. Shortened and
  // instance-suffixed names are not recoverable by string surgery (D30).
  const wireNames = toolset.wireNameMap();
  // The mode is passed, never inferred. `wireNameMap()` is empty in meta mode
  // because `surface_discover` / `surface_read` / `surface_act` are not
  // capability ids — but it is ALSO empty for a direct catalog in which
  // nothing mapped, and those two cases need opposite handling: keep all three
  // meta tools, withhold every unmapped direct one. In meta mode the audit
  // identity comes from the CALL's `capabilityId` argument instead; see
  // `canonicalIdOfCall`.
  const metaMode = mode === "meta";
  const descriptors: WireToolDescriptor[] = [];
  const state: WireToolState[] = [];
  const undecodable: string[] = [];

  for (const tool of toolset.tools()) {
    const canonicalId = metaMode ? `meta:${tool.name}` : wireNames.get(tool.name);
    // A capability that cannot be audited under its canonical id is not
    // offered to the model. Degrading the identity to the wire name would
    // break invariant 8 exactly where it matters most: the audit record.
    if (!canonicalId) {
      undecodable.push(tool.name);
      continue;
    }
    const info = meta.get(canonicalId);
    // `description` is note-free and state-free by construction here: the
    // registry is built with `snapshotMergesContextualNote: false` and the
    // toolset with `descriptionIncludesState: false`. Nothing volatile may be
    // folded back into it — that would silently defeat prefix caching.
    descriptors.push({
      wireName: tool.name,
      canonicalId,
      plane: canonicalId.startsWith("domain:") ? "domain" : "view",
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      effect: info?.effect ?? "unknown",
      confirmation: info?.confirmation ?? "never",
    });

    state.push({
      wireName: tool.name,
      available: tool.state.available,
      ...(tool.state.unavailableReason
        ? { unavailableReason: tool.state.unavailableReason }
        : {}),
      ...(tool.state.note ? { note: tool.state.note } : {}),
    });
  }

  return { descriptors, state, undecodable };
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
      // The Inspector is human-facing and never cached, so the live binding
      // text is merged back in here — it is only kept out of `description`
      // for the model's prompt prefix.
      description: proc.contextualNote
        ? `${proc.description} ${proc.contextualNote}`
        : proc.description,
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
