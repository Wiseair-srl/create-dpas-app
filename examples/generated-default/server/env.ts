import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Configuration, read once at boot.
 *
 * Everything here is optional. The app runs with an empty `.env` — that is the
 * point of the guided demo — and each key only unlocks something extra. Nothing
 * in this file is ever bundled into the client: the agent loop runs
 * server-side, so the browser never needs a model key.
 */

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match as unknown as [string, string, string];
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const env = {
  /**
   * SERVER_PORT first, and that ordering is load-bearing in development.
   *
   * Vite and this server are two processes, and a harness that sets PORT means
   * "serve the app there" — which in development is Vite's job, not ours. Read
   * PORT first and both bind the same port: the proxy then targets itself, and
   * every /rpc call comes back as the SPA's index.html. The dev script sets
   * SERVER_PORT explicitly; production sets PORT and there is only one process
   * to give it to.
   */
  PORT: Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
  ANTHROPIC_MODELS: list(process.env.ANTHROPIC_MODELS),
  OPENROUTER_MODELS: list(process.env.OPENROUTER_MODELS),
  DEFAULT_MODEL: process.env.DEFAULT_MODEL ?? "anthropic/claude-sonnet-4-5",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "dpas-dev-secret-change-me",
  /** Set by the e2e harness: swaps the provider for a scripted model. */
  MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? "",
} as const;

export function logBootConfig(): void {
  const providers = [
    env.ANTHROPIC_API_KEY ? "anthropic" : null,
    env.OPENROUTER_API_KEY ? "openrouter" : null,
    env.MODEL_PROVIDER === "mock" ? "scripted (e2e)" : null,
  ].filter(Boolean);
  console.log(
    `[dpas] port ${env.PORT} · model providers: ${providers.length ? providers.join(", ") : "none (guided demo only)"}`,
  );
}
