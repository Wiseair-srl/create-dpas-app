import type { TokenUsage } from "./experience/message-store";

/**
 * Presentation for the token counter. Pure on purpose — the arithmetic that
 * decides whether a figure is shown at all is the part worth pinning down in a
 * test, because the failure mode is silent: an omitted field rendered as `0`
 * reads as a measured zero, and the whole counter is only worth having if
 * every number on it was actually reported (invariant 7).
 */

/**
 * The chip label. Deliberately lossy — it is 11px of muted text next to the
 * send button, and the exact figures are one hover away.
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const thousands = n / 1000;
  if (thousands < 100) return `${trimTrailingZero(thousands.toFixed(1))}k`;
  // 999_500 and up would round to "1000k", which is a worse way of saying 1M.
  if (n < 999_500) return `${Math.round(thousands)}k`;
  return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`;
}

function trimTrailingZero(fixed: string): string {
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/**
 * Panel figures: exact, grouped. `en-US` rather than the app's `it-IT` money
 * formatting — these are counts under English labels, and `12.431` read as a
 * decimal is exactly the wrong impression for a token total.
 */
export function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

/** `part` as a whole-percent share of `whole`; absent when that is meaningless. */
export function sharePercent(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}

export interface UsageRow {
  label: string;
  /** Formatted with grouping, ready to render. */
  value: string;
  /**
   * A SUBSET of the row above it, never an addition — cached input is already
   * inside the input figure and reasoning is already inside the output one.
   * The panel indents these so the columns cannot be read as a sum.
   */
  subset?: boolean;
  /** The subset's share of its parent row. */
  share?: string;
}

/**
 * The breakdown rows for one measured scope (a turn, or the conversation).
 *
 * The optional subsets appear only when the provider reported them: absent is
 * "said nothing about caching", which is not the same as a cache miss, and the
 * two must not render alike.
 */
export function usageRows(usage: TokenUsage): UsageRow[] {
  const rows: UsageRow[] = [{ label: "Input", value: formatExact(usage.inputTokens) }];
  if (usage.cachedInputTokens !== undefined) {
    rows.push({
      label: "from cache",
      value: formatExact(usage.cachedInputTokens),
      subset: true,
      ...optional("share", sharePercent(usage.cachedInputTokens, usage.inputTokens)),
    });
  }
  rows.push({ label: "Output", value: formatExact(usage.outputTokens) });
  if (usage.reasoningTokens !== undefined) {
    rows.push({
      label: "reasoning",
      value: formatExact(usage.reasoningTokens),
      subset: true,
      ...optional("share", sharePercent(usage.reasoningTokens, usage.outputTokens)),
    });
  }
  return rows;
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * Whether anything was actually measured. A provider that reports no usage —
 * and the guided demo, which runs no model at all — leaves this false, and the
 * counter hides itself rather than showing a zero nobody spent.
 */
export function hasMeasuredUsage(usage: TokenUsage): boolean {
  return usage.reportedSteps > 0;
}

/** "3 model steps" / "1 model step". */
export function formatSteps(reportedSteps: number): string {
  return `${formatExact(reportedSteps)} model step${reportedSteps === 1 ? "" : "s"}`;
}
