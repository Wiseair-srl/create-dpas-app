import { useAuiState, type ReasoningMessagePartProps } from "@assistant-ui/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { ChatEntry } from "./experience/message-store";

/**
 * The model's reasoning, folded away.
 *
 * Thinking is process, not answer: it is worth being able to open, and worth
 * being out of the way by default. So the block stays folded to its one-line
 * summary at all times, streaming included — the pulsing "Thinking…" label is
 * sign of life enough, without the panel reflowing under a wall of text that
 * then vanishes. Opening it is always the user's call, and nothing closes it
 * behind their back.
 *
 * Reasoning reaches here as a real `reasoning` message part
 * (experience/runtime-adapter.tsx), so nothing has to guess which prose was
 * thinking and which was the answer.
 */

/** "Thought for 8s" / "Thought for 1m 12s". Kept short — this is a 420px panel. */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "Thought briefly";
  if (seconds < 60) return `Thought for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `Thought for ${minutes}m` : `Thought for ${minutes}m ${rest}s`;
}

/**
 * The entry behind this message. It carries the timing, which the message part
 * itself does not — a `reasoning` part is only `{ type, text }`.
 */
function useReasoningEntry(): Extract<ChatEntry, { kind: "reasoning" }> | undefined {
  return useAuiState((s) => {
    const custom = s.message.metadata?.custom as { entry?: ChatEntry } | undefined;
    return custom?.entry?.kind === "reasoning" ? custom.entry : undefined;
  });
}

export function ReasoningBlock({ text }: ReasoningMessagePartProps) {
  const entry = useReasoningEntry();
  // Live and unsealed. A restored block has no `startedAt` at all, so it can
  // never be mistaken for one that is still running.
  const streaming = entry?.startedAt !== undefined && entry.durationMs === undefined;

  const [open, setOpen] = useState(false);

  const label = streaming
    ? "Thinking…"
    : entry?.durationMs !== undefined
      ? formatDuration(entry.durationMs)
      : // Restored from storage: the thinking happened, but how long it took
        // was never persisted. Say the true thing rather than "0s".
        "Thought about this";

  const bodyId = `reasoning-${entry?.id ?? "block"}`;

  return (
    // Near-flush: the thread's own message gap sets the rhythm between blocks,
    // and doubling it here is what made a turn read as scattered fragments.
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          "group/reasoning flex items-center gap-1 rounded-md py-0.5 pr-1.5 text-xs outline-hidden transition-colors",
          "text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className={cn(streaming && "animate-pulse")}>{label}</span>
      </button>

      {open && (
        <div
          id={bodyId}
          className="mt-1 border-l-2 border-border/70 py-0.5 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {/*
            Plain pre-wrapped text, not markdown: reasoning streams in as
            half-finished fragments, and a markdown renderer chewing on an
            unclosed fence or table mid-stream looks broken in a way the raw
            text never does.
          */}
          {text}
        </div>
      )}
    </div>
  );
}
