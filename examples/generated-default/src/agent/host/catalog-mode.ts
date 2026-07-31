"use client";

import { create } from "zustand";

/**
 * How the surface is projected to the model (W3).
 *
 * Both modes run against the SAME registry and the same capabilities — the
 * choice is a projection, not a different application:
 *
 *   - **direct** — one tool per capability. The model sees the catalog and
 *     picks from it. Simple and precise, but the tool block grows with the
 *     surface, and flat lists of hundreds of tools degrade selection accuracy
 *     regardless of context window.
 *   - **meta** — three generic tools (`surface_discover`, `surface_read`,
 *     `surface_act`). The block is constant-size whatever the surface holds;
 *     the model discovers capabilities instead of being handed them, at the
 *     cost of a discovery round-trip before it can act.
 *
 * This bounds the VIEW plane only. The domain plane is projected by
 * `toAISDKTools`, which has no meta mode — a wide domain surface is bounded by
 * scope (W1) instead. The two compose: scoped domain + meta view.
 *
 * Kept in the browser deliberately. It shapes what this tab offers the model,
 * so it is a client projection decision, not server configuration — and the
 * server treats whatever arrives as a request, echoing the effective mode back
 * on `step-start`.
 */

export type CatalogMode = "direct" | "meta";

interface CatalogModeState {
  mode: CatalogMode;
  setMode: (mode: CatalogMode) => void;
}

export const useCatalogMode = create<CatalogModeState>((set) => ({
  mode: "direct",
  setMode: (mode) => set({ mode }),
}));

/** Read outside React — the turn controller runs off the render tree. */
export function currentCatalogMode(): CatalogMode {
  return useCatalogMode.getState().mode;
}
