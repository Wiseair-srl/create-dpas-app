"use client";

import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Brain, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ToolCallCard } from "@/agent/experience/tool-renderers";
import type { ChatEntry } from "@/agent/experience/message-store";
import { MarkdownText } from "./markdown-text";

/**
 * The chat thread on assistant-ui's headless primitives. assistant-ui owns
 * message grouping, viewport auto-scroll, and composer semantics; the message
 * INTERNALS render through our components so tool calls, notes, and errors
 * keep the DPAS visual language.
 */

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

/** Answers are markdown: emphasis, inline code for ids, the odd list. */
function AssistantTextMessage({ text }: { text: string }) {
  return (
    <MessagePrimitive.Root className="flex">
      <div
        data-testid="assistant-text"
        className="max-w-[92%] rounded-lg bg-surface-muted px-3 py-2 text-sm leading-6"
      >
        <MarkdownText>{text}</MarkdownText>
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Model reasoning, folded away by default: useful when debugging a plan,
 * noise the rest of the time, and never mistaken for the answer.
 */
function ReasoningMessage({ text }: { text: string }) {
  return (
    <MessagePrimitive.Root className="flex">
      <details className="w-full rounded-lg border border-dashed border-border" data-testid="reasoning">
        <summary className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
          <Brain aria-hidden className="h-3.5 w-3.5" />
          Model reasoning
        </summary>
        <div className="dpas-scroll max-h-56 overflow-y-auto px-3 pb-2 text-xs leading-5 text-muted-foreground">
          <MarkdownText>{text}</MarkdownText>
        </div>
      </details>
    </MessagePrimitive.Root>
  );
}

function NoteMessage({ entry }: { entry: Extract<ChatEntry, { kind: "note" }> }) {
  return (
    <MessagePrimitive.Root
      role="status"
      className={cn(
        "rounded-md border border-dashed px-3 py-2 text-xs leading-5",
        entry.tone === "error"
          ? "border-danger/50 bg-danger-soft/40 text-danger"
          : entry.tone === "demo"
            ? "border-border-strong bg-surface-muted/60 text-muted-foreground"
            : "border-border bg-surface text-muted-foreground",
      )}
    >
      {entry.text}
    </MessagePrimitive.Root>
  );
}

function entryOf(metadata: unknown): ChatEntry | undefined {
  return (metadata as { entry?: ChatEntry } | undefined)?.entry;
}

/** Follow new content only while the reader is already this close to it. */
const STICK_TO_BOTTOM_PX = 120;

/**
 * Keep the newest content in view, and get out of the way the moment the
 * reader scrolls back.
 *
 * We own this instead of using assistant-ui's auto-scroll, which misbehaves on
 * a transcript of tool cards in two compounding ways:
 *
 *  - It watches the VIEWPORT for resize — a box whose height never changes —
 *    so growth reaches it only through its MutationObserver, which reads
 *    `scrollHeight` the instant a node is appended, before the card has
 *    finished laying out (markdown, monospace ids, the Input/Result
 *    `<details>`). It scrolls to an already-stale height and lands short,
 *    leaving the answer below the fold under a half-clipped card.
 *  - Its `isAtBottom` flag only updates on a narrow set of scroll transitions,
 *    so it goes stale and stays `true` after the reader has scrolled away —
 *    and every later growth yanks them back down. Wheel and trackpad scrolling
 *    never fire `pointerdown`, so its cancel path does not catch them either.
 *
 * Observing the CONTENT box is the measurement it is missing, and deriving
 * "at bottom" from the live scroll position on every scroll event is the state
 * it gets wrong. The viewport's own auto-scroll props are all off below, so
 * there is nothing to fight.
 */
function useStickToBottom() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Read inside the observer, which must not re-subscribe on every change.
  const atBottomRef = useRef(true);

  const jumpToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const fromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const next = fromBottom <= STICK_TO_BOTTOM_PX;
      atBottomRef.current = next;
      setAtBottom(next);
    };

    // Scrolling is the only thing that expresses the reader's intent.
    viewport.addEventListener("scroll", measure, { passive: true });

    // Fires when layout settles, which is exactly when the re-pin must happen.
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
      else measure();
    });
    observer.observe(content);

    // Open on the newest content, the way a chat transcript should.
    viewport.scrollTop = viewport.scrollHeight;
    measure();

    return () => {
      viewport.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return { viewportRef, contentRef, atBottom, jumpToLatest };
}

export function AssistantThread({ welcome }: { welcome: ReactNode }) {
  const { viewportRef, contentRef, atBottom, jumpToLatest } = useStickToBottom();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport
        ref={viewportRef}
        // Every auto-scroll path off: useStickToBottom owns this (see above).
        autoScroll={false}
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
        className="dpas-scroll min-h-0 flex-1 overflow-y-auto"
        data-testid="assistant-transcript"
      >
        {/* The scroll container measures itself; this box is what actually
            grows, so it is the one worth observing. */}
        <div ref={contentRef} className="flex flex-col gap-3 px-3 py-3">
          <AuiIf condition={(s) => s.thread.isEmpty}>{welcome}</AuiIf>
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const entry = entryOf(message.metadata?.custom);
              if (message.role === "user") return <UserMessage />;
              if (entry?.kind === "note") return <NoteMessage entry={entry} />;
              if (entry?.kind === "reasoning") return <ReasoningMessage text={entry.text} />;
              if (entry?.kind === "tool") {
                return (
                  <MessagePrimitive.Root>
                    <ToolCallCard entry={entry} />
                  </MessagePrimitive.Root>
                );
              }
              return <AssistantTextMessage text={entry?.kind === "assistant" ? entry.text : ""} />;
            }}
          </ThreadPrimitive.Messages>
        </div>
      </ThreadPrimitive.Viewport>

      {/* Escape hatch: scrolling back through a long run must never strand the
          reader away from the answer. Driven by our own measurement, so it
          cannot disagree with what the transcript is actually doing. */}
      {atBottom ? null : (
        <button
          type="button"
          onClick={jumpToLatest}
          data-testid="scroll-to-latest"
          className={cn(
            "absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full",
            "border border-border-strong bg-surface px-3 py-1.5 text-xs shadow-md",
            "hover:border-accent hover:text-accent",
          )}
        >
          <ArrowDown aria-hidden className="h-3.5 w-3.5" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

export function AssistantComposer({
  disabled,
  running,
  placeholder,
  onStop,
}: {
  disabled: boolean;
  running: boolean;
  placeholder: string;
  onStop: () => void;
}) {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border-t border-border p-3">
      <ComposerPrimitive.Input
        aria-label="Message the assistant"
        placeholder={placeholder}
        rows={1}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className={cn(
          "max-h-32 min-h-9 flex-1 resize-none rounded-md border border-border-strong bg-surface",
          "px-3 py-2 text-sm placeholder:text-faint-foreground disabled:opacity-60",
        )}
      />
      {running ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop the run"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-background hover:opacity-85"
        >
          <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <ComposerPrimitive.Send
          aria-label="Send"
          disabled={disabled}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground",
            "hover:bg-accent-hover disabled:opacity-50",
          )}
        >
          <ArrowUp aria-hidden className="h-4 w-4" />
        </ComposerPrimitive.Send>
      )}
    </ComposerPrimitive.Root>
  );
}
