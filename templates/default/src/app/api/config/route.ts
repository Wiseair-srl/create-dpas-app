import { NextResponse } from "next/server";
import { describeModelConfig } from "@/agent/runtime/mastra";

/**
 * Which assistant modes this deployment supports. Reports where the
 * credential came from and a masked hint when one is connected — never the
 * key itself.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(describeModelConfig());
}
