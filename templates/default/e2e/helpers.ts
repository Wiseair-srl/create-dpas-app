import { expect, type Page } from "@playwright/test";

/** Restore the seeded ledger, then wait for the screen to reflect it. */
export async function resetLedger(page: Page) {
  await page.request.post("/api/demo/reset");
}

export async function openPending(page: Page) {
  await resetLedger(page);
  await page.goto("/receivables/pending");
  await expect(page.getByRole("heading", { name: "Pending invoices" })).toBeVisible();
  await expect(page.locator("[data-invoice-row]").first()).toBeVisible();
}

export async function switchRole(page: Page, role: "analyst" | "controller") {
  await page.request.post("/api/session", { data: { role } });
  await page.reload();
}

/** The seeded ledger's headline figures, as the screens format them. */
export const LEDGER = {
  outstanding: "€200,500",
  overdue: "€102,600",
  overdueCount: 7,
  pendingRows: 13,
} as const;
