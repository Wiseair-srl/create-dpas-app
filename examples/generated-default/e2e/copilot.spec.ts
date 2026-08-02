import { expect, test } from "@playwright/test";

import { openPending } from "./helpers";

/**
 * The LIVE pipeline, end to end, with a scripted model: composer → host
 * protocol → Mastra → per-request composition → client-tool suspension →
 * Agent Surface execution → oRPC → reconciliation.
 *
 * This is the same code path a real API key exercises. Only the model is
 * scripted, which is what lets CI run it with no credential at all.
 */
test.describe("the copilot", () => {
  test.beforeEach(async ({ page }) => {
    await openPending(page);
    await page.getByRole("button", { name: "Open copilot" }).click();
    await expect(page.getByText("How can I help?")).toBeVisible();
  });

  test("drives both planes and grounds its answer in what it read", async ({ page }) => {
    await page.getByRole("button", { name: "What's overdue?" }).click();

    // The DOMAIN read ran on the server…
    await expect(page.getByText("domain:collections-aging")).toBeVisible({ timeout: 20_000 });
    // …and the VIEW action ran in this tab, against the live screen.
    await expect(page.getByText("view:invoices.pending.setFilters")).toBeVisible();

    // The table actually narrowed — the agent has no privileged channel into
    // the UI, so this is the same state a human filtering would produce.
    await expect(page.locator("[data-invoice-row]")).toHaveCount(7);
    await expect(page).toHaveURL(/due=overdue/);

    // The answer matches the KPI, because both come from one function.
    await expect(page.getByText(/7 invoices are overdue, worth €102,600/)).toBeVisible();
  });

  test("keeps reasoning out of the answer", async ({ page }) => {
    await page.getByRole("button", { name: "What's overdue?" }).click();
    await expect(page.getByText(/Thought/)).toBeVisible({ timeout: 20_000 });

    const thread = page.getByText(/invoices are overdue/);
    await expect(thread).toBeVisible();
    // The channel marker some models leak never reaches the visible answer.
    await expect(page.locator("body")).not.toContainText("<|channel|>");
  });

  test("survives a reload — the thread is persisted, not held in memory", async ({ page }) => {
    await page.getByRole("button", { name: "What's overdue?" }).click();
    await expect(page.getByText(/invoices are overdue/)).toBeVisible({ timeout: 20_000 });

    // Wait for the TURN to end, not just for its text to appear. The answer
    // renders from stream deltas, so it is on screen while the step that
    // produced it is still running and still unpersisted — reloading here
    // would test how much had streamed by the time this line ran. The composer
    // swaps Stop back for Send only once the last step-finish landed, and the
    // server persists before it writes that frame.
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    await page.reload();
    // The dock's open state is persisted, so it comes back open. The
    // CONVERSATION is not — the message store is module-scoped, which is the
    // point: the transcript has to be re-read from the server, and this is the
    // test that it can be.
    await expect(page.getByRole("complementary", { name: "Copilot" })).toBeVisible();
    await expect(page.getByText("How can I help?")).toBeVisible();

    await page.getByRole("button", { name: "Recent threads" }).click();
    // The store keeps every thread this suite created, so take the newest
    // rather than assuming there is only one.
    await page.getByRole("menuitem").first().click();

    // Both halves come back: what was asked, and what the tools answered.
    // Matched on the ANSWER's exact figures — a looser pattern also matches the
    // question, which would let a thread that restored only the user's message
    // pass.
    await expect(page.getByText(/7 invoices are overdue, worth €102,600/)).toBeVisible();
    await expect(page.getByText("domain:collections-aging")).toBeVisible();
  });

  test("keeps what a thread cost when the rail moves away and back", async ({ page }) => {
    await page.getByRole("button", { name: "What's overdue?" }).click();
    await expect(page.getByText(/invoices are overdue/)).toBeVisible({ timeout: 20_000 });
    // As above: wait for the turn to END, so the usage has been persisted.
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    const meter = page.getByRole("button", { name: /tokens used in this conversation/ });
    // Read the figure off the label rather than asserting a constant: the
    // scripted model's per-request usage is its business, and a test that
    // pins it breaks every time the scenario grows a step.
    const spent = await meter.getAttribute("aria-label");
    expect(spent).toMatch(/[1-9]/);

    // A fresh thread has spent nothing, and the counter says so by not being
    // there at all — a zero would claim a measurement nobody made.
    await page.getByRole("button", { name: "New thread" }).click();
    await expect(page.getByText("How can I help?")).toBeVisible();
    await expect(meter).toBeHidden();

    // Back to the first thread. Token counts are the one thing here that
    // cannot be re-derived from the transcript, so this is the assertion that
    // they were written down rather than held in the tab that spent them.
    await page.getByRole("button", { name: "Recent threads" }).click();
    await page.getByRole("menuitem").first().click();
    await expect(page.getByText(/7 invoices are overdue, worth €102,600/)).toBeVisible();
    await expect(meter).toHaveAttribute("aria-label", spent!);
  });
});
