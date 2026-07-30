import { handleChatStep } from "@/agent/host/server-compose";

/**
 * DPAS host protocol v1 endpoint: one POST per model step-run, NDJSON frames
 * back. All composition logic lives in the Agent Host module — this route is
 * deliberately thin so the architecture is not hidden inside a handler.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleChatStep(request);
}
