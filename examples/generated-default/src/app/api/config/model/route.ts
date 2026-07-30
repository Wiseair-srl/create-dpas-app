import { NextResponse } from "next/server";
import { describeModelConfig } from "@/agent/runtime/mastra";
import {
  clearRuntimeModelConfig,
  RuntimeModelInputSchema,
  runtimeConfigAllowed,
  setRuntimeModelConfig,
} from "@/server/model-config";

/**
 * Connect or disconnect a model credential at runtime.
 *
 * The key is accepted here, kept in this process's memory, and used only to
 * construct the Mastra model server-side. Responses carry the resolved
 * configuration and a masked hint — never the key. Nothing is written to
 * disk, so `.env` remains the durable place to configure a deployment.
 */
export const dynamic = "force-dynamic";

function forbidden() {
  return NextResponse.json(
    {
      error: {
        code: "RUNTIME_CONFIG_DISABLED",
        message:
          "Runtime model configuration is disabled here. Set MODEL_PROVIDER and an API key in .env, " +
          "or set ALLOW_RUNTIME_MODEL_KEY=true to enable this endpoint.",
      },
    },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  if (!runtimeConfigAllowed()) return forbidden();

  const parsed = RuntimeModelInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Provide a supported provider and an API key of at least 16 characters.",
        },
      },
      { status: 400 },
    );
  }

  setRuntimeModelConfig(parsed.data);
  return NextResponse.json(describeModelConfig());
}

export async function DELETE() {
  if (!runtimeConfigAllowed()) return forbidden();
  clearRuntimeModelConfig();
  return NextResponse.json(describeModelConfig());
}
