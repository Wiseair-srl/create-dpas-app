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

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
