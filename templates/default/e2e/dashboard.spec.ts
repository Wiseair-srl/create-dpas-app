import { expect, test } from "@playwright/test";
import { metricValue, openDashboard, resetData } from "./helpers";

test.describe("dashboard fundamentals", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
  });

  test("loads with real seeded data and honest metrics", async ({ page }) => {
    await expect(metricValue(page, "Devices")).toHaveText("24");
    await expect(metricValue(page, "Online")).toHaveText("17");
    await expect(metricValue(page, "Offline")).toHaveText("7");
    await expect(page.getByRole("row", { name: /milan-duomo-01/ })).toBeVisible();
  });

  test("filters work manually and the table follows", async ({ page }) => {
    await page.getByRole("combobox", { name: "Filter by status" }).click();
    await page.getByRole("option", { name: "Offline" }).click();
    await page.getByRole("combobox", { name: "Filter by city" }).click();
    await page.getByRole("option", { name: "Milan" }).click();

    await expect(page.locator("[data-device-row]")).toHaveCount(3);
    await expect(page.getByRole("row", { name: /milan-navigli-01/ })).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).first().click();
    await expect(page.locator("[data-device-row]")).toHaveCount(24);
  });

  test("sorting cycles asc → desc → off with aria-sort", async ({ page }) => {
    const nameHeader = page.getByRole("columnheader", { name: "Name" });
    await nameHeader.getByRole("button").click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await nameHeader.getByRole("button").click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("[data-device-row]").first()).toContainText("turin-vanchiglia-01");
    await nameHeader.getByRole("button").click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "none");
  });

  test("drawer opens with details, closes with Escape, and restores focus", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Open milan-duomo-01 details" });
    await opener.click();
    await expect(page.getByRole("dialog")).toContainText("milan-duomo-01");
    await expect(page.getByRole("dialog")).toContainText("Firmware");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    // Radix returns focus to the trigger.
    await expect(opener).toBeFocused();
  });

  test("keyboard: row selection is reachable and operable", async ({ page }) => {
    const checkbox = page.getByRole("checkbox", { name: "Select milan-duomo-01" });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("dark mode toggles and persists the class", async ({ page }) => {
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});
