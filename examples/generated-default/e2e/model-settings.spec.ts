import { expect, test } from "@playwright/test";
import { openDashboard } from "./helpers";

/**
 * Connecting a model from the UI. The e2e server runs with
 * MODEL_PROVIDER=mock, so a connected key takes precedence and the panel
 * reports OpenRouter — proving the runtime path wins over the environment
 * without any network call.
 */

const FAKE_KEY = "sk-or-v1-e2e-0123456789abcdef";

test.describe("model settings", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    // Start from a clean slate: an earlier test may have connected a key.
    await page.request.delete("/api/config/model");
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete("/api/config/model");
  });

  test("connects an OpenRouter key, masks it, and disconnects again", async ({ page }) => {
    await page.getByTestId("open-model-settings").click();
    const dialog = page.getByTestId("model-settings");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("never written to disk");

    await dialog.getByLabel("OpenRouter API key").fill(FAKE_KEY);
    await dialog.getByLabel("Model id").fill("anthropic/claude-sonnet-4.5");
    await dialog.getByRole("button", { name: "Connect" }).click();

    // Connected state shows the model and a masked key — never the key.
    const connected = page.getByTestId("model-connected");
    await expect(connected).toBeVisible();
    await expect(connected).toContainText("anthropic/claude-sonnet-4.5");
    await expect(connected).toContainText("••••cdef");
    await expect(dialog).not.toContainText(FAKE_KEY);

    // The panel now reports the runtime provider, overriding the env config.
    await expect(page.getByTestId("assistant-mode")).toHaveText("OpenRouter");

    await connected.getByRole("button", { name: "Disconnect" }).click();
    await expect(dialog.getByLabel("OpenRouter API key")).toBeVisible();
    await expect(page.getByTestId("assistant-mode")).toHaveText("Scripted model (mock)");
  });

  test("rejects a key that is too short, without changing the mode", async ({ page }) => {
    await page.getByTestId("open-model-settings").click();
    const dialog = page.getByTestId("model-settings");
    await dialog.getByLabel("OpenRouter API key").fill("nope");
    // The submit stays disabled below the minimum length — no request is made.
    await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
    await expect(page.getByTestId("assistant-mode")).toHaveText("Scripted model (mock)");
  });

  test("never returns the key from the config endpoint", async ({ page }) => {
    const connect = await page.request.post("/api/config/model", {
      data: { provider: "openrouter", apiKey: FAKE_KEY },
    });
    expect(connect.ok()).toBe(true);
    expect(await connect.text()).not.toContain(FAKE_KEY);

    const config = await page.request.get("/api/config");
    const body = await config.text();
    expect(body).not.toContain(FAKE_KEY);
    expect(body).toContain("••••cdef");
  });
});
