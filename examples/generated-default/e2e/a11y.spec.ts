import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openDashboard, resetData } from "./helpers";

/**
 * Automated accessibility scans on the primary screens and the two dialog
 * states. Axe cannot prove accessibility, but it must find no violations.
 */

async function scan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

test.describe("accessibility", () => {
  test("dashboard (light and dark) has no violations", async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
    expect((await scan(page)).violations).toEqual([]);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect((await scan(page)).violations).toEqual([]);
    await page.getByRole("button", { name: "Switch to light mode" }).click();
  });

  test("device drawer dialog has no violations", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Open milan-duomo-01 details" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("confirmation card during the demo has no violations", async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
    await page.getByTestId("run-guided-demo").click();
    await expect(page.getByTestId("confirmation-card")).toBeVisible({ timeout: 15_000 });
    expect((await scan(page)).violations).toEqual([]);
    await page.getByTestId("confirmation-card").getByRole("button", { name: "Deny" }).click();
  });

  test("architecture page has no violations", async ({ page }) => {
    await page.goto("/architecture");
    await expect(
      page.getByRole("heading", { name: "The Dual-Plane Agent Stack, in this app" }),
    ).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });
});
