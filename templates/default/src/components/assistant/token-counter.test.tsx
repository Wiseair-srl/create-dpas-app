import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMessageStore, type TokenUsage } from "@/agent/experience/message-store";
import { formatTokens } from "@/lib/format";
import { TokenCounter } from "./token-counter";

/**
 * The counter's job is to be honest about cost. The two failure modes worth
 * guarding are showing a number nobody measured, and showing one model call
 * when a turn made several round-trips.
 */

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  reportedSteps: 1,
});

const add = (...amounts: TokenUsage[]) => {
  for (const amount of amounts) useMessageStore.getState().addUsage(amount);
};

const counter = () => screen.getByTestId("token-counter");
/** The hover panel: in the DOM at all times, shown by CSS on hover or focus. */
const detail = () => screen.getByTestId("token-counter-detail");
/** The collapsed badge — one number, and the label a screen reader gets. */
const badge = () => screen.getByRole("button");

beforeEach(() => useMessageStore.getState().reset());
afterEach(cleanup);

describe("token counter", () => {
  it("stays absent until a provider actually reports usage", () => {
    render(<TokenCounter />);
    // The guided demo runs no model at all, and some providers report no
    // usage. Neither is "0 tokens".
    expect(screen.queryByTestId("token-counter")).toBeNull();
  });

  it("shows the two directions and never their sum", () => {
    add(usage(400, 30));
    render(<TokenCounter />);

    // Output bills at several times input, so 430 prices nothing. The badge
    // shows the split; the total is available in the panel.
    expect(badge().textContent).toBe("400↑ · 30↓");
    expect(badge().textContent).not.toContain("430");
    expect(detail().textContent).toContain("430");
  });

  it("compacts each figure once it stops being read digit by digit", () => {
    add(usage(48_200, 1_240));
    render(<TokenCounter />);
    expect(badge().textContent).toBe("48.2k↑ · 1,240↓");
  });

  it("marks reasoning and cached input as subsets of the lines above", () => {
    // Reasoning bills AS output and cached input AS input, so both are already
    // counted. The panel has to say so or someone will add them.
    add({ ...usage(400, 30), cachedInputTokens: 120, reasoningTokens: 18 });
    render(<TokenCounter />);

    expect(detail().textContent).toContain("of which cached");
    expect(detail().textContent).toContain("of which reasoning");
    // And the badge still reports the parents, not parents plus subsets.
    expect(badge().textContent).toBe("400↑ · 30↓");
    expect(badge().getAttribute("aria-label")).toContain("120 of the input was cached");
    expect(badge().getAttribute("aria-label")).toContain("18 of the output was reasoning");
  });

  it("omits a subset the provider never reported", () => {
    add(usage(400, 30));
    render(<TokenCounter />);
    // Absent is not zero, so there is no "0" row inviting a wrong conclusion.
    expect(detail().textContent).not.toContain("of which");
  });

  it("adds up every step of a turn, not just the last model call", () => {
    useMessageStore.getState().beginTurnUsage();
    // One agentic turn: filter, read, act — each a step-request that resends
    // the conversation, which is most of what the turn costs.
    add(usage(400, 30), usage(700, 25), usage(950, 60));

    render(<TokenCounter />);
    expect(counter().getAttribute("data-input-tokens")).toBe("2050");
    expect(counter().getAttribute("data-output-tokens")).toBe("115");
    expect(detail().textContent).toContain("3 model steps");
  });

  it("keeps the conversation total while the turn figure restarts", () => {
    useMessageStore.getState().beginTurnUsage();
    add(usage(400, 30));
    useMessageStore.getState().beginTurnUsage();
    add(usage(120, 10));

    render(<TokenCounter />);
    // The conversation keeps both turns; the turn readout shows only the second.
    expect(counter().getAttribute("data-input-tokens")).toBe("520");
    expect(badge().getAttribute("aria-label")).toContain("Last turn: 120 input, 10 output");
    expect(detail().textContent).toContain("last turn");
  });

  it("names the turn as current while a run is in flight", () => {
    useMessageStore.getState().setRunning("live");
    useMessageStore.getState().beginTurnUsage();
    add(usage(80, 12));

    render(<TokenCounter />);
    expect(detail().textContent).toContain("this turn");
    expect(badge().getAttribute("aria-label")).toContain("This turn: 80 input, 12 output");
  });

  it("clears with the conversation", () => {
    add(usage(400, 30));
    useMessageStore.getState().reset();
    render(<TokenCounter />);
    expect(screen.queryByTestId("token-counter")).toBeNull();
  });

  it("spells the counts out for a screen reader", () => {
    add(usage(400, 30));
    render(<TokenCounter />);
    // A panel revealed by hover reaches nobody who cannot hover, so the badge
    // carries the whole reading as its label.
    expect(badge().getAttribute("aria-label")).toBe(
      "Tokens this conversation: 400 input, 30 output, 430 total across 1 model step." +
        " Last turn: 400 input, 30 output.",
    );
  });
});

describe("token formatting", () => {
  it("stays exact while the number is still read digit by digit", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(842)).toBe("842");
  });

  it("goes compact once it stops being", () => {
    expect(formatTokens(48_200)).toBe("48.2k");
    expect(formatTokens(124_000)).toBe("124k");
    expect(formatTokens(2_450_000)).toBe("2.45M");
  });
});
