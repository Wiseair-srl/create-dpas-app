import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

import { useMessageStore, type TokenUsage } from "./experience/message-store";
import {
  formatCompact,
  formatExact,
  formatSteps,
  hasMeasuredUsage,
  usageRows,
} from "./token-usage";

/**
 * What the conversation has cost, in the composer's control row.
 *
 * Discreet by construction: one muted compact figure next to the model picker,
 * and nothing at all until a turn has actually been measured — the guided demo
 * and a provider that reports no usage both leave it absent rather than
 * showing a zero nobody spent. The detail is one hover (or one focus) away.
 *
 * Two scopes, because they answer different questions: the turn says what the
 * last question cost, the conversation says what the thread has cost so far.
 * Both come from the message store, which sums one `step-finish` frame per
 * step-request — so a turn that looped through frontend tools counts every
 * round-trip it took, not just the last one.
 */
export function TokenMeter() {
  const usage = useMessageStore((s) => s.usage);
  const turnUsage = useMessageStore((s) => s.turnUsage);
  const running = useMessageStore((s) => s.running !== "idle");

  if (!hasMeasuredUsage(usage)) return null;

  // One turn in, the two scopes are the same measurement, and printing it
  // twice reads as a bug rather than as a breakdown.
  const turnIsWholeConversation =
    usage.totalTokens === turnUsage.totalTokens && usage.reportedSteps === turnUsage.reportedSteps;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          // The figure alone is cryptic to a screen reader, and the panel below
          // is pointer/focus-revealed detail rather than a label — so the whole
          // claim is spelled out here.
          aria-label={`${formatExact(usage.totalTokens)} tokens used in this conversation`}
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums outline-hidden transition-colors",
            "text-muted-foreground hover:bg-hover hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {formatCompact(usage.totalTokens)}
        </button>
      </HoverCardTrigger>

      <HoverCardContent side="top" align="end" className="w-60 p-0 text-xs">
        <div className="border-b border-border px-3 py-1.5 font-medium">Token usage</div>

        <UsageSection
          // While a turn runs the figure is the part of it already reported, so
          // the tense has to follow — "last turn" during a turn is a lie about
          // a number that is still moving.
          title={running ? "This turn" : "Last turn"}
          usage={turnUsage}
          emptyNote={running ? "Nothing reported yet." : undefined}
        />
        {!turnIsWholeConversation && <UsageSection title="Conversation" usage={usage} />}

        {/* No `border-t` — every section above already draws its own bottom
            rule, and the pair stack into a 2px line. */}
        <p className="px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Provider-reported. Cached input and reasoning are subsets, not extras.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * One measured scope. The total sits in the header rather than as a summed
 * bottom row: two of the four rows below it are subsets, so a column that
 * appeared to add up would be wrong.
 */
function UsageSection({
  title,
  usage,
  emptyNote,
}: {
  title: string;
  usage: TokenUsage;
  emptyNote?: string;
}) {
  const measured = hasMeasuredUsage(usage);
  if (!measured && emptyNote === undefined) return null;

  return (
    // Labelled so the two scopes are announced as separate groups; read
    // straight through, "Input 7,120 … Input 10,300" is one confusing list.
    <section aria-label={title} className="border-b border-border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {measured && (
          <span className="font-medium tabular-nums">{formatExact(usage.totalTokens)}</span>
        )}
      </div>

      {!measured ? (
        <p className="mt-1 text-muted-foreground">{emptyNote}</p>
      ) : (
        <>
          <dl className="mt-1.5 space-y-0.5">
            {usageRows(usage).map((row) => (
              <div
                key={row.label}
                className={cn("flex items-baseline justify-between gap-2", row.subset && "pl-3")}
              >
                <dt className={cn(row.subset ? "text-muted-foreground" : "text-foreground")}>
                  {/* Dimmed foreground rather than a hairline token: `border`
                      against `popover` is invisible in the dark theme. */}
                  {row.subset && (
                    <span aria-hidden className="pr-1 text-muted-foreground/60">
                      ↳
                    </span>
                  )}
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    "tabular-nums",
                    row.subset ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {row.value}
                  {row.share && (
                    <span className="pl-1.5 text-muted-foreground">· {row.share}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {formatSteps(usage.reportedSteps)}
          </p>
        </>
      )}
    </section>
  );
}
