import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * E2E against a PRODUCTION build in scripted-model mode (ADR-0006): the full
 * live pipeline — route, Mastra loop, protocol, browser dispatch,
 * confirmation, oRPC — runs with zero external credentials. The guided demo
 * specs exercise the no-model path on the same server.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One worker: specs mutate one shared embedded store and reset it between tests.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: "pnpm exec next build && pnpm exec next start -p 3100",
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      MODEL_PROVIDER: "mock",
      // The production build defaults runtime key entry off; the model-settings
      // spec covers the opt-in path a local operator would use.
      ALLOW_RUNTIME_MODEL_KEY: "true",
      DPAS_DATA_DIR: path.join(import.meta.dirname, "test-results", ".data-e2e"),
    },
  },
});
