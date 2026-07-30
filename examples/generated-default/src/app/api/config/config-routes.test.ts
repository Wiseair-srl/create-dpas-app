import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getConfig } from "./route";
import { DELETE as deleteModel, POST as postModel } from "./model/route";
import { clearRuntimeModelConfig } from "@/server/model-config";

/**
 * The config endpoints through real Request/Response objects. The property
 * under test is the one that matters: a connected key changes behavior but
 * never appears in any response body.
 */

const KEY = "sk-or-v1-abcdef0123456789";

function post(body: unknown): Request {
  return new Request("http://localhost/api/config/model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ALLOW_RUNTIME_MODEL_KEY", "");
  vi.stubEnv("MODEL_PROVIDER", "demo");
  clearRuntimeModelConfig();
});

afterEach(() => {
  clearRuntimeModelConfig();
  vi.unstubAllEnvs();
});

describe("GET /api/config", () => {
  it("reports guided-demo mode with no credential", async () => {
    const body = await (await getConfig()).json();
    expect(body).toMatchObject({
      provider: "demo",
      live: false,
      source: "none",
      runtime: null,
      runtimeConfigurable: true,
    });
  });

  it("reports an env-configured provider without leaking the key", async () => {
    vi.stubEnv("MODEL_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", KEY);
    const raw = await (await getConfig()).text();
    expect(raw).not.toContain(KEY);
    expect(JSON.parse(raw)).toMatchObject({ provider: "openrouter", live: true, source: "env" });
  });
});

describe("POST /api/config/model", () => {
  it("connects a key, flips the app live, and returns only a masked hint", async () => {
    const response = await postModel(post({ provider: "openrouter", apiKey: KEY }));
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(KEY);

    const body = JSON.parse(raw);
    expect(body).toMatchObject({
      provider: "openrouter",
      live: true,
      source: "runtime",
      runtime: { keyHint: "••••6789" },
    });

    // And the same is true of the plain config read afterwards.
    expect(await (await getConfig()).text()).not.toContain(KEY);
  });

  it("rejects malformed input", async () => {
    const response = await postModel(post({ provider: "openrouter", apiKey: "too-short" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });

  it("refuses runtime configuration when disabled", async () => {
    vi.stubEnv("ALLOW_RUNTIME_MODEL_KEY", "false");
    const response = await postModel(post({ provider: "openrouter", apiKey: KEY }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("RUNTIME_CONFIG_DISABLED");
  });

  it("disconnects back to the environment configuration", async () => {
    await postModel(post({ provider: "openrouter", apiKey: KEY }));
    const body = await (await deleteModel()).json();
    expect(body).toMatchObject({ provider: "demo", live: false, source: "none", runtime: null });
  });
});
