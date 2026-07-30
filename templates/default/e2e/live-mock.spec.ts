import { expect, test } from "@playwright/test";
import { MILAN_OFFLINE_NAMES, metricValue, openDashboard, resetData } from "./helpers";

/**
 * The LIVE pipeline, end to end: composer → host protocol → Mastra loop
 * (scripted model) → per-turn composition → client-tool suspension → Agent
 * Surface execution → confirmation → oRPC → reconciliation. This is the same
 * code path a real Anthropic/OpenAI key exercises — only the model is
 * scripted (MODEL_PROVIDER=mock, ADR-0006).
 */
test.describe("live agent mode (scripted model)", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
  });

  test("executes the golden scenario through Mastra and the host protocol", async ({ page }) => {
    await expect(page.getByTestId("assistant-mode")).toContainText("Scripted model");

    await page.getByRole("textbox", { name: "Message the assistant" }).fill(
      "Show me the offline devices in Milan, select the visible devices, and disable them.",
    );
    await page.getByRole("button", { name: "Send" }).click();

    // Filters were applied by the model through view tools.
    await expect(page.locator("[data-device-row]")).toHaveCount(3, { timeout: 20_000 });
    await expect(page.getByText("3 selected")).toBeVisible();

    // The first message batches a server tool with a client tool. Mastra runs
    // the domain read but drops its result when the run suspends, so the host
    // answers that call itself — the card must settle, never hang on
    // "running".
    await expect(
      page.locator('[data-testid="tool-card"][data-capability="domain:devices.list"]'),
    ).toHaveAttribute("data-status", "ok", { timeout: 20_000 });

    // Confirmation gates the contextual mutation, exactly as in the demo.
    const confirmation = page.getByTestId("confirmation-card");
    await expect(confirmation).toBeVisible({ timeout: 20_000 });
    for (const name of MILAN_OFFLINE_NAMES) {
      await expect(confirmation).toContainText(name);
    }
    await confirmation.getByRole("button", { name: /Approve — disable 3/ }).click();

    // The model's summary is grounded in the tool result.
    await expect(page.getByTestId("assistant-transcript")).toContainText(
      /3 offline devices? in Milan (is|are) now disabled/,
      { timeout: 20_000 },
    );
    await expect(metricValue(page, "Disabled")).toHaveText("3");

    // Markdown is rendered, not printed: emphasis and inline code become
    // elements, and no raw ** or backticks survive.
    const transcript = page.getByTestId("assistant-transcript");
    await expect(transcript.locator("strong").first()).toBeVisible();
    await expect(transcript.locator("code").first()).toHaveText("Milan");
    await expect(transcript).not.toContainText("**");

    // Reasoning is a separate, collapsed block — never mixed into the answer,
    // and stripped of the channel markers some models leak.
    const reasoning = page.getByTestId("reasoning").first();
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText("Model reasoning");
    await expect(reasoning).toContainText("Filter to Milan");
    // The channel header is gone, name and all.
    await expect(transcript).not.toContainText("<|channel|>");
    await expect(reasoning).not.toContainText("analysis");

    // Server-executed domain tools ran inside the loop this turn — the
    // inspector shows the composed domain catalog arriving per step.
    await page.getByRole("tab", { name: "Inspector" }).click();
    await page.getByRole("tab", { name: "timeline" }).click();
    await expect(page.getByTestId("inspector-timeline")).toContainText("server composed catalog");
  });

  test("denying in live mode leaves data untouched and the model says so", async ({ page }) => {
    await page.getByRole("textbox", { name: "Message the assistant" }).fill(
      "Disable the offline devices in Milan.",
    );
    await page.getByRole("button", { name: "Send" }).click();

    const confirmation = page.getByTestId("confirmation-card");
    await expect(confirmation).toBeVisible({ timeout: 20_000 });
    await confirmation.getByRole("button", { name: "Deny" }).click();

    await expect(page.getByTestId("assistant-transcript")).toContainText("declined", {
      timeout: 20_000,
    });
    await expect(metricValue(page, "Disabled")).toHaveText("0");
  });
});
