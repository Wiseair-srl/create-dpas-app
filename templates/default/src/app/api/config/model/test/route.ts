import { NextResponse } from "next/server";
import { getRuntimeModelConfig, runtimeConfigAllowed } from "@/server/model-config";

/**
 * Explicitly check the connected key AND that the chosen model can actually
 * do what this app needs: tool calling. A model without tool support fails
 * mid-conversation with OpenRouter's "No endpoints found that support tool
 * use", which is a confusing place to learn it — so we check here, on
 * demand. Separate from saving on purpose: saving stays local, deterministic
 * and offline-friendly.
 */
export const dynamic = "force-dynamic";

interface OpenRouterModel {
  id: string;
  supported_parameters?: string[];
}

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
    const keyCheck = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${runtime.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (keyCheck.status === 401 || keyCheck.status === 403) {
      return NextResponse.json({ ok: false, reason: "OpenRouter rejected this key." });
    }
    if (!keyCheck.ok) {
      return NextResponse.json({ ok: false, reason: `OpenRouter answered ${keyCheck.status}.` });
    }

    const wanted = runtime.modelId.replace(/^openrouter\//, "");
    const catalog = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10_000),
    });
    if (catalog.ok) {
      const { data } = (await catalog.json()) as { data: OpenRouterModel[] };
      const model = data.find((entry) => entry.id === wanted);
      if (!model) {
        return NextResponse.json({
          ok: false,
          reason: `Key is valid, but "${wanted}" is not an OpenRouter model id.`,
        });
      }
      if (!(model.supported_parameters ?? []).includes("tools")) {
        return NextResponse.json({
          ok: false,
          reason: `Key is valid, but "${wanted}" does not support tool calling — the assistant needs it.`,
        });
      }
      return NextResponse.json({
        ok: true,
        reason: `Key accepted and "${wanted}" supports tool calling.`,
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
