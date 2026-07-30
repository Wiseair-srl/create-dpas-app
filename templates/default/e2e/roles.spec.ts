import { expect, test } from "@playwright/test";
import { openDashboard, resetData, switchRole } from "./helpers";

test.describe("identity and authority", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await resetData(page);
  });

  test.afterEach(async ({ page }) => {
    await switchRole(page, "Olivia — operator");
  });

  test("a viewer keeps read access but loses every mutation affordance", async ({ page }) => {
    await switchRole(page, "Vik — viewer");

    // Human path: no Disable button even with a selection.
    await page.getByRole("checkbox", { name: "Select milan-navigli-01" }).check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);

    // Agent path: the contextual capability is ABSENT (authority hides),
    // and the inspector says so explicitly.
    await page.getByRole("tab", { name: "Inspector" }).click();
    const catalog = page.getByTestId("inspector-catalog");
    await expect(
      catalog.getByText("None on this surface for the current identity", { exact: false }),
    ).toBeVisible();
    await expect(catalog).not.toContainText("deviceIds (locked)");

    // Domain plane: only reads remain visible for this actor.
    await expect(catalog).toContainText("domain:devices.list");
  });

  test("the demo run as viewer stops at the hidden capability and explains why", async ({
    page,
  }) => {
    await switchRole(page, "Vik — viewer");
    await page.getByTestId("run-guided-demo").click();

    await expect(page.getByTestId("assistant-transcript")).toContainText(
      "hidden for the viewer role",
      { timeout: 20_000 },
    );
    // Selection happened (view plane is permitted) but nothing was disabled.
    await expect(page.getByText("3 selected")).toBeVisible();
    await expect(page.locator("[data-device-row]", { hasText: "Disabled" })).toHaveCount(0);
  });
});
