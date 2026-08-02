import * as z from "zod";

/**
 * Input/output schemas shared by the capabilities, the frontend manifest and
 * the typed client. Declared once so the model, the UI and the tests are
 * validated against the same shapes — a manifest that drifts from its
 * procedure is a lie told to the model in the tool block.
 */

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date as YYYY-MM-DD");

export const invoiceStatus = z.enum(["draft", "sent", "paid"]);

export const listInvoicesInput = z.object({
  /**
   * `pending` is the working set — issued and unpaid. `all` is the ledger.
   * Collapsing them behind one parameter keeps one capability where the UI has
   * two screens, which is one fewer thing for the model to choose between.
   */
  kind: z
    .enum(["pending", "all", "draft"])
    .default("all")
    .describe(
      "pending: issued and unpaid (the collections working set); draft: not yet issued; all: the whole ledger",
    ),
  clientId: z.number().int().positive().optional().describe("Restrict to one client"),
  overdueOnly: z.boolean().optional().describe("Only invoices past their due date"),
});

export const invoiceInput = z.object({
  clientId: z.number().int().positive(),
  amount: z
    .number()
    .int()
    .positive()
    .describe("Invoice total in CENTS — 18400 euros is 1840000"),
  issueDate: isoDate.optional().describe("Defaults to today"),
  dueDate: isoDate
    .optional()
    .describe("Defaults to the client's agreed payment terms after the issue date"),
  notes: z.string().max(500).nullish(),
});

export const invoiceUpdate = z.object({
  id: z.number().int().positive(),
  amount: z.number().int().positive().optional(),
  dueDate: isoDate.optional(),
  notes: z.string().max(500).nullish(),
});

export const invoiceId = z.object({ id: z.number().int().positive() });

export const markPaidInput = z.object({
  id: z.number().int().positive(),
  paidDate: isoDate.optional().describe("Defaults to today"),
});

/**
 * The chase status of ONE invoice. Patch semantics: an omitted key is left
 * alone, an explicit `null` clears it. That distinction is why the nullish
 * fields are `.nullish()` rather than `.optional()` — "don't touch" and "erase"
 * are different instructions and the model needs both.
 */
export const collectionStatusInput = z.object({
  invoiceId: z.number().int().positive(),
  lastReminderDate: isoDate.nullish().describe("When the last chase email went out"),
  remindersSent: z.number().int().min(0).max(99).optional(),
  expectedPaymentDate: isoDate.nullish().describe("What the client promised"),
  note: z.string().max(500).nullish(),
});

/**
 * The chase record as it stands after the write — what the procedure returns.
 *
 * Declared because the surface contract advertises a return shape to the model
 * (app/agent/surface/contracts.ts), and both halves have to be the same shape
 * or the model plans against a document the server never sends.
 */
export const collectionStatusOutput = z.object({
  invoice_id: z.number().int(),
  last_reminder_date: z.string().nullable(),
  reminders_sent: z.number().int(),
  expected_payment_date: z.string().nullable(),
  note: z.string().nullable(),
});

export const clientRef = z.object({ clientId: z.number().int().positive() });
