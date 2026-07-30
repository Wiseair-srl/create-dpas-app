import { expect, type Page } from "@playwright/test";

/** Restore seeded data and wait until the dashboard reflects it. */
export async function resetData(page: Page) {
  await page.getByRole("button", { name: "Reset data" }).click();
  await expect(metricValue(page, "Disabled")).toHaveText("0");
}

export function metricValue(page: Page, label: string) {
  return page.locator(`[data-metric="${label}"] p`);
}

export async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  // The dashboard mounts client-only; wait for real content.
  await expect(page.getByRole("heading", { name: "Device operations" })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
}

export async function switchRole(page: Page, label: "Olivia — operator" | "Vik — viewer") {
  await page.getByRole("combobox", { name: "Demo identity" }).click();
  await page.getByRole("option", { name: label }).click();
  await expect(page.getByRole("combobox", { name: "Demo identity" })).toContainText(
    label.split(" — ")[0]!,
  );
}

export const MILAN_OFFLINE_NAMES = ["milan-navigli-01", "milan-isola-02", "milan-bovisa-01"];
