import { NextResponse } from "next/server";
import { resolveModelConfig } from "@/agent/runtime/mastra";

/** Which assistant modes this deployment supports (never exposes secrets). */
export async function GET() {
  const model = resolveModelConfig();
  return NextResponse.json({
    provider: model.provider,
    label: model.label,
    live: model.live,
  });
}
