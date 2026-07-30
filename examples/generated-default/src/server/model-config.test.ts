import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeModelConfig,
  getRuntimeModelConfig,
  getRuntimeModelPublicInfo,
  maskKey,
  runtimeConfigAllowed,
  RuntimeModelInputSchema,
  setRuntimeModelConfig,
  toRouterModelId,
  DEFAULT_OPENROUTER_MODEL,
} from "./model-config";

/**
 * The runtime key store exists to make a credential usable without ever
 * exposing it. These tests pin that contract.
 */

const KEY = "sk-or-v1-0123456789abcdef";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ALLOW_RUNTIME_MODEL_KEY", "");
  clearRuntimeModelConfig();
});

afterEach(() => {
  clearRuntimeModelConfig();
  vi.unstubAllEnvs();
});

describe("runtime configuration guard", () => {
  it("is enabled in development and disabled in production", () => {
    expect(runtimeConfigAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(runtimeConfigAllowed()).toBe(false);
  });

  it("honours an explicit opt-in and opt-out", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_RUNTIME_MODEL_KEY", "true");
    expect(runtimeConfigAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_RUNTIME_MODEL_KEY", "false");
    expect(runtimeConfigAllowed()).toBe(false);
  });

  it("refuses to store a key when disabled, and hides any earlier one", () => {
    setRuntimeModelConfig({ provider: "openrouter", apiKey: KEY });
    vi.stubEnv("NODE_ENV", "production");
    expect(getRuntimeModelConfig()).toBeNull();
    expect(getRuntimeModelPublicInfo()).toBeNull();
    expect(() => setRuntimeModelConfig({ provider: "openrouter", apiKey: KEY })).toThrow();
  });
});

describe("key handling", () => {
  it("stores the key for server use and defaults the model", () => {
    setRuntimeModelConfig({ provider: "openrouter", apiKey: KEY });
    const current = getRuntimeModelConfig();
    expect(current?.apiKey).toBe(KEY);
    expect(current?.modelId).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("never exposes the key in the public projection", () => {
    setRuntimeModelConfig({ provider: "openrouter", apiKey: KEY, modelId: "openai/gpt-5.1" });
    const info = getRuntimeModelPublicInfo();
    expect(info).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5.1",
      keyHint: "••••cdef",
    });
    expect(JSON.stringify(info)).not.toContain(KEY);
  });

  it("masks to the last four characters only", () => {
    expect(maskKey("sk-or-v1-supersecretvalue")).toBe("••••alue");
  });

  it("clears on request", () => {
    setRuntimeModelConfig({ provider: "openrouter", apiKey: KEY });
    clearRuntimeModelConfig();
    expect(getRuntimeModelConfig()).toBeNull();
  });
});

describe("router model id", () => {
  /**
   * Regression: Mastra strips the leading provider segment before calling
   * upstream. A bare "anthropic/claude-sonnet-4.5" reached OpenRouter as
   * "claude-sonnet-4.5" — not a valid id there — and the run failed with
   * "No endpoints found that support tool use".
   */
  it("keeps the vendor segment by prefixing the gateway", () => {
    expect(toRouterModelId("openrouter", "anthropic/claude-sonnet-4.5")).toBe(
      "openrouter/anthropic/claude-sonnet-4.5",
    );
  });

  it("accepts an already-prefixed id without doubling it", () => {
    expect(toRouterModelId("openrouter", "openrouter/anthropic/claude-sonnet-4.5")).toBe(
      "openrouter/anthropic/claude-sonnet-4.5",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(toRouterModelId("openrouter", "  openai/gpt-5.1  ")).toBe("openrouter/openai/gpt-5.1");
  });
});

describe("input validation", () => {
  it("rejects short keys, unknown providers and oversized values", () => {
    expect(RuntimeModelInputSchema.safeParse({ provider: "openrouter", apiKey: "short" }).success)
      .toBe(false);
    expect(RuntimeModelInputSchema.safeParse({ provider: "acme", apiKey: KEY }).success).toBe(false);
    expect(
      RuntimeModelInputSchema.safeParse({ provider: "openrouter", apiKey: "x".repeat(401) })
        .success,
    ).toBe(false);
  });

  it("accepts a well-formed request", () => {
    expect(
      RuntimeModelInputSchema.safeParse({
        provider: "openrouter",
        apiKey: KEY,
        modelId: "anthropic/claude-sonnet-4.5",
      }).success,
    ).toBe(true);
  });
});
