import { z } from "zod";

/**
 * Runtime model configuration — a developer convenience so a live model can
 * be connected from the UI without editing .env and restarting.
 *
 * Security rules this module exists to enforce:
 *  - the API key lives in THIS process's memory only. It is never written to
 *    disk, never placed in an env var, never logged, and never serialized
 *    back to the browser (only a masked hint is);
 *  - runtime configuration is a single-process, single-tenant affordance, so
 *    it is disabled in production unless explicitly opted in. One visitor's
 *    key would otherwise serve every visitor of a shared deployment.
 */

export const RUNTIME_PROVIDERS = ["openrouter"] as const;
export type RuntimeProvider = (typeof RUNTIME_PROVIDERS)[number];

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.5";

export const RuntimeModelInputSchema = z.object({
  provider: z.enum(RUNTIME_PROVIDERS),
  apiKey: z.string().min(16).max(400),
  modelId: z.string().min(3).max(120).optional(),
});
export type RuntimeModelInput = z.infer<typeof RuntimeModelInputSchema>;

export interface RuntimeModelConfig {
  provider: RuntimeProvider;
  apiKey: string;
  modelId: string;
}

/** What the browser is allowed to know about a configured key. */
export interface RuntimeModelPublicInfo {
  provider: RuntimeProvider;
  modelId: string;
  keyHint: string;
}

interface RuntimeStore {
  current: RuntimeModelConfig | null;
}

const globalKey = "__dpasRuntimeModel" as const;

function store(): RuntimeStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = { current: null } satisfies RuntimeStore;
  return g[globalKey] as RuntimeStore;
}

/**
 * Whether keys may be set at runtime. Development: yes. Production: only with
 * an explicit opt-in, because the key is shared by the whole process.
 */
export function runtimeConfigAllowed(): boolean {
  if (process.env.ALLOW_RUNTIME_MODEL_KEY === "true") return true;
  if (process.env.ALLOW_RUNTIME_MODEL_KEY === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/** Last four characters only — enough to recognize a key, useless to steal. */
export function maskKey(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}

export function getRuntimeModelConfig(): RuntimeModelConfig | null {
  if (!runtimeConfigAllowed()) return null;
  return store().current;
}

export function getRuntimeModelPublicInfo(): RuntimeModelPublicInfo | null {
  const current = getRuntimeModelConfig();
  if (!current) return null;
  return {
    provider: current.provider,
    modelId: current.modelId,
    keyHint: maskKey(current.apiKey),
  };
}

export function setRuntimeModelConfig(input: RuntimeModelInput): RuntimeModelPublicInfo {
  if (!runtimeConfigAllowed()) {
    throw new Error("Runtime model configuration is disabled in this environment.");
  }
  store().current = {
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    modelId: input.modelId?.trim() || DEFAULT_OPENROUTER_MODEL,
  };
  return getRuntimeModelPublicInfo()!;
}

export function clearRuntimeModelConfig(): void {
  store().current = null;
}
