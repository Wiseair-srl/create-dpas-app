import { formatEur } from "../../capabilities/model";
import { parseISODate } from "./date";

export { formatEur };

/** "22 Jun 2026" — pinned locale so a screenshot and a test agree. */
export function formatDate(value?: string | null): string {
  // parseISODate (not `new Date`) so a date-only `YYYY-MM-DD` is read in local
  // time — `new Date("2026-06-22")` parses as UTC midnight and renders the day
  // before for readers west of UTC, disagreeing with the picker's calendar.
  const d = parseISODate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 12 days" / "12 days overdue" / "due today". */
export function dueLabel(daysOverdue: number, dueDate: string): string {
  if (daysOverdue > 0) return `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`;
  const days = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
