import { expect, test } from "@playwright/test";
import { MILAN_OFFLINE_NAMES, metricValue, openDashboard, resetData } from "./helpers";

test.describe("guided deterministic demo (golden scenario)", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
  });

  test("approve path: filters, selection, confirmation, mutation, reconciliation, trace", async ({
    page,
  }) => {
    await page.getByTestId("run-guided-demo").click();

    // The demo applies real filters — the toolbar reflects the selection.
    await expect(page.getByText("3 selected")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-device-row]")).toHaveCount(3);

    // The confirmation card names the exact devices, count, actor and expiry.
    const confirmation = page.getByTestId("confirmation-card");
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await expect(confirmation).toContainText("disable 3 devices");
    for (const name of MILAN_OFFLINE_NAMES) {
      await expect(confirmation).toContainText(name);
    }
    await expect(confirmation).toContainText("Acting as Olivia Operator");
    await expect(confirmation).toContainText("single-use");
    await expect(confirmation).toContainText(/expires in \d+s/);

    await confirmation.getByRole("button", { name: /Approve — disable 3/ }).click();

    // Reconciliation through the normal data layer: badges + metrics update.
    await expect(page.locator("[data-device-row]", { hasText: "Disabled" })).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(metricValue(page, "Disabled")).toHaveText("3");

    // The assistant reports the VERIFIED outcome.
    await expect(page.getByTestId("assistant-transcript")).toContainText(
      "the server disabled 3",
      { timeout: 15_000 },
    );

    // The domain tool card settled ok, visibly distinguished from view cards.
    const domainCard = page.locator('[data-testid="tool-card"][data-plane="domain"]');
    await expect(domainCard).toHaveAttribute("data-status", "ok");
    await expect(domainCard).toContainText("DOMAIN");
    await expect(
      page.locator('[data-testid="tool-card"][data-plane="view"]').first(),
    ).toContainText("VIEW");

    // No model ran, so there is no token count — and none is invented. A
    // confident "0 in · 0 out" here would be a measurement nobody took.
    await expect(page.getByTestId("token-counter")).toHaveCount(0);

    // The inspector holds the correlated trace across lanes.
    await page.getByRole("tab", { name: "Inspector" }).click();
    await page.getByRole("tab", { name: "timeline" }).click();
    const timeline = page.getByTestId("inspector-timeline");
    await expect(timeline.locator('li[data-lane="surface"]').first()).toBeVisible();
    await expect(timeline.locator('li[data-lane="host"]').first()).toBeVisible();
    // The authoritative server record reaches the trace even without a model.
    await expect(
      timeline.locator('li[data-lane="domain"]', { hasText: "devices.disabled" }),
    ).toBeVisible();
    await expect(timeline).toContainText("domain:devices.disable");
    await expect(timeline).toContainText("confirmation-resolved");

    // Catalog: the contextual reference shows its locked binding.
    await page.getByRole("tab", { name: "catalog" }).click();
    const catalog = page.getByTestId("inspector-catalog");
    await expect(catalog).toContainText("domain:devices.disable");
    await expect(catalog).toContainText("deviceIds (locked)");
    await expect(catalog).toContainText("domain:devices.list");
  });

  test("deny path: no mutation, honest report", async ({ page }) => {
    await page.getByTestId("run-guided-demo").click();

    const confirmation = page.getByTestId("confirmation-card");
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await confirmation.getByRole("button", { name: "Deny" }).click();

    await expect(page.getByTestId("assistant-transcript")).toContainText("declined", {
      timeout: 15_000,
    });
    await expect(metricValue(page, "Disabled")).toHaveText("0");
    await expect(page.locator("[data-device-row]", { hasText: "Disabled" })).toHaveCount(0);
    // The failed domain call is shown as such — no silent swallowing.
    const domainCard = page.locator('[data-testid="tool-card"][data-plane="domain"]');
    await expect(domainCard).toHaveAttribute("data-status", "error");
    await expect(domainCard).toContainText("CONFIRMATION_INVALID");
  });
});
