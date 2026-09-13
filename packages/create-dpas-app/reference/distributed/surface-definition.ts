import {
  actionContract,
  createAgentSurfaceRegistry,
  defineAgentComponentContract,
  fromJsonSchema,
} from "@agent-surface/core";
import authority from "virtual:agent-surface-contract";

// Static declaration: the Vite compiler stamps proof matching the build authority.
export const referencePanelContract = defineAgentComponentContract({
  type: "reference.panel",
  description: "Reference invoice",
  actions: {
    highlight: actionContract({
      description: "Highlight the invoice in this browser tab",
      input: fromJsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      effect: "local-state",
    }),
  },
});

export function createReferenceSurface(onHighlight: () => void) {
  const registry = createAgentSurfaceRegistry({ authority });
  registry.register(
    referencePanelContract.bind({
      actions: {
        highlight: {
          execute: () => {
            onHighlight();
            return { highlighted: true };
          },
        },
      },
    }),
  );
  return registry;
}
