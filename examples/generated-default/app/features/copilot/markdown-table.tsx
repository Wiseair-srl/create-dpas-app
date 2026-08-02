import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Tables are a primary answer format for this copilot — "show me the inflows"
 * comes back as one — so they get a real renderer instead of default markdown
 * furniture. Two things happen here that CSS alone cannot do; the rest of the
 * look lives in `.chat-table` / `.chat-md table` in global.css.
 *
 * 1. The table is wrapped in its own scroll box, so a wide result scrolls
 *    inside the message instead of stretching the thread (the dock is narrow).
 * 2. Columns whose body cells are all numbers are detected and tagged, which
 *    global.css turns into a right-aligned, tabular-figure column — header
 *    included. GFM lets the model declare this itself (`|---:|`) but it almost
 *    never does, and left-aligned money is the single thing that makes a
 *    wide table read as a raw dump. An explicit GFM alignment still wins:
 *    react-markdown writes it as an inline style on the cell.
 */

/**
 * The hast nodes we walk. hast's own types aren't resolvable from this package
 * (they ship with react-markdown, not hoisted), and this is all we read.
 */
type MdNode = {
  type: string;
  tagName?: string | undefined;
  value?: string | undefined;
  children?: MdNode[] | undefined;
};

type TableProps = ComponentPropsWithoutRef<"table"> & { node?: MdNode | undefined };

/** Cells that say nothing either way — they neither prove nor break a column. */
const BLANK = /^(?:[-–—]|n\/?a|null|none)?$/i;

/**
 * Money, counts, percentages: digits with optional sign, currency, thousands
 * and decimal separators, and accounting parentheses. Deliberately rejects
 * anything with an inner dash so ISO dates (2026-07-30) stay left-aligned with
 * the text they are.
 */
const NUMERIC = /^[+-]?\s*\(?\s*[€$£]?\s*\d[\d.,'\s]*\s*[%€$£]?\s*\)?$/;

/** global.css carries one right-align rule per column; past this, columns stay left. */
const MAX_TAGGED_COLUMN = 10;

function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

const childrenNamed = (node: MdNode | undefined, tagName: string): MdNode[] =>
  (node?.children ?? []).filter((child) => child.tagName === tagName);

/**
 * Column indices (0-based) whose every non-blank body cell is a number. A
 * single text cell disqualifies the column, so a "Notes" column that happens to
 * start with two numeric rows doesn't flip alignment mid-stream and back.
 */
function numericColumns(table: MdNode): number[] {
  const rows = childrenNamed(table, "tbody").flatMap((body) => childrenNamed(body, "tr"));
  const numeric = new Set<number>();
  const text = new Set<number>();
  for (const row of rows) {
    childrenNamed(row, "td").forEach((cell, index) => {
      const value = textOf(cell).trim();
      if (BLANK.test(value)) return;
      if (NUMERIC.test(value)) numeric.add(index);
      else text.add(index);
    });
  }
  return [...numeric].filter((index) => !text.has(index) && index < MAX_TAGGED_COLUMN);
}

function MarkdownTable({ node, className, children, ...props }: TableProps) {
  const numeric = node ? numericColumns(node) : [];
  return (
    <div className="chat-table">
      <table
        className={cn(
          numeric.map((index) => `chat-t-num-${index + 1}`),
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export const MARKDOWN_COMPONENTS = { table: MarkdownTable };
