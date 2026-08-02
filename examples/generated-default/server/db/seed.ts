import type { Client, CollectionStatus, Invoice } from "../../capabilities/model";

/**
 * Deterministic seed data — a small receivables ledger for five invented
 * clients. Day offsets are fixed and dates are computed relative to seed time,
 * so "23 days overdue" reads naturally without any randomness that would break
 * snapshot-style tests.
 *
 * Amounts are cents. The overdue Aurora Labs invoices are what the guided demo
 * chases, so their shape is load-bearing for the tests.
 */

export const CLIENTS: Client[] = [
  {
    id: 1,
    name: "Aurora Labs",
    segment: "Enterprise",
    payment_terms_days: 30,
    email: "ap@auroralabs.example",
  },
  {
    id: 2,
    name: "Bellweather Foods",
    segment: "Mid-market",
    payment_terms_days: 45,
    email: "finance@bellweather.example",
  },
  {
    id: 3,
    name: "Cobalt Logistics",
    segment: "Enterprise",
    payment_terms_days: 30,
    email: "accounts@cobalt.example",
  },
  {
    id: 4,
    name: "Dunmore Civic Trust",
    segment: "Public sector",
    payment_terms_days: 60,
    email: "payables@dunmore.example",
  },
  {
    id: 5,
    name: "Everline Health",
    segment: "Mid-market",
    payment_terms_days: 45,
    email: "ap@everline.example",
  },
];

type SeedInvoice = [
  id: number,
  reference: string,
  clientId: number,
  amountEuros: number,
  status: Invoice["status"],
  issuedDaysAgo: number,
  dueInDays: number,
  paidDaysAgo: number | null,
];

const INVOICES: SeedInvoice[] = [
  // Aurora Labs — three overdue, which is what the demo chases.
  [1, "AUR-0134", 1, 21_500, "sent", 53, -23, null],
  [2, "AUR-0136", 1, 18_400, "sent", 44, -14, null],
  [3, "AUR-0137", 1, 9_600, "sent", 38, -8, null],
  [4, "AUR-0138", 1, 24_000, "sent", 18, 12, null],
  [5, "AUR-0141", 1, 12_750, "draft", 0, 30, null],
  [6, "AUR-0129", 1, 19_800, "paid", 91, -61, 55],
  [7, "AUR-0131", 1, 11_200, "paid", 64, -34, 37],

  [8, "BWF-0064", 2, 6_150, "sent", 42, -12, null],
  [9, "BWF-0069", 2, 7_400, "sent", 21, 9, null],
  [10, "BWF-0072", 2, 4_850, "draft", 0, 21, null],
  [11, "BWF-0058", 2, 5_900, "paid", 78, -48, 44],
  [12, "BWF-0061", 2, 3_250, "paid", 57, -27, 30],

  [13, "CBL-0207", 3, 12_400, "sent", 36, -6, null],
  [14, "CBL-0212", 3, 16_750, "sent", 13, 17, null],
  [15, "CBL-0213", 3, 8_300, "sent", 6, 24, null],
  [16, "CBL-0215", 3, 13_900, "draft", 0, 30, null],
  [17, "CBL-0203", 3, 14_600, "paid", 82, -52, 49],

  [18, "DUN-0037", 4, 26_750, "sent", 118, -58, null],
  [19, "DUN-0041", 4, 31_500, "sent", 22, 38, null],
  [20, "DUN-0044", 4, 28_000, "draft", 0, 60, null],

  [21, "EVL-0084", 5, 7_800, "sent", 70, -40, null],
  [22, "EVL-0088", 5, 9_950, "sent", 25, 5, null],
  [23, "EVL-0079", 5, 8_600, "paid", 63, -33, 35],
  [24, "EVL-0091", 5, 5_400, "draft", 0, 45, null],
];

/**
 * Chase history for a few of the overdue rows, so the collections screen has
 * something to show on first load and the contextual `update-collection-status`
 * binding has both the "first contact" and "already chased" cases to act on.
 */
const COLLECTIONS: Array<[invoiceId: number, remindersSent: number, lastReminderDaysAgo: number, note: string | null]> =
  [
    [1, 2, 6, "Second reminder sent; AP says it is in the next payment run."],
    [18, 1, 12, "Waiting on a purchase-order number before they can pay."],
  ];

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export interface SeedData {
  clients: Client[];
  invoices: Invoice[];
  collections: CollectionStatus[];
}

export function seed(now: Date = new Date()): SeedData {
  return {
    clients: CLIENTS.map((client) => ({ ...client })),
    invoices: INVOICES.map(
      ([id, reference, client_id, amountEuros, status, issuedDaysAgo, dueInDays, paidDaysAgo]) => ({
        id,
        reference,
        client_id,
        amount: amountEuros * 100,
        status,
        issue_date: isoDate(now, -issuedDaysAgo),
        due_date: isoDate(now, dueInDays),
        paid_date: paidDaysAgo === null ? null : isoDate(now, -paidDaysAgo),
        notes: null,
      }),
    ),
    collections: COLLECTIONS.map(([invoice_id, reminders_sent, lastReminderDaysAgo, note]) => ({
      invoice_id,
      reminders_sent,
      last_reminder_date: isoDate(now, -lastReminderDaysAgo),
      expected_payment_date: null,
      note,
    })),
  };
}
