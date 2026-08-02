import { describe, expect, it } from "vitest";

import type { TokenUsage } from "./experience/message-store";
import {
  formatCompact,
  formatSteps,
  hasMeasuredUsage,
  sharePercent,
  usageRows,
} from "./token-usage";

/**
 * The counter's whole claim is that every figure on it was reported by the
 * provider. These guard the two ways that claim breaks quietly: an omitted
 * optional subset rendered as a measured `0`, and a scope with nothing
 * measured at all rendered as a spend of zero.
 */

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reportedSteps: 1,
  ...over,
});

describe("formatCompact", () => {
  it("keeps small counts exact", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(947)).toBe("947");
    expect(formatCompact(999)).toBe("999");
  });

  it("drops to one decimal of k, without a false-precision trailing zero", () => {
    expect(formatCompact(1000)).toBe("1k");
    expect(formatCompact(12_431)).toBe("12.4k");
    expect(formatCompact(99_949)).toBe("99.9k");
  });

  it("drops the decimal past 100k, where it is noise", () => {
    expect(formatCompact(123_400)).toBe("123k");
    expect(formatCompact(999_499)).toBe("999k");
  });

  it("rolls over to M rather than saying 1000k", () => {
    expect(formatCompact(999_500)).toBe("1M");
    expect(formatCompact(1_240_000)).toBe("1.2M");
  });
});

describe("usageRows", () => {
  it("omits cached input entirely when the provider said nothing about it", () => {
    const rows = usageRows(usage({ inputTokens: 7120, outputTokens: 1084 }));

    expect(rows.map((r) => r.label)).toEqual(["Input", "Output"]);
    expect(rows.some((r) => r.value === "0")).toBe(false);
  });

  it("reports a cache miss the provider DID measure", () => {
    const rows = usageRows(usage({ inputTokens: 7120, cachedInputTokens: 0 }));

    expect(rows[1]).toMatchObject({ label: "from cache", value: "0", subset: true, share: "0%" });
  });

  it("shows each subset indented, with its share of the row above", () => {
    const rows = usageRows(
      usage({
        inputTokens: 7120,
        cachedInputTokens: 6400,
        outputTokens: 1084,
        reasoningTokens: 542,
      }),
    );

    expect(rows).toEqual([
      { label: "Input", value: "7,120" },
      { label: "from cache", value: "6,400", subset: true, share: "90%" },
      { label: "Output", value: "1,084" },
      { label: "reasoning", value: "542", subset: true, share: "50%" },
    ]);
  });

  it("leaves out a share that would divide by zero", () => {
    const rows = usageRows(usage({ inputTokens: 0, cachedInputTokens: 0 }));

    expect(rows[1]).not.toHaveProperty("share");
  });
});

describe("hasMeasuredUsage", () => {
  it("is false when no step reported, so the counter can hide", () => {
    expect(hasMeasuredUsage(usage({ reportedSteps: 0 }))).toBe(false);
  });

  it("is true on a measured turn that genuinely cost nothing observable", () => {
    expect(hasMeasuredUsage(usage({ reportedSteps: 1 }))).toBe(true);
  });
});

describe("sharePercent / formatSteps", () => {
  it("rounds to whole percent", () => {
    expect(sharePercent(1, 3)).toBe("33%");
    expect(sharePercent(2, 3)).toBe("67%");
  });

  it("singularises one step", () => {
    expect(formatSteps(1)).toBe("1 model step");
    expect(formatSteps(3)).toBe("3 model steps");
  });
});
