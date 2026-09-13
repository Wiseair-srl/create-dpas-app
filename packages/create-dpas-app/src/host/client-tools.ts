import { jsonSchema, tool, type ToolSet } from "ai";

export interface HostClientToolDescriptor {
  wireName: string;
  canonicalId: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Execute-less tools for agent.stream(..., { clientTools }). The application
 * builds these from a verified artifact and a live authenticated announcement.
 * Returned model tool calls must go through createSurfaceHost.dispatch and
 * @agent-surface/core/host in the browser; never execute a browser action here.
 */
export async function createMastraClientTools(options: {
  descriptors: readonly HostClientToolDescriptor[];
  authorizeDescriptor: (descriptor: HostClientToolDescriptor) => void | Promise<void>;
}): Promise<ToolSet> {
  const tools: ToolSet = Object.create(null) as ToolSet;
  const ids = new Set<string>();
  for (const descriptor of options.descriptors) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(descriptor.wireName) ||
      Object.hasOwn(tools, descriptor.wireName) ||
      ids.has(descriptor.canonicalId)
    ) {
      throw new TypeError("Browser tool names and canonical IDs must be unique.");
    }
    await options.authorizeDescriptor(descriptor);
    ids.add(descriptor.canonicalId);
    tools[descriptor.wireName] = tool({
      description: descriptor.description,
      inputSchema: jsonSchema(descriptor.inputSchema as Parameters<typeof jsonSchema>[0]),
    });
  }
  return tools;
}
