import {
  actionContract,
  defineAgentComponentContract,
  defineAgentProcedureContract,
  emptyObjectSchema,
  fromJsonSchema,
  observationContract,
  type JsonValue,
} from "@agent-surface/core";

/**
 * Every capability this app can ever expose, declared statically.
 *
 * This file is the app's exposure ceiling. `@agent-surface/compiler` reads it
 * out of the production module graph at build time, hashes each capability and
 * emits `.agent-surface/contract.json`; the registry is constructed with that
 * artifact as its authority and refuses to register or invoke anything the
 * contract does not prove. What a component supplies at runtime is only
 * BEHAVIOUR — `read`, `execute`, `when`, `precondition`. Descriptions, schemas
 * and effects are frozen here.
 *
 * That split is the whole point: "what can the model do in this app" is now a
 * question you answer by reading one file and diffing one artifact, instead of
 * by mounting every screen and hoping the harness reached them all.
 *
 * ── Authoring rules, enforced by the compiler ──
 *
 * Everything below must be STATICALLY evaluable. Practically:
 *
 *   - each contract is a top-level `export const`, never built by a factory;
 *   - values are literals, or plain module-local consts in this file;
 *   - no template interpolation, no `+` concatenation, no function calls
 *     (`fromJsonSchema` / `actionContract` / `observationContract` are macros
 *     the compiler unwraps, not calls it evaluates);
 *   - schemas are literal JSON Schema. Zod cannot be used here — it is a
 *     runtime value, and the contract has to exist before anything runs.
 *
 * A violation is a build error naming the file and line, not a surprise at
 * mount.
 *
 * Treat a diff in this file like an API diff, because it is one: a changed
 * description is a changed prompt, and a removed capability breaks plans a
 * model may already be making.
 */

/**
 * Rows the model may read in one go. The UI always renders the full set — this
 * caps what enters the PROMPT, the same job `capRows` does for domain outputs
 * (capabilities/redact.ts). Anything larger and the model should narrow with
 * `setFilters` first, which is exactly what `truncated` tells it to do.
 *
 * Kept in step with `MAX_VISIBLE_ROWS` in useTableAgentComponent.ts, which is
 * asserted by that hook's test — the number appears in the description below
 * as a literal because the compiler cannot interpolate one.
 */
export const MAX_VISIBLE_ROWS = 100;

/* ───────────────────────────── shared shapes ───────────────────────────── */

/** What `readState` hands the model. Pinned by hand — see `fromJsonSchema`. */
export type TableReadState = {
  visibleRows: Record<string, JsonValue>[];
  rowCount: number;
  totalRows?: number;
  truncated: boolean;
  sort?: { key: string; direction: "asc" | "desc" } | null;
}

/** What `readColumnFilters` hands the model. A type alias, not an interface —
 *  only aliases get the implicit index signature `JsonValue` requires. */
export type ColumnFilterReport = {
  id: string;
  label: string;
  kind: string;
  value: string;
  options?: { value: string; label: string }[];
};

export type TableSortInput = {
  key: string | null;
  /**
   * Optional, and NOT defaulted by the runtime: JSON Schema `default` is
   * annotation-only in Agent Surface, so the binding applies the fallback
   * itself. Under the previous zod schema the parser did it.
   */
  direction?: "asc" | "desc";
}

export type ColumnVisibilityInput = {
  id: string;
  hidden: boolean;
}

export type MoveColumnInput = {
  id: string;
  direction: "left" | "right";
}

export type SelectRowsInput = {
  ids: number[];
}

/** A filter patch or a filter reading: always a flat map of string values,
 *  because that is what the URL carries and what the controls write. */
export type FilterMap = Record<string, string>;

/** A row as the model sees it — whatever the screen's `rowSummary` returns. */
const LOOSE_ROW = { type: "object", properties: {}, additionalProperties: true };

const TABLE_READ_STATE_OUTPUT = {
  type: "object",
  properties: {
    visibleRows: { type: "array", items: LOOSE_ROW },
    rowCount: { type: "number" },
    totalRows: { type: "number" },
    truncated: { type: "boolean" },
    sort: {
      anyOf: [
        {
          type: "object",
          properties: {
            key: { type: "string" },
            direction: { enum: ["asc", "desc"] },
          },
          required: ["key", "direction"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: ["visibleRows", "rowCount", "truncated"],
  additionalProperties: false,
};

const READ_STATE_DESCRIPTION =
  "The rows currently visible in this table, in view order (at most 100), with the row counts and the active sort. Read this before acting on rows.";

const SELECTION_OUTPUT = {
  type: "object",
  properties: {
    selectedIds: { type: "array", items: { type: "number" } },
    count: { type: "number" },
  },
  required: ["selectedIds", "count"],
  additionalProperties: false,
};

const COLUMNS_OUTPUT = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      hidden: { type: "boolean" },
      hideable: { type: "boolean" },
    },
    required: ["id", "label", "hidden", "hideable"],
    additionalProperties: false,
  },
};

/**
 * How a per-column filter value encodes, by kind. Every one is a string,
 * because that is what the funnel controls write and what the URL carries —
 * the model gets the same value space a person does, not a parallel one.
 *
 * This is documentation for the model and belongs on the SCHEMA: capability
 * descriptions are capped at 300 chars and this would eat the budget on its
 * own. Each table's `setColumnFilters` documents its own columns' formats
 * per-property, which is where a model looks for them anyway.
 */
const COLUMN_FILTERS_OUTPUT = {
  type: "array",
  description:
    'Value formats — text: a substring, matched case-insensitively ("acme"); select: exactly one of the values listed here ("paid"); number-range: "min,max", leave a side empty for open-ended ("1000," is >=1000); date-range: "from,to" as ISO yyyy-mm-dd, either side may be empty ("2024-01-01,"). Any kind: the empty string clears that column\'s filter.',
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      kind: { type: "string" },
      value: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: { value: { type: "string" }, label: { type: "string" } },
          required: ["value", "label"],
          additionalProperties: false,
        },
      },
    },
    required: ["id", "label", "kind", "value"],
    additionalProperties: false,
  },
};

const READ_COLUMN_FILTERS_DESCRIPTION =
  "The per-column filters of this table: which columns can narrow it, in what value format, what each is set to now, and — for a column with a fixed value list — the values that actually occur.";

const SET_COLUMN_FILTERS_DESCRIPTION =
  "Narrow this table by its columns. Pass only the column ids you want to change; omitted columns keep their value, and an empty string clears one. Read readColumnFilters first — a select column only accepts a value from its list.";

const SET_FILTERS_DESCRIPTION =
  "Narrow this table. Pass only the keys you want to change; omitted keys keep their current value, and an empty string clears one. The valid keys are documented on the input schema. Filters are URL-synced, so the user sees exactly the view you describe.";

const READ_FILTERS_DESCRIPTION =
  "The filters currently narrowing this table, as a key/value map. An absent or empty key is not narrowing anything.";

const CLEAR_FILTERS_DESCRIPTION =
  "Remove every filter on this table, restoring the unnarrowed view.";

const READ_SELECTION_DESCRIPTION =
  "The row ids currently selected in this table. Actions that operate on a selection take their input from here.";

const SELECT_ROWS_DESCRIPTION =
  "Select rows in this table, replacing the current selection. Only rows currently visible can be selected — narrow with setFilters first, then read the rows back. Selecting is what makes the selection-bound actions available.";

const READ_COLUMNS_DESCRIPTION =
  "The movable columns of this table in display order, each with whether it is currently hidden and whether it may be hidden at all.";

const SET_COLUMN_VISIBILITY_DESCRIPTION =
  "Show or hide one movable column. Hiding a column changes what the user sees and what an export contains; it never changes which rows match.";

const MOVE_COLUMN_DESCRIPTION = "Move one movable column a single position left or right.";

const SELECT_ROWS_INPUT = {
  type: "object",
  properties: {
    ids: {
      type: "array",
      items: { type: "integer" },
      description: "Row ids to select, replacing the current selection. Pass [] to clear.",
    },
  },
  required: ["ids"],
  additionalProperties: false,
};

const SORT_INPUT = {
  type: "object",
  properties: {
    key: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Column id to sort by, or null to clear sorting and restore view order",
    },
    direction: { enum: ["asc", "desc"], default: "desc" },
  },
  required: ["key"],
  additionalProperties: false,
};

const COLUMN_VISIBILITY_INPUT = {
  type: "object",
  properties: {
    id: { type: "string", description: "Column id, as reported by readColumns" },
    hidden: { type: "boolean", description: "true hides the column, false shows it" },
  },
  required: ["id", "hidden"],
  additionalProperties: false,
};

const MOVE_COLUMN_INPUT = {
  type: "object",
  properties: {
    id: { type: "string", description: "Column id, as reported by readColumns" },
    direction: { enum: ["left", "right"] },
  },
  required: ["id", "direction"],
  additionalProperties: false,
};

/* ─────────────────────── per-column filter descriptions ────────────────────
 * Spelled out per column rather than as one prose blob, so the model reads the
 * format for the column it is actually setting. `additionalProperties: false`
 * then makes an unknown column id a schema error before any handler runs — the
 * job the old runtime precondition did with a string it built at render time.
 */

const SELECT_FILTER = {
  type: "string",
  description: "select — exactly one of the values listed by readColumnFilters, or \"\" to clear",
};

const NUMBER_RANGE_FILTER = {
  type: "string",
  description: 'number-range — "min,max"; leave a side empty for open-ended ("1000," is >=1000), or "" to clear',
};

const DATE_RANGE_FILTER = {
  type: "string",
  description: 'date-range — "from,to" as ISO yyyy-mm-dd, either side may be empty ("2024-01-01,"), or "" to clear',
};

const FREE_TEXT_INVOICE_FILTER = {
  type: "string",
  description: "free text over invoice reference and client name",
};

/* ──────────────────────────── clients.list ─────────────────────────────── */

const CLIENTS_FILTERS = {
  type: "object",
  properties: {
    q: { type: "string", description: "free text over the client name" },
  },
  additionalProperties: false,
};

const CLIENTS_COLUMN_FILTERS = {
  type: "object",
  properties: { segment: SELECT_FILTER },
  additionalProperties: false,
};

export const clientsTableContract = defineAgentComponentContract({
  type: "clients.list",
  description: "Clients with their agreed terms and current position. Amounts are in cents.",
  observations: {
    readState: observationContract({
      description: READ_STATE_DESCRIPTION,
      output: fromJsonSchema<TableReadState>(TABLE_READ_STATE_OUTPUT),
    }),
    readFilters: observationContract({
      description: READ_FILTERS_DESCRIPTION,
      output: fromJsonSchema<FilterMap>({ ...CLIENTS_FILTERS, required: ["q"] }),
    }),
    readColumns: observationContract({
      description: READ_COLUMNS_DESCRIPTION,
      output: fromJsonSchema<
        { id: string; label: string; hidden: boolean; hideable: boolean }[]
      >(COLUMNS_OUTPUT),
    }),
    readColumnFilters: observationContract({
      description: READ_COLUMN_FILTERS_DESCRIPTION,
      output: fromJsonSchema<ColumnFilterReport[]>(COLUMN_FILTERS_OUTPUT),
    }),
  },
  actions: {
    setFilters: actionContract<FilterMap>({
      description: SET_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(CLIENTS_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnFilters: actionContract<FilterMap>({
      description: SET_COLUMN_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(CLIENTS_COLUMN_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    clearFilters: actionContract<Record<string, never>>({
      description: CLEAR_FILTERS_DESCRIPTION,
      input: emptyObjectSchema,
      effect: "local-state",
      idempotent: true,
    }),
    sort: actionContract<TableSortInput>({
      description:
        "Sort this table by one of its columns: name, segment, payment_terms_days, open_invoices, outstanding, overdue. Pass key: null to clear.",
      input: fromJsonSchema<TableSortInput>(SORT_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnVisibility: actionContract<ColumnVisibilityInput>({
      description: SET_COLUMN_VISIBILITY_DESCRIPTION,
      input: fromJsonSchema<ColumnVisibilityInput>(COLUMN_VISIBILITY_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    moveColumn: actionContract<MoveColumnInput>({
      description: MOVE_COLUMN_DESCRIPTION,
      input: fromJsonSchema<MoveColumnInput>(MOVE_COLUMN_INPUT),
      effect: "local-state",
      idempotent: false,
    }),
  },
});

/* ──────────────────────────── invoices.all ─────────────────────────────── */

const ALL_INVOICES_FILTERS = {
  type: "object",
  properties: { q: FREE_TEXT_INVOICE_FILTER },
  additionalProperties: false,
};

const ALL_INVOICES_COLUMN_FILTERS = {
  type: "object",
  properties: {
    client_name: SELECT_FILTER,
    segment: SELECT_FILTER,
    status: SELECT_FILTER,
    amount: NUMBER_RANGE_FILTER,
    issue_date: DATE_RANGE_FILTER,
  },
  additionalProperties: false,
};

export const allInvoicesTableContract = defineAgentComponentContract({
  type: "invoices.all",
  description: "Every invoice in the ledger — draft, issued and paid. Amounts are in cents.",
  observations: {
    readState: observationContract({
      description: READ_STATE_DESCRIPTION,
      output: fromJsonSchema<TableReadState>(TABLE_READ_STATE_OUTPUT),
    }),
    readFilters: observationContract({
      description: READ_FILTERS_DESCRIPTION,
      output: fromJsonSchema<FilterMap>({ ...ALL_INVOICES_FILTERS, required: ["q"] }),
    }),
    readColumns: observationContract({
      description: READ_COLUMNS_DESCRIPTION,
      output: fromJsonSchema<
        { id: string; label: string; hidden: boolean; hideable: boolean }[]
      >(COLUMNS_OUTPUT),
    }),
    readColumnFilters: observationContract({
      description: READ_COLUMN_FILTERS_DESCRIPTION,
      output: fromJsonSchema<ColumnFilterReport[]>(COLUMN_FILTERS_OUTPUT),
    }),
  },
  actions: {
    setFilters: actionContract<FilterMap>({
      description: SET_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(ALL_INVOICES_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnFilters: actionContract<FilterMap>({
      description: SET_COLUMN_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(ALL_INVOICES_COLUMN_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    clearFilters: actionContract<Record<string, never>>({
      description: CLEAR_FILTERS_DESCRIPTION,
      input: emptyObjectSchema,
      effect: "local-state",
      idempotent: true,
    }),
    sort: actionContract<TableSortInput>({
      description:
        "Sort this table by one of its columns: reference, client_name, status, amount, issue_date, due_date. Pass key: null to clear.",
      input: fromJsonSchema<TableSortInput>(SORT_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnVisibility: actionContract<ColumnVisibilityInput>({
      description: SET_COLUMN_VISIBILITY_DESCRIPTION,
      input: fromJsonSchema<ColumnVisibilityInput>(COLUMN_VISIBILITY_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    moveColumn: actionContract<MoveColumnInput>({
      description: MOVE_COLUMN_DESCRIPTION,
      input: fromJsonSchema<MoveColumnInput>(MOVE_COLUMN_INPUT),
      effect: "local-state",
      idempotent: false,
    }),
  },
});

/* ────────────────────────── invoices.pending ───────────────────────────── */

const PENDING_INVOICES_FILTERS = {
  type: "object",
  properties: {
    q: FREE_TEXT_INVOICE_FILTER,
    due: { type: "string", description: 'one of "all", "overdue", "current"' },
    chase: {
      type: "string",
      description:
        "invoice id whose chase dialog is open, or empty for none. Opening one is what makes domain:update-collection-status available, bound to that invoice",
    },
  },
  additionalProperties: false,
};

const PENDING_INVOICES_COLUMN_FILTERS = {
  type: "object",
  properties: {
    client_name: SELECT_FILTER,
    segment: SELECT_FILTER,
    amount: NUMBER_RANGE_FILTER,
    due_date: DATE_RANGE_FILTER,
  },
  additionalProperties: false,
};

export const pendingInvoicesTableContract = defineAgentComponentContract({
  type: "invoices.pending",
  description:
    "Issued invoices that have not been paid — the collections working set. Amounts are in cents.",
  observations: {
    readState: observationContract({
      description: READ_STATE_DESCRIPTION,
      output: fromJsonSchema<TableReadState>(TABLE_READ_STATE_OUTPUT),
    }),
    readFilters: observationContract({
      description: READ_FILTERS_DESCRIPTION,
      output: fromJsonSchema<FilterMap>({
        ...PENDING_INVOICES_FILTERS,
        required: ["q", "due", "chase"],
      }),
    }),
    readSelection: observationContract({
      description: READ_SELECTION_DESCRIPTION,
      output: fromJsonSchema<{ selectedIds: number[]; count: number }>(SELECTION_OUTPUT),
    }),
    readColumns: observationContract({
      description: READ_COLUMNS_DESCRIPTION,
      output: fromJsonSchema<
        { id: string; label: string; hidden: boolean; hideable: boolean }[]
      >(COLUMNS_OUTPUT),
    }),
    readColumnFilters: observationContract({
      description: READ_COLUMN_FILTERS_DESCRIPTION,
      output: fromJsonSchema<ColumnFilterReport[]>(COLUMN_FILTERS_OUTPUT),
    }),
  },
  actions: {
    setFilters: actionContract<FilterMap>({
      description: SET_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(PENDING_INVOICES_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnFilters: actionContract<FilterMap>({
      description: SET_COLUMN_FILTERS_DESCRIPTION,
      input: fromJsonSchema<FilterMap>(PENDING_INVOICES_COLUMN_FILTERS),
      effect: "local-state",
      idempotent: true,
    }),
    clearFilters: actionContract<Record<string, never>>({
      description: CLEAR_FILTERS_DESCRIPTION,
      input: emptyObjectSchema,
      effect: "local-state",
      idempotent: true,
    }),
    sort: actionContract<TableSortInput>({
      description:
        "Sort this table by one of its columns: reference, client_name, amount, due_date, days_overdue, reminders. Pass key: null to clear.",
      input: fromJsonSchema<TableSortInput>(SORT_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    selectRows: actionContract<SelectRowsInput>({
      description: SELECT_ROWS_DESCRIPTION,
      input: fromJsonSchema<SelectRowsInput>(SELECT_ROWS_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    setColumnVisibility: actionContract<ColumnVisibilityInput>({
      description: SET_COLUMN_VISIBILITY_DESCRIPTION,
      input: fromJsonSchema<ColumnVisibilityInput>(COLUMN_VISIBILITY_INPUT),
      effect: "local-state",
      idempotent: true,
    }),
    moveColumn: actionContract<MoveColumnInput>({
      description: MOVE_COLUMN_DESCRIPTION,
      input: fromJsonSchema<MoveColumnInput>(MOVE_COLUMN_INPUT),
      effect: "local-state",
      idempotent: false,
    }),
  },
});

/* ─────────────────────────── the app shell ─────────────────────────────── */

export type CurrentRoute = {
  path: string;
  title: string;
  knownRoutes: string[];
}

export type RouteInput = {
  path: string;
}

export type SessionReading = {
  email: string;
  name: string;
  role: string;
}

export const appNavigationContract = defineAgentComponentContract({
  type: "app.navigation",
  description: "The route this browser tab is showing, and the routes it can move to",
  observations: {
    readCurrentRoute: observationContract({
      description:
        "The route the user is currently looking at, its page title, and every route this app can navigate to. Call this first when the user's visible context matters.",
      output: fromJsonSchema<CurrentRoute>({
        type: "object",
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          knownRoutes: { type: "array", items: { type: "string" } },
        },
        required: ["path", "title", "knownRoutes"],
        additionalProperties: false,
      }),
    }),
  },
  actions: {
    goTo: actionContract<RouteInput>({
      description:
        "Move the app to one of its routes. Use when the user asks to see a page, or when a capability you need is only registered on another screen.",
      input: fromJsonSchema<RouteInput>({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute app route, e.g. /receivables/pending" },
        },
        required: ["path"],
        additionalProperties: false,
      }),
      effect: "navigation",
      idempotent: true,
    }),
  },
});

export const appSessionContract = defineAgentComponentContract({
  type: "app.session",
  description: "The identity this session is acting as",
  observations: {
    read: observationContract({
      description:
        "The signed-in user and their role. A controller may change the ledger; an analyst may only read it.",
      output: fromJsonSchema<SessionReading>({
        type: "object",
        properties: {
          email: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
        },
        required: ["email", "name", "role"],
        additionalProperties: false,
      }),
    }),
  },
});

/* ────────────────────── the one contextual procedure ───────────────────── */

export type CollectionStatusInput = {
  invoiceId: number;
  lastReminderDate?: string | null;
  remindersSent?: number;
  expectedPaymentDate?: string | null;
  note?: string | null;
};

/** The chase record as it stands after the write — `CollectionStatus`
 *  (capabilities/model.ts) in the shape the server returns it. */
export type CollectionStatusReading = {
  invoice_id: number;
  last_reminder_date: string | null;
  reminders_sent: number;
  expected_payment_date: string | null;
  note: string | null;
};

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };

/**
 * Byte-for-byte what `toJsonSchema(collectionStatusOutput)` emits, bounds
 * included: the registry compares the contract's schema against the runtime
 * one and refuses the registration if they differ. The bounds come from zod's
 * `.int()`, so they are not decoration — drop them and the app fails to mount.
 */
const SAFE_INTEGER = {
  type: "integer",
  minimum: -9007199254740991,
  maximum: 9007199254740991,
};

const COLLECTION_STATUS_OUTPUT = {
  type: "object",
  properties: {
    invoice_id: SAFE_INTEGER,
    last_reminder_date: NULLABLE_STRING,
    reminders_sent: SAFE_INTEGER,
    expected_payment_date: NULLABLE_STRING,
    note: NULLABLE_STRING,
  },
  required: [
    "invoice_id",
    "last_reminder_date",
    "reminders_sent",
    "expected_payment_date",
    "note",
  ],
  additionalProperties: false,
};

/**
 * `domain:update-collection-status` — the app's one CONTEXTUAL domain
 * reference, bound by the chase dialog.
 *
 * The contract advertises the full input, `invoiceId` included; the dialog's
 * `bind()` locks that field, and a locked field is stripped from what the model
 * is shown. The model is not asked to leave `invoiceId` alone — it is given no
 * field in which to name a different one.
 *
 * Kept in step with `collectionStatusInput` (capabilities/schemas.ts), which is
 * what the server actually validates. The surface contract is the model-facing
 * half of the same shape and a test asserts the two agree.
 */
export const updateCollectionStatusContract = defineAgentProcedureContract<
  CollectionStatusInput,
  CollectionStatusReading
>({
  id: "domain:update-collection-status",
  description:
    "Record a collections chase against the invoice whose dialog is open: last reminder date, reminders sent, expected payment date, note. Patch semantics — only the fields you pass are written.",
  input: fromJsonSchema<CollectionStatusInput>({
    type: "object",
    properties: {
      invoiceId: { type: "integer", exclusiveMinimum: 0, maximum: 9007199254740991 },
      lastReminderDate: {
        description: "When the last chase email went out",
        anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
      },
      remindersSent: { type: "integer", minimum: 0, maximum: 99 },
      expectedPaymentDate: {
        description: "What the client promised",
        anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
      },
      note: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    },
    required: ["invoiceId"],
    additionalProperties: false,
  }),
  output: fromJsonSchema<CollectionStatusReading>(COLLECTION_STATUS_OUTPUT),
  effect: "server-mutation",
  // No confirmation: recording a chase is reversible, and the input is already
  // pinned to the invoice on screen. Confirmation is for the calls whose blast
  // radius a person needs to read first — see capabilities/invoices/issue-invoice.ts.
  confirmation: "never",
});
