/// <reference types="vite/client" />

/**
 * The compiled capability contract, served by `@agent-surface/compiler`'s Vite
 * plugin (see vite.config.ts).
 *
 * This is the app's *exposure ceiling*, derived from the production module
 * graph at build time rather than from whatever happened to mount. The registry
 * takes it as its `authority` and will refuse to register — or invoke —
 * anything the contract does not prove. Importing it outside a Vite build fails
 * loudly, which is the point: there is no unproven path to a surface.
 */
declare module "virtual:agent-surface-contract" {
  import type { CapabilityAuthority, CapabilityContractManifest } from "@agent-surface/core";

  const authority: CapabilityAuthority;
  export const manifest: CapabilityContractManifest;
  export default authority;
}
