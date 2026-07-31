const UNITS: Array<[label: string, seconds: number]> = [
  ["y", 60 * 60 * 24 * 365],
  ["mo", 60 * 60 * 24 * 30],
  ["d", 60 * 60 * 24],
  ["h", 60 * 60],
  ["m", 60],
];

/** "3h ago" / "just now" — compact relative time for table cells. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  for (const [label, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return "just now";
}

/**
 * "842" / "12.4k" / "124k" / "1.03M" — token counts for a one-line readout.
 *
 * Exact while the number is still read digit by digit, compact once it stops
 * being. The threshold is low because two of these share one badge, and an
 * agentic turn reaches five figures of input quickly; the exact numbers are a
 * hover away.
 */
export function formatTokens(tokens: number): string {
  if (tokens < 10_000) return Math.round(tokens).toLocaleString();
  if (tokens < 100_000) return `${(tokens / 1000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
