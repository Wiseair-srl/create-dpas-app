import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as z from "zod";

import {
  daysBetween,
  todayISO,
  type Client,
  type CollectionStatus,
  type Invoice,
  type InvoiceRow,
} from "../../capabilities/model";
import { seed, type SeedData } from "./seed";

/**
 * The zero-configuration store: everything lives in memory and is written
 * through to `.data/db.json` so mutations survive a restart.
 *
 * This is the ONE file that knows how rows are persisted. Capabilities call
 * the functions below and nothing else, so swapping in Postgres and Drizzle —
 * which is what a real deployment of this shape does — is a rewrite of this
 * file and no other. The reads deliberately return joined `InvoiceRow`s rather
 * than raw tables: the join and the `days_overdue` derivation belong next to
 * the data, not repeated in five capabilities.
 */

const FileShape = z.object({
  clients: z.array(z.custom<Client>()),
  invoices: z.array(z.custom<Invoice>()),
  collections: z.array(z.custom<CollectionStatus>()),
});

function dataFile(): string {
  // DPAS_DATA_DIR lets tests and CI isolate the store from the project tree.
  return path.join(process.env.DPAS_DATA_DIR ?? path.join(process.cwd(), ".data"), "db.json");
}

function atomicWrite(file: string, contents: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

interface Store extends SeedData {
  nextInvoiceId: number;
}

function load(): Store {
  const file = dataFile();
  if (existsSync(file)) {
    try {
      const parsed = FileShape.parse(JSON.parse(readFileSync(file, "utf8")));
      return {
        ...parsed,
        nextInvoiceId: Math.max(0, ...parsed.invoices.map((i) => i.id)) + 1,
      };
    } catch {
      // Corrupt or outdated file: fall through to a fresh seed.
    }
  }
  const fresh = seed();
  const store = { ...fresh, nextInvoiceId: Math.max(0, ...fresh.invoices.map((i) => i.id)) + 1 };
  persist(store);
  return store;
}

function persist(store: Store) {
  atomicWrite(
    dataFile(),
    JSON.stringify(
      { clients: store.clients, invoices: store.invoices, collections: store.collections },
      null,
      2,
    ),
  );
}

// One store per server process, surviving `tsx watch` reloads via globalThis.
const globalKey = "__dpasStore" as const;

function db(): Store {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = load();
  return g[globalKey] as Store;
}

function save() {
  persist(db());
}

// ---------------------------------------------------------------------------
// Reads

export function listClients(): Client[] {
  return [...db().clients].sort((a, b) => a.name.localeCompare(b.name));
}

export function getClient(id: number): Client | undefined {
  return db().clients.find((c) => c.id === id);
}

/** Every invoice, joined with its client and chase status. */
export function listInvoiceRows(asOf = todayISO()): InvoiceRow[] {
  const store = db();
  const clientsById = new Map(store.clients.map((c) => [c.id, c]));
  const collectionsById = new Map(store.collections.map((c) => [c.invoice_id, c]));
  return store.invoices
    .map((invoice): InvoiceRow => {
      const client = clientsById.get(invoice.client_id);
      return {
        ...invoice,
        client_name: client?.name ?? "Unknown client",
        segment: client?.segment ?? "Mid-market",
        // Positive means late. A paid invoice is never late — it was settled,
        // whenever that happened.
        days_overdue:
          invoice.status === "sent" ? Math.max(0, daysBetween(invoice.due_date, asOf)) : 0,
        collection: collectionsById.get(invoice.id) ?? null,
      };
    })
    .sort((a, b) => b.due_date.localeCompare(a.due_date));
}

export function getInvoiceRow(id: number, asOf = todayISO()): InvoiceRow | undefined {
  return listInvoiceRows(asOf).find((row) => row.id === id);
}

// ---------------------------------------------------------------------------
// Writes

export function insertInvoice(input: {
  clientId: number;
  amount: number;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
}): Invoice {
  const store = db();
  const client = store.clients.find((c) => c.id === input.clientId);
  const id = store.nextInvoiceId++;
  const invoice: Invoice = {
    id,
    // A reference a person can say out loud, derived from the client so the
    // ledger stays readable when it is sorted by anything at all.
    reference: `${(client?.name ?? "INV").slice(0, 3).toUpperCase()}-${String(1000 + id).slice(1)}`,
    client_id: input.clientId,
    amount: input.amount,
    status: "draft",
    issue_date: input.issueDate,
    due_date: input.dueDate,
    paid_date: null,
    notes: input.notes ?? null,
  };
  store.invoices.push(invoice);
  save();
  return invoice;
}

export function updateInvoice(
  id: number,
  patch: { amount?: number; dueDate?: string; notes?: string | null },
): Invoice | undefined {
  const invoice = db().invoices.find((i) => i.id === id);
  if (!invoice) return undefined;
  if (patch.amount !== undefined) invoice.amount = patch.amount;
  if (patch.dueDate !== undefined) invoice.due_date = patch.dueDate;
  if (patch.notes !== undefined) invoice.notes = patch.notes;
  save();
  return invoice;
}

export function issueInvoice(id: number, issueDate: string, dueDate: string): Invoice | undefined {
  const invoice = db().invoices.find((i) => i.id === id);
  if (!invoice || invoice.status !== "draft") return undefined;
  invoice.status = "sent";
  invoice.issue_date = issueDate;
  invoice.due_date = dueDate;
  save();
  return invoice;
}

export function markInvoicePaid(id: number, paidDate: string): Invoice | undefined {
  const invoice = db().invoices.find((i) => i.id === id);
  if (!invoice || invoice.status !== "sent") return undefined;
  invoice.status = "paid";
  invoice.paid_date = paidDate;
  save();
  return invoice;
}

export function deleteInvoice(id: number): boolean {
  const store = db();
  const index = store.invoices.findIndex((i) => i.id === id);
  if (index === -1) return false;
  store.invoices.splice(index, 1);
  store.collections = store.collections.filter((c) => c.invoice_id !== id);
  save();
  return true;
}

/**
 * Patch semantics, as the schema advertises: an omitted key is left alone, an
 * explicit `null` clears it. `undefined` and `null` mean different things here
 * and the difference is the whole contract.
 */
export function upsertCollectionStatus(patch: {
  invoiceId: number;
  lastReminderDate?: string | null;
  remindersSent?: number;
  expectedPaymentDate?: string | null;
  note?: string | null;
}): CollectionStatus {
  const store = db();
  let row = store.collections.find((c) => c.invoice_id === patch.invoiceId);
  if (!row) {
    row = {
      invoice_id: patch.invoiceId,
      last_reminder_date: null,
      reminders_sent: 0,
      expected_payment_date: null,
      note: null,
    };
    store.collections.push(row);
  }
  if (patch.lastReminderDate !== undefined) row.last_reminder_date = patch.lastReminderDate;
  if (patch.remindersSent !== undefined) row.reminders_sent = patch.remindersSent;
  if (patch.expectedPaymentDate !== undefined) {
    row.expected_payment_date = patch.expectedPaymentDate;
  }
  if (patch.note !== undefined) row.note = patch.note;
  save();
  return row;
}

/** Demo convenience: restore the seeded ledger. Not an agent capability. */
export function resetStore(): void {
  const g = globalThis as Record<string, unknown>;
  const fresh = seed();
  g[globalKey] = {
    ...fresh,
    nextInvoiceId: Math.max(0, ...fresh.invoices.map((i) => i.id)) + 1,
  } satisfies Store;
  save();
}
