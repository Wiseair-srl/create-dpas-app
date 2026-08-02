/**
 * The domain, as plain functions over plain data.
 *
 * Nothing here touches the store, the network or React: capabilities, the UI
 * and the tests all import the same helpers, so "overdue" and "outstanding"
 * mean one thing in the app. This is the file to read first — it is the
 * vocabulary every other layer speaks.
 *
 * Money is in MINOR UNITS (cents) everywhere. It becomes a decimal exactly
 * once, in `formatEur`, and a capability that hands the model euros as a float
 * has already lost the argument about what was approved.
 */

export type InvoiceStatus = "draft" | "sent" | "paid";
export type ClientSegment = "Enterprise" | "Mid-market" | "Public sector";

export interface Client {
  id: number;
  name: string;
  segment: ClientSegment;
  /** Agreed payment terms in days — what `dueDate` is derived from at creation. */
  payment_terms_days: number;
  email: string;
}

export interface Invoice {
  id: number;
  /** Internal reference, stable for the life of the invoice. */
  reference: string;
  client_id: number;
  /** Cents. Always positive: this app models receivables only. */
  amount: number;
  status: InvoiceStatus;
  /** ISO `YYYY-MM-DD`. */
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  notes: string | null;
}

/** Collections chase state, one row per invoice — written by the chase dialog. */
export interface CollectionStatus {
  invoice_id: number;
  last_reminder_date: string | null;
  reminders_sent: number;
  expected_payment_date: string | null;
  note: string | null;
}

/** An invoice joined with the things a person reads next to it. */
export interface InvoiceRow extends Invoice {
  client_name: string;
  segment: ClientSegment;
  /** Positive = late by that many days; 0 or negative = not yet due. */
  days_overdue: number;
  collection: CollectionStatus | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today as a local `YYYY-MM-DD` string. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whole days between two `YYYY-MM-DD` strings, compared as calendar dates.
 *
 * Both are parsed at UTC midnight rather than through `new Date(string)` in
 * local time: an invoice due tomorrow must never read as "0 days" because the
 * reader is west of UTC.
 */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / DAY_MS);
}

/** Money owed to us: issued and not yet settled. Drafts are not receivable. */
export function isOutstanding(invoice: Pick<Invoice, "status">): boolean {
  return invoice.status === "sent";
}

/** Outstanding AND past its due date. */
export function isOverdue(invoice: Pick<Invoice, "status" | "due_date">, asOf = todayISO()): boolean {
  return isOutstanding(invoice) && invoice.due_date < asOf;
}

export function sumAmounts(rows: ReadonlyArray<Pick<Invoice, "amount">>): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

/**
 * The standard receivables ageing ladder. Buckets are exclusive and ordered,
 * so a row lands in exactly one and the array reads as a report.
 */
export const AGING_BUCKETS = [
  { id: "current", label: "Not yet due", from: -Infinity, to: 0 },
  { id: "1-30", label: "1–30 days", from: 1, to: 30 },
  { id: "31-60", label: "31–60 days", from: 31, to: 60 },
  { id: "61-90", label: "61–90 days", from: 61, to: 90 },
  { id: "90+", label: "Over 90 days", from: 91, to: Infinity },
] as const;

export type AgingBucketId = (typeof AGING_BUCKETS)[number]["id"];

export function bucketFor(daysOverdue: number): AgingBucketId {
  for (const bucket of AGING_BUCKETS) {
    if (daysOverdue >= bucket.from && daysOverdue <= bucket.to) return bucket.id;
  }
  return "current";
}

export interface AgingBucket {
  id: AgingBucketId;
  label: string;
  count: number;
  /** Cents. */
  amount: number;
}

export function agingReport(rows: readonly InvoiceRow[]): AgingBucket[] {
  const outstanding = rows.filter(isOutstanding);
  return AGING_BUCKETS.map((bucket) => {
    const inBucket = outstanding.filter((row) => bucketFor(row.days_overdue) === bucket.id);
    return {
      id: bucket.id,
      label: bucket.label,
      count: inBucket.length,
      amount: sumAmounts(inBucket),
    };
  });
}

export interface ReceivablesSummary {
  /** Cents owed to us, issued and unpaid. */
  outstanding: number;
  /** Cents outstanding AND past due. */
  overdue: number;
  /** Cents in draft — not owed yet, because nobody has been asked. */
  draft: number;
  /** Cents collected in the last 30 days. */
  collected30d: number;
  invoiceCount: number;
  overdueCount: number;
  /**
   * Weighted average days-to-pay over settled invoices, or null when nothing
   * has been paid yet. Null rather than 0: "no data" and "paid same day" are
   * different answers and a dashboard that conflates them is lying.
   */
  averageDaysToPay: number | null;
}

export function receivablesSummary(
  rows: readonly InvoiceRow[],
  asOf = todayISO(),
): ReceivablesSummary {
  const outstanding = rows.filter(isOutstanding);
  const overdue = outstanding.filter((row) => row.due_date < asOf);
  const drafts = rows.filter((row) => row.status === "draft");
  const paid = rows.filter((row) => row.status === "paid" && row.paid_date);
  const recentlyPaid = paid.filter((row) => daysBetween(row.paid_date!, asOf) <= 30);

  const daysToPay = paid.map((row) => daysBetween(row.issue_date, row.paid_date!));
  return {
    outstanding: sumAmounts(outstanding),
    overdue: sumAmounts(overdue),
    draft: sumAmounts(drafts),
    collected30d: sumAmounts(recentlyPaid),
    invoiceCount: rows.length,
    overdueCount: overdue.length,
    averageDaysToPay:
      daysToPay.length === 0
        ? null
        : Math.round(daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length),
  };
}

const EUR = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/**
 * 1_840_000 → "€18,400".
 *
 * The locale is pinned rather than taken from the browser: the same ledger has
 * to read identically in a screenshot, a test assertion and an approval card,
 * and "€18,400" turning into "18.400 €" between them is a difference nobody
 * asked for.
 */
export function formatEur(cents: number): string {
  return EUR.format(Math.round(cents / 100));
}
