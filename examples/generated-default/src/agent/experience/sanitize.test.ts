import { describe, expect, it } from "vitest";
import { isOnlyControlNoise, sanitizeModelText, tidyModelText } from "./sanitize";

/**
 * Some models stream their channel format into visible text. The transcript
 * should show the answer, not the plumbing — but ordinary prose (including
 * angle brackets and the word "thought" in a sentence) must survive intact.
 */
describe("model text sanitizing", () => {
  it("removes a whole channel header, name included", () => {
    expect(sanitizeModelText("<|channel|>final<|message|>Done.")).toBe("Done.");
    expect(sanitizeModelText("<|channel|>analysis Filter to Milan.")).toBe("Filter to Milan.");
    expect(sanitizeModelText("<channel|>I filtered the table.")).toBe("I filtered the table.");
  });

  it("removes stray control tokens", () => {
    expect(sanitizeModelText("<|start|>assistant<|end|>")).toBe("assistant");
    expect(sanitizeModelText("Done.<|return|>")).toBe("Done.");
  });

  it("drops a bare channel label on its own line", () => {
    expect(tidyModelText("thought\nFirst, set the filters.")).toBe("First, set the filters.");
    expect(tidyModelText("analysis\n\nPlan: filter then select.")).toBe(
      "Plan: filter then select.",
    );
  });

  it("leaves ordinary prose alone — including the word in a sentence", () => {
    const prose = "My thought is that `d-mi-03` is **offline**, and 3 < 5 > 1.";
    expect(sanitizeModelText(prose)).toBe(prose);
  });

  it("preserves markdown so it can still be rendered", () => {
    const md = "Disabled **turin-vanchiglia-01** (`d-to-03`).";
    expect(sanitizeModelText(md)).toBe(md);
  });

  it("recognizes a chunk that is only control noise", () => {
    expect(isOnlyControlNoise("<|channel|>")).toBe(true);
    expect(isOnlyControlNoise("thought\n")).toBe(true);
    expect(isOnlyControlNoise("Done.")).toBe(false);
    expect(isOnlyControlNoise("")).toBe(false);
  });

  it("collapses the blank lines stripping leaves behind", () => {
    expect(tidyModelText("thought\n\n\n\nAnswer.")).toBe("Answer.");
  });
});
