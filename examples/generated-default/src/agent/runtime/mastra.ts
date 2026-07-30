import { Agent } from "@mastra/core/agent";
import { ASSISTANT_INSTRUCTIONS } from "./instructions";
import { createScriptedModel } from "./scripted-model";

/**
 * Mastra owns the reasoning loop. It consumes tools composed by the Agent
 * Host per request — it never defines capabilities, touches React, or calls
 * oRPC procedures directly.
 */

export type ModelProvider = "demo" | "anthropic" | "openai" | "mock";

export interface ModelConfig {
  provider: ModelProvider;
  /** Human-readable label for the UI ("Guided demo", "Claude", …). */
  label: string;
  /** Whether the live chat endpoint is usable. */
  live: boolean;
}

const DEFAULT_MODEL_IDS: Record<string, string> = {
  anthropic: "anthropic/claude-sonnet-4-5",
  openai: "openai/gpt-5.1",
};

export function resolveModelConfig(): ModelConfig {
  const provider = (process.env.MODEL_PROVIDER ?? "demo") as ModelProvider;
  switch (provider) {
    case "anthropic":
      return { provider, label: "Claude (Anthropic)", live: Boolean(process.env.ANTHROPIC_API_KEY) };
    case "openai":
      return { provider, label: "GPT (OpenAI)", live: Boolean(process.env.OPENAI_API_KEY) };
    case "mock":
      return { provider, label: "Scripted model (mock)", live: true };
    default:
      return { provider: "demo", label: "Guided demo", live: false };
  }
}

type ModelInput = ConstructorParameters<typeof Agent>[0]["model"];

/** The model for the current configuration, or null when only the guided demo is available. */
function resolveModel(): ModelInput | null {
  const config = resolveModelConfig();
  if (!config.live) return null;
  if (config.provider === "mock") return createScriptedModel() as unknown as ModelInput;
  // Mastra's model router: "provider/model-id" strings resolved with the
  // provider API key from the environment.
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
