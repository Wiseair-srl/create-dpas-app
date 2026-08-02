import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useMessageStore, type TokenUsage } from "./experience/message-store";
import { TokenMeter } from "./token-meter";

/**
 * The meter is the only place the user is told what a conversation cost, so
 * the failure that matters is a figure that looks measured and is not. These
 * drive the real component through the real hover card: seed the store the way
 * a turn would, then read what the panel actually says.
 */

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reportedSteps: 1,
  ...over,
});

/** Opens the hover card the way a pointer does, and waits for the portal. */
async function openPanel() {
  const user = userEvent.setup();
  await user.hover(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("Token usage")).toBeTruthy());
}

/** One scope's rows, `{ label: value }`, with the subset marker stripped. */
function rowsOf(scope: string): Record<string, string> {
  const section = screen.getByRole("region", { name: scope });
  return Object.fromEntries(
    Array.from(section.querySelectorAll("dt")).map((dt) => [
      text(dt).replace("↳", "").trim(),
      text(dt.parentElement?.querySelector("dd")),
    ]),
  );
}

/**
 * Visible text, joined across element boundaries — plain `textContent` runs
 * adjacent spans together ("6,408· 90%") and would make these assertions read
 * nothing like the panel does.
 */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  return Array.from(el.childNodes)
    .map((node) => (node.nodeType === 3 ? (node.textContent ?? "") : text(node as Element)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const scopeText = (scope: string) => text(screen.getByRole("region", { name: scope }));

describe("TokenMeter", () => {
  // The store is module-scoped and this project does not auto-cleanup, so both
  // halves have to be reset by hand or a leftover chip answers the next query.
  beforeEach(() => useMessageStore.getState().newThread());
  afterEach(cleanup);

  it("renders nothing until a turn has actually been measured", () => {
    const { container } = render(<TokenMeter />);

    expect(container.firstChild).toBeNull();
  });

  it("stays hidden through a turn the provider reported no usage for", () => {
    useMessageStore.getState().setRunning("live");
    const { container } = render(<TokenMeter />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the conversation total, compact, with the full figure for readers", () => {
    useMessageStore.getState().addUsage(usage({ inputTokens: 11_000, totalTokens: 12_431 }));
    render(<TokenMeter />);

    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("12.4k");
    expect(chip.getAttribute("aria-label")).toBe("12,431 tokens used in this conversation");
  });

  it("breaks the spend down by scope on hover", async () => {
    const store = useMessageStore.getState();
    // Turn one, then a second turn — so the two scopes cannot both be read off
    // the same numbers.
    store.addUsage(usage({ inputTokens: 3000, outputTokens: 227, totalTokens: 3227 }));
    store.beginTurnUsage();
    store.addUsage(
      usage({
        inputTokens: 7120,
        cachedInputTokens: 6408,
        outputTokens: 1084,
        reasoningTokens: 542,
        totalTokens: 8204,
        reportedSteps: 3,
      }),
    );

    render(<TokenMeter />);
    await openPanel();

    // Subsets carry their share of the row above, so the column cannot be
    // mistaken for a sum.
    expect(rowsOf("Last turn")).toEqual({
      Input: "7,120",
      "from cache": "6,408 · 90%",
      Output: "1,084",
      reasoning: "542 · 50%",
    });
    expect(scopeText("Last turn")).toContain("8,204");
    expect(scopeText("Last turn")).toContain("3 model steps");

    // The conversation carries the subsets forward from whichever turns
    // reported them — turn one said nothing about caching, and that silence is
    // not a zero, so the 6,408 stands and its share is taken over all input.
    expect(rowsOf("Conversation")).toEqual({
      Input: "10,120",
      "from cache": "6,408 · 63%",
      Output: "1,311",
      reasoning: "542 · 41%",
    });
    expect(scopeText("Conversation")).toContain("11,431");
    expect(scopeText("Conversation")).toContain("4 model steps");
  });

  it("omits subsets the provider never reported, rather than showing a zero", async () => {
    useMessageStore
      .getState()
      .addUsage(usage({ inputTokens: 3000, outputTokens: 227, totalTokens: 3227 }));

    render(<TokenMeter />);
    await openPanel();

    expect(rowsOf("Last turn")).toEqual({ Input: "3,000", Output: "227" });
  });

  it("says the running turn is unreported rather than claiming it cost nothing", async () => {
    const store = useMessageStore.getState();
    store.addUsage(usage({ totalTokens: 3227 }));
    store.beginTurnUsage();
    store.setRunning("live");

    render(<TokenMeter />);
    await openPanel();

    const turn = screen.getByRole("region", { name: "This turn" });
    expect(within(turn).getByText("Nothing reported yet.")).toBeTruthy();
    // No total in the header either — there is nothing to total.
    expect(text(turn)).toBe("This turn Nothing reported yet.");
  });
});
