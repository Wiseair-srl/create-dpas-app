"use client";

import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowUp, Square } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ToolCallCard } from "@/agent/experience/tool-renderers";
import type { ChatEntry } from "@/agent/experience/message-store";

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

function AssistantTextMessage() {
  return (
    <MessagePrimitive.Root className="flex">
      <div className="max-w-[92%] rounded-lg bg-surface-muted px-3 py-2 text-sm leading-6">
        <MessagePrimitive.Parts />
      </div>
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

export function AssistantThread({ welcome }: { welcome: ReactNode }) {
  return (
    <ThreadPrimitive.Viewport
      className="dpas-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      data-testid="assistant-transcript"
    >
      <AuiIf condition={(s) => s.thread.isEmpty}>{welcome}</AuiIf>
      <ThreadPrimitive.Messages>
        {({ message }) => {
          const entry = entryOf(message.metadata?.custom);
          if (message.role === "user") return <UserMessage />;
          if (entry?.kind === "note") return <NoteMessage entry={entry} />;
          if (entry?.kind === "tool") {
            return (
              <MessagePrimitive.Root>
                <ToolCallCard entry={entry} />
              </MessagePrimitive.Root>
            );
          }
          return <AssistantTextMessage />;
        }}
      </ThreadPrimitive.Messages>
    </ThreadPrimitive.Viewport>
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
