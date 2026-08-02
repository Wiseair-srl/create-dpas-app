/**
 * Date helpers shared by the date pickers and table date-range filters. The
 * canonical wire/URL format is a plain `YYYY-MM-DD` calendar string (no time,
 * no timezone) — parsing and formatting stay in local time so the day a user
 * clicks is the day that's stored.
 */

/** Parse a `YYYY-MM-DD` (or ISO datetime) string into a local Date, or undefined. */
export function parseISODate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Format a Date as a local `YYYY-MM-DD` string. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** First day of the current month as a `YYYY-MM-DD` string. */
export function startOfMonthISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * First day of the month that starts a trailing `months`-long window ending in
 * the current month (e.g. `months = 6` today in June → `2026-01-01`).
 */
export function startOfTrailingMonthsISO(months: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Today as a local `YYYY-MM-DD` string. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** `days` calendar days before `now`, as a local `YYYY-MM-DD` string. */
export function daysAgoISO(days: number, now: Date = new Date()): string {
  return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

/** First day of the current quarter as a `YYYY-MM-DD` string. */
export function startOfQuarterISO(now: Date = new Date()): string {
  const firstMonth = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(firstMonth + 1).padStart(2, "0")}-01`;
}

/** First day of the current year as a `YYYY-MM-DD` string. */
export function startOfYearISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-01-01`;
}

/**
 * Inclusive date-range predicate. Compares only the date portion as ISO strings
 * (lexicographic order matches chronological order), so it's timezone-safe.
 * Rows with a missing date are excluded once any bound is set, included when the
 * range is empty.
 */
export function withinRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
