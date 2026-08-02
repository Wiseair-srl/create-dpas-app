import type { ReactNode } from "react";

import { formatEur, type AgingBucket, type ReceivablesSummary } from "../capabilities/model";

/**
 * Native chat renderers, keyed by capability id.
 *
 * A tool result is JSON, and a thread that prints JSON is a thread nobody
 * reads. When the copilot calls a report capability, the answer renders the
 * same shapes the pages use, fed from the governed envelope's `data` — so the
 * assistant's version of the ageing ladder and the screen's version cannot
 * disagree, because they are one component over one number.
 *
 * Anything without an entry here falls back to the collapsible payload viewer
 * (features/copilot/payload.tsx), which is the right default: a renderer that
 * guesses at an unknown shape is worse than an honest `{ … }`.
 */

/** One height for every chart in the thread — it is one step of an answer,
 *  not the page's subject, and it shares a 44rem column with prose. */
function ChatCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="my-2 rounded-lg border bg-card p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function AgingChart({ buckets }: { buckets: AgingBucket[] }) {
  // Scaled against the largest bucket rather than the total: the point of an
  // ageing ladder is the comparison between buckets, and a share-of-total bar
  // renders every healthy ledger as one long bar and four slivers.
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <ul className="space-y-1.5">
      {buckets.map((bucket) => (
        <li key={bucket.id} className="grid grid-cols-[9rem_1fr_5.5rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{bucket.label}</span>
          <span className="h-2 rounded-full bg-hover" aria-hidden>
            <span
              className={`block h-2 rounded-full ${bucket.id === "current" ? "bg-positive" : "bg-warning"}`}
              style={{ width: `${Math.round((bucket.amount / max) * 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums font-medium">
            {formatEur(bucket.amount)}
            <span className="ml-1 font-normal text-muted-foreground">({bucket.count})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function SummaryTiles({ summary }: { summary: ReceivablesSummary }) {
  const tiles: Array<[label: string, value: string]> = [
    ["Outstanding", formatEur(summary.outstanding)],
    ["Overdue", formatEur(summary.overdue)],
    ["Collected (30d)", formatEur(summary.collected30d)],
    [
      "Avg days to pay",
      // Null is "nothing has been paid yet", which is not the same fact as
      // "paid on day zero" — a dashboard that renders it as 0 is lying.
      summary.averageDaysToPay === null ? "—" : `${summary.averageDaysToPay}`,
    ],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-md border bg-background px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const CHAT_RENDERERS: Record<string, (data: unknown) => ReactNode> = {
  "domain:collections-aging": (data) =>
    Array.isArray(data) ? (
      <ChatCard title="Receivables ageing">
        <AgingChart buckets={data as AgingBucket[]} />
      </ChatCard>
    ) : null,

  "domain:receivables-summary": (data) =>
    data && typeof data === "object" ? (
      <ChatCard title="Receivables">
        <SummaryTiles summary={data as ReceivablesSummary} />
      </ChatCard>
    ) : null,
};
