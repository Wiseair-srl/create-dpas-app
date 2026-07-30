import { Agent } from "@mastra/core/agent";
import {
  DEFAULT_OPENROUTER_MODEL,
  getRuntimeModelConfig,
  getRuntimeModelPublicInfo,
  runtimeConfigAllowed,
} from "@/server/model-config";
import { ASSISTANT_INSTRUCTIONS } from "./instructions";
import { createScriptedModel } from "./scripted-model";

/**
 * Mastra owns the reasoning loop. It consumes tools composed by the Agent
 * Host per request — it never defines capabilities, touches React, or calls
 * oRPC procedures directly.
 *
 * A model comes from one of two places, runtime first:
 *   1. a key connected from the UI (process memory, see server/model-config),
 *   2. MODEL_PROVIDER + the matching API key in the environment.
 */

export type ModelProvider = "demo" | "anthropic" | "openai" | "openrouter" | "mock";

export interface ModelConfig {
  provider: ModelProvider;
  /** Human-readable label for the UI ("Guided demo", "Claude", …). */
  label: string;
  /** Whether the live chat endpoint is usable. */
  live: boolean;
  /** Where the credential came from. Never includes the credential itself. */
  source: "env" | "runtime" | "none";
}

const DEFAULT_MODEL_IDS: Record<string, string> = {
  anthropic: "anthropic/claude-sonnet-4-5",
  openai: "openai/gpt-5.1",
  openrouter: DEFAULT_OPENROUTER_MODEL,
};

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  demo: "Guided demo",
  anthropic: "Claude (Anthropic)",
  openai: "GPT (OpenAI)",
  openrouter: "OpenRouter",
  mock: "Scripted model (mock)",
};

function envModelConfig(): ModelConfig {
  const provider = (process.env.MODEL_PROVIDER ?? "demo") as ModelProvider;
  const label = PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.demo;
  switch (provider) {
    case "anthropic":
      return keyed(provider, label, process.env.ANTHROPIC_API_KEY);
    case "openai":
      return keyed(provider, label, process.env.OPENAI_API_KEY);
    case "openrouter":
      return keyed(provider, label, process.env.OPENROUTER_API_KEY);
    case "mock":
      return { provider, label, live: true, source: "env" };
    default:
      return { provider: "demo", label: PROVIDER_LABELS.demo, live: false, source: "none" };
  }
}

function keyed(provider: ModelProvider, label: string, apiKey: string | undefined): ModelConfig {
  return apiKey
    ? { provider, label, live: true, source: "env" }
    : { provider, label, live: false, source: "none" };
}

export function resolveModelConfig(): ModelConfig {
  const runtime = getRuntimeModelConfig();
  if (runtime) {
    return {
      provider: runtime.provider,
      label: PROVIDER_LABELS[runtime.provider],
      live: true,
      source: "runtime",
    };
  }
  return envModelConfig();
}

/** Everything the browser may know about model configuration — never a key. */
export function describeModelConfig() {
  const config = resolveModelConfig();
  return {
    ...config,
    modelId: modelIdFor(config),
    runtimeConfigurable: runtimeConfigAllowed(),
    runtime: getRuntimeModelPublicInfo(),
  };
}

function modelIdFor(config: ModelConfig): string | null {
  if (config.provider === "demo" || config.provider === "mock") return null;
  if (config.source === "runtime") return getRuntimeModelConfig()?.modelId ?? null;
  return process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[config.provider] ?? null;
}

type ModelInput = ConstructorParameters<typeof Agent>[0]["model"];

/** The model for the current configuration, or null when only the guided demo is available. */
function resolveModel(): ModelInput | null {
  const runtime = getRuntimeModelConfig();
  if (runtime) {
    // Mastra's model router accepts an explicit key, so a UI-supplied
    // credential never has to be written into the process environment.
    return { id: runtime.modelId, apiKey: runtime.apiKey } as unknown as ModelInput;
  }

  const config = envModelConfig();
  if (!config.live) return null;
  if (config.provider === "mock") return createScriptedModel() as unknown as ModelInput;
  // Model-router string: "provider/model-id", key read from the environment.
  return (process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[config.provider]) as ModelInput;
}

export const RUN_LIMITS = {
  /** Max model steps inside ONE protocol step-request. */
  maxStepsPerRequest: 5,
  /** Inactivity watchdog between stream chunks. */
  modelTimeoutMs: 45_000,
} as const;

export function buildAssistantAgent(): Agent | null {
  const model = resolveModel();
  if (!model) return null;
  return new Agent({
    id: "dashboard-assistant",
    name: "Dashboard assistant",
    instructions: ASSISTANT_INSTRUCTIONS,
    model,
  });
}
