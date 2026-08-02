import { defineConfig, devices } from "@playwright/test";

/**
 * e2e against a PRODUCTION build with the scripted model
 * (`MODEL_PROVIDER=mock`), so CI exercises the whole live pipeline — host
 * protocol, Mastra loop, client-tool suspension, oRPC execution,
 * reconciliation — and never needs a credential.
 *
 * `DPAS_DATA_DIR` points at a scratch directory: these tests issue invoices
 * and record chases, and a suite that mutates the developer's own `.data/` is
 * a suite nobody runs twice.
 */
const PORT = 3210;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Builds before serving: `build/index.mjs` is the artifact under test, and
    // a suite that runs whatever bundle happens to be on disk reports stale
    // output as a broken fix. `reuseExistingServer: false` is the other half —
    // together they mean every run measures the working tree.
    command: "pnpm build && node build/index.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      MODEL_PROVIDER: "mock",
      DPAS_DATA_DIR: ".data-e2e",
    },
  },
});
