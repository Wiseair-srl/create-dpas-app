import { expect, test } from "@playwright/test";

/** The assistant as a full-screen sheet on a phone-sized viewport. */
test.describe("mobile assistant", () => {
  test("opens as a sheet, runs the demo, confirmation stays usable", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Device operations" })).toBeVisible();

    await page.getByRole("button", { name: "Open assistant" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByTestId("assistant-panel")).toBeVisible();

    await sheet.getByTestId("run-guided-demo").click();
    const confirmation = sheet.getByTestId("confirmation-card");
    await expect(confirmation).toBeVisible({ timeout: 20_000 });
    await expect(confirmation.getByRole("button", { name: /Approve/ })).toBeVisible();
    await confirmation.getByRole("button", { name: "Deny" }).click();
    await expect(sheet.getByTestId("assistant-transcript")).toContainText("declined", {
      timeout: 15_000,
    });

    // Close and get back to the table.
    await sheet.getByRole("button", { name: "Close assistant" }).click();
    await expect(page.getByRole("heading", { name: "Device operations" })).toBeVisible();
  });
});
