import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { MARKDOWN_COMPONENTS } from "./markdown-table";

/**
 * The column tagging reads react-markdown's hast tree, so these go through the
 * real pipeline rather than a hand-built node — the shape is the thing under
 * test. What breaks without them: a date column right-aligning as if it were a
 * number, or an amount column staying left-aligned like prose.
 */
const renderMarkdown = (markdown: string) => {
  const { container } = render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {markdown}
    </ReactMarkdown>,
  );
  const table = container.querySelector("table");
  if (!table) throw new Error("no table rendered");
  return table;
};

const numericColumns = (table: Element) =>
  [...table.classList]
    .filter((c) => c.startsWith("chat-t-num-"))
    .map((c) => Number(c.slice("chat-t-num-".length)))
    .sort((a, b) => a - b);

describe("markdown tables", () => {
  it("scrolls inside its own box", () => {
    const table = renderMarkdown("| A |\n| --- |\n| 1 |");
    expect(table.parentElement?.className).toBe("chat-table");
  });

  it("tags amount and id columns, leaving dates and labels alone", () => {
    const table = renderMarkdown(
      [
        "| Transaction ID | Booking date | Amount (€) | Category |",
        "| --- | --- | --- | --- |",
        "| 15106 | 2026-07-30 | 15,000 | b2b_inflow |",
        "| 14711 | 2026-07-28 | 762.48 | b2b_inflow |",
        "| 15102 | 2026-07-29 | (1.234,00) | — |",
      ].join("\n"),
    );
    expect(numericColumns(table)).toEqual([1, 3]);
  });

  it("keeps a column left-aligned when any cell is text", () => {
    const table = renderMarkdown(
      ["| Amount |", "| --- |", "| 1,200 |", "| not invoiced |"].join("\n"),
    );
    expect(numericColumns(table)).toEqual([]);
  });

  it("ignores blanks and dashes rather than counting them as text", () => {
    const table = renderMarkdown(
      ["| Paid | Note |", "| --- | --- |", "| 900 | ok |", "| — | ok |", "|  | ok |"].join("\n"),
    );
    expect(numericColumns(table)).toEqual([1]);
  });
});
