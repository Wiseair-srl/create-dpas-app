import { NextResponse } from "next/server";
import { getRuntimeModelConfig, runtimeConfigAllowed } from "@/server/model-config";

/**
 * Explicitly check the connected key against the provider. Separate from
 * saving on purpose: saving stays local and deterministic, and this network
 * call only happens when the user asks for it.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  if (!runtimeConfigAllowed()) {
    return NextResponse.json(
      { ok: false, reason: "Runtime model configuration is disabled here." },
      { status: 403 },
    );
  }
  const runtime = getRuntimeModelConfig();
  if (!runtime) {
    return NextResponse.json({ ok: false, reason: "No key is connected." }, { status: 400 });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${runtime.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ ok: false, reason: "OpenRouter rejected this key." });
    }
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        reason: `OpenRouter answered ${response.status}.`,
      });
    }
    return NextResponse.json({ ok: true, reason: "OpenRouter accepted this key." });
  } catch {
    // Never fail closed on a diagnostic: the key stays connected either way.
    return NextResponse.json({
      ok: false,
      reason: "Could not reach OpenRouter. The key is still connected.",
    });
  }
}
