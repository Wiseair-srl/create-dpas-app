import { expect, test } from "@playwright/test";

import { LEDGER, openPending, switchRole } from "./helpers";

test.describe("the receivables screens", () => {
  test.beforeEach(async ({ page }) => {
    await openPending(page);
  });

  test("loads the seeded ledger with honest KPIs", async ({ page }) => {
    await expect(page.getByText(LEDGER.outstanding)).toBeVisible();
    await expect(page.getByText(LEDGER.overdue)).toBeVisible();
    await expect(page.getByText(`${LEDGER.overdueCount} invoices`)).toBeVisible();
    await expect(page.locator("[data-invoice-row]")).toHaveCount(LEDGER.pendingRows);
  });

  test("narrowing is URL-synced, so a filtered view is shareable", async ({ page }) => {
    await page.getByRole("combobox", { name: "Filter by due status" }).click();
    await page.getByRole("option", { name: "Overdue only" }).click();

    await expect(page.locator("[data-invoice-row]")).toHaveCount(LEDGER.overdueCount);
    // The URL is the source of truth — that is what makes an agent-narrowed
    // view something the user can bookmark.
    await expect(page).toHaveURL(/due=overdue/);

    await page.reload();
    await expect(page.locator("[data-invoice-row]")).toHaveCount(LEDGER.overdueCount);
  });

  test("sorting by amount sorts by value, not by the formatted string", async ({ page }) => {
    await page.getByRole("button", { name: "Amount", exact: true }).click();
    const first = page.locator("[data-invoice-row]").first();
    // Ascending puts €6,150 first. A string sort would put €12,400 there,
    // because "1" < "6".
    await expect(first).toContainText("€6,150");
  });

  test("the chase dialog opens on the invoice you clicked", async ({ page }) => {
    const row = page.locator("[data-invoice-row]").first();
    const reference = (await row.locator("td").first().innerText()).trim();
    await row.getByRole("button", { name: "Chase" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(reference);
  });

  test("recording a chase persists through a reload", async ({ page }) => {
    const row = page.locator("[data-invoice-row]").first();
    await row.getByRole("button", { name: "Chase" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Note").fill("Promised payment on Friday.");
    await dialog.getByRole("button", { name: "Record reminder" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.locator("[data-invoice-row]").first().getByRole("button", { name: "Chase" }).click();
    await expect(page.getByRole("dialog")).toContainText("Promised payment on Friday.");
  });

  test("every screen reaches every other one", async ({ page }) => {
    await page.getByRole("link", { name: "All invoices" }).click();
    await expect(page.getByRole("heading", { name: "All invoices" })).toBeVisible();
    // The full ledger includes drafts and paid rows, so it is strictly larger.
    await expect(page.locator("[data-invoice-row]")).toHaveCount(24);

    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.locator("[data-client-row]")).toHaveCount(5);
  });
});

test.describe("identity", () => {
  test("an analyst keeps every read and loses the write affordances", async ({ page }) => {
    await openPending(page);
    await page.getByRole("checkbox", { name: /^Select / }).first().check();
    await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible();

    await switchRole(page, "analyst");
    await expect(page.locator("[data-invoice-row]")).toHaveCount(LEDGER.pendingRows);
    await page.getByRole("checkbox", { name: /^Select / }).first().check();
    // Reading is not an authority question; changing the ledger is.
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

    await switchRole(page, "controller");
  });
});
