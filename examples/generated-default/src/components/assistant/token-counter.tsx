"use client";

// Deliberately not a coin: this counts tokens, and nothing here prices them.
import { Hash } from "lucide-react";
import { Fragment } from "react";
import { useMessageStore } from "@/agent/experience/message-store";
import { cn } from "@/lib/cn";
import { formatTokens } from "@/lib/format";

/**
 * What this conversation has spent, in tokens the provider actually reported.
 *
 * Tokens, not money. The badge shows input and output SEPARATELY and never
 * their sum, because the sum is the one number that prices nothing: output
 * bills at several times input, so adding them produces a figure that
 * corresponds to no rate. The two directions are the smallest honest reading.
 *
 * The rest appears on hover or focus rather than occupying the chat.
 *
 * It counts per STEP-REQUEST rather than per model call, because that is what
 * gets billed: an agentic turn loops — filter, read, select, act — and every
 * step resends the conversation so far, so the input side grows with the turn
 * and dwarfs the output side. A counter that showed one model call would hide
 * exactly the cost this architecture is shaped around (it is why the volatile
 * half of the catalog is kept out of the cached tool block; see protocol.ts).
 *
 * Absent until something is measured. Two ordinary cases would otherwise show
 * a confident zero: the guided demo runs no model at all, and some providers
 * report no usage — neither is "0 tokens", and saying so would be a lie the
 * rest of this app takes care not to tell (invariant 7).
 */
export function TokenCounter() {
  const usage = useMessageStore((s) => s.usage);
  const turnUsage = useMessageStore((s) => s.turnUsage);
  const running = useMessageStore((s) => s.running);

  if (usage.reportedSteps === 0) return null;

  // A live run is still adding to the turn; anything else is reporting the
  // last one that ran — including a guided demo, which spends no tokens.
  const inFlight = running === "live";
  const detail =
    `Tokens this conversation: ${usage.inputTokens.toLocaleString()} input, ` +
    `${usage.outputTokens.toLocaleString()} output, ` +
    `${usage.totalTokens.toLocaleString()} total across ${usage.reportedSteps} model ` +
    `step${usage.reportedSteps === 1 ? "" : "s"}.` +
    // Named as subsets out loud: a screen reader gets no indentation to say it.
    (usage.cachedInputTokens !== undefined
      ? ` ${usage.cachedInputTokens.toLocaleString()} of the input was cached.`
      : "") +
    (usage.reasoningTokens !== undefined
      ? ` ${usage.reasoningTokens.toLocaleString()} of the output was reasoning.`
      : "") +
    (turnUsage.reportedSteps > 0
      ? ` ${inFlight ? "This" : "Last"} turn: ` +
        `${turnUsage.inputTokens.toLocaleString()} input, ` +
        `${turnUsage.outputTokens.toLocaleString()} output.`
      : "");

  return (
    <div
      className="group relative"
      data-testid="token-counter"
      data-input-tokens={usage.inputTokens}
      data-output-tokens={usage.outputTokens}
    >
      {/* A button so it takes focus: that is what opens the panel for the
          keyboard, and what stands in for hover on a touch screen, where the
          assistant is a full-screen sheet and there is no pointer at all. */}
      <button
        type="button"
        aria-label={detail}
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <Hash aria-hidden className="h-3.5 w-3.5" />
        <span aria-hidden className="tabular-nums">
          {formatTokens(usage.inputTokens)}↑ · {formatTokens(usage.outputTokens)}↓
        </span>
      </button>

      {/* Announced through the button's label instead, so the panel is purely
          visual and nothing gets read twice. */}
      <div
        aria-hidden
        data-testid="token-counter-detail"
        className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden w-max rounded-md border border-border bg-surface p-2 shadow-md group-hover:block group-focus-within:block"
      >
        {/* "of which" is doing real work: reasoning bills as output and cached
            input bills as input, so both are already inside the line above.
            Anyone who adds them gets a number nobody is charged. */}
        <UsageRows
          rows={[
            { label: "Input", value: usage.inputTokens },
            ...(usage.cachedInputTokens !== undefined
              ? [{ label: "of which cached", value: usage.cachedInputTokens, subset: true }]
              : []),
            { label: "Output", value: usage.outputTokens },
            ...(usage.reasoningTokens !== undefined
              ? [{ label: "of which reasoning", value: usage.reasoningTokens, subset: true }]
              : []),
            { label: "Total", value: usage.totalTokens },
          ]}
        />
        {turnUsage.reportedSteps > 0 ? (
          <>
            <p className="mt-1 border-t border-border pt-1 text-[11px] leading-5 text-faint-foreground">
              {inFlight ? "this turn" : "last turn"}
            </p>
            <UsageRows
              rows={[
                { label: "Input", value: turnUsage.inputTokens },
                { label: "Output", value: turnUsage.outputTokens },
              ]}
            />
          </>
        ) : null}
        <p className="mt-1 text-[10px] leading-4 text-faint-foreground">
          {usage.reportedSteps} model step{usage.reportedSteps === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

interface UsageRow {
  label: string;
  value: number;
  /** Already counted in the row above; indented and dimmed to say so. */
  subset?: boolean;
}

/** Fragments keep `dt`/`dd` as direct grid children, and the list valid. */
function UsageRows({ rows }: { rows: UsageRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-[11px] leading-5">
      {rows.map(({ label, value, subset }) => (
        <Fragment key={label}>
          <dt className={subset ? "pl-2.5 text-faint-foreground" : "text-muted-foreground"}>
            {label}
          </dt>
          <dd
            className={cn(
              "text-right tabular-nums",
              subset ? "text-faint-foreground" : "font-medium text-foreground",
            )}
          >
            {value.toLocaleString()}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
