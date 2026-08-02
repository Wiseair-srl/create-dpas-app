import {
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  KeyRound,
  Pencil,
  RefreshCw,
  Square,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import type { ComponentProps, ReactNode } from "react";
import type { TextMessagePartProps } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ApprovalReceiptCard } from "./approval-receipt";
import { ConfirmationCard } from "./experience/confirmation-card";
import { MARKDOWN_COMPONENTS } from "./markdown-table";
import { ReasoningBlock } from "./reasoning";
import { parseApprovalReceipt } from "./receipt";
import { TokenMeter } from "./token-meter";
import { CapabilityToolUI } from "./tool-ui";

/**
 * The copilot thread, on assistant-ui primitives, following the layout of
 * assistant-ui's own reference Thread — narrow 44rem column, assistant answers
 * as plain prose (no bubble, no avatar), a soft 24px-radius composer that
 * centres on an empty thread and docks when the conversation starts.
 *
 * Colours are design tokens throughout, and the composer is `bg-card` rather
 * than the reference's muted mix, because in this system white panels are what
 * lift off the grey page. The 24px composer radius is a deliberate deviation
 * from the app's 2/4/6/10 ladder: chat is a distinct surface and the reference
 * geometry is what makes it read as a chat.
 *
 * assistant-ui owns streaming, autoscroll, markdown, edit-and-resend and the
 * action bar; the app owns the governed-envelope tool UI and the thread rail
 * (threads live in Mastra memory and the rail talks to /api/threads directly,
 * rather than through a RemoteThreadListAdapter).
 */

/** Module-scope so the markdown pipeline is not rebuilt on every token. */
const REMARK_PLUGINS = [remarkGfm];

/** Short chip label, full question sent — three chips fit one row this way. */
const SUGGESTIONS = [
  { label: "What's overdue?", prompt: "Which invoices are overdue, and by how much?" },
  { label: "Ageing", prompt: "Show me the receivables ageing ladder" },
  { label: "Worst client", prompt: "Which client owes us the most, and how late are they?" },
];

const COMPOSER_RADIUS = "1.5rem";

export function Thread({
  models,
  model,
  onModelChange,
  compact = false,
}: {
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  /**
   * Docked-panel geometry: ~400px instead of a 44rem page column. Only what
   * actually breaks at that width changes — the reading column, the
   * empty-state scale and the turn rhythm. Everything else (messages, tool
   * pills, composer, confirmation card) is already fluid.
   */
  compact?: boolean;
}) {
  const isEmpty = useAuiState((s) => s.thread.messages.length === 0);
  const hasModels = models.length > 0;

  return (
    <ThreadPrimitive.Root className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <ThreadPrimitive.Viewport className="relative flex flex-1 flex-col overflow-y-auto scroll-smooth">
        <div
          className={cn(
            "mx-auto flex w-full flex-1 flex-col",
            compact ? "max-w-full px-3 pt-4" : "max-w-[44rem] px-4 pt-8",
            isEmpty && "justify-center",
          )}
        >
          <ThreadPrimitive.Empty>
            {hasModels ? (
              <div className="mb-6 flex flex-col items-center px-4 text-center">
                <h1
                  className={cn(
                    "animate-in fade-in slide-in-from-bottom-1 fill-mode-both font-semibold duration-200",
                    compact ? "text-lg" : "text-2xl",
                  )}
                >
                  How can I help?
                </h1>
                <p className={cn("mt-2 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
                  Ask about invoices, clients or what needs chasing.
                  Consequential actions will ask for your approval right here.
                </p>
              </div>
            ) : (
              <NoModelSetup compact={compact} />
            )}
          </ThreadPrimitive.Empty>

          {/* Every entry is its own message (see experience/runtime-adapter),
              so this gap is the rhythm WITHIN one answer — thinking line, tool
              pill, result card, prose — not between turns. It stays tight for
              that reason; the turn boundary is drawn by the user bubble's own
              top margin instead. */}
          <div
            className={cn(
              "flex flex-col empty:hidden",
              compact ? "mb-8 gap-y-2" : "mb-16 gap-y-3",
            )}
          >
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
                EditComposer,
                SystemMessage: () => null,
              }}
            />
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "flex flex-col gap-4 overflow-visible bg-background pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-[1.5rem]",
            )}
          >
            <ScrollToBottom />
            {/* Sits directly above the composer, where the user's attention
                already is, and renders nothing until a bound domain action
                asks for approval. */}
            <div className="px-4">
              <ConfirmationCard />
            </div>
            <Composer
              models={models}
              model={model}
              onModelChange={onModelChange}
              hasModels={hasModels}
            />
            {hasModels && (
              <ThreadPrimitive.Empty>
                <div className="flex w-full flex-wrap items-center justify-center gap-2 px-4">
                  {SUGGESTIONS.map(({ label, prompt }) => (
                    <ThreadPrimitive.Suggestion
                      key={prompt}
                      prompt={prompt}
                      send
                      title={prompt}
                      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both whitespace-nowrap rounded-full border border-border/60 px-3.5 py-1.5 text-sm text-foreground outline-hidden transition-colors duration-200 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {label}
                    </ThreadPrimitive.Suggestion>
                  ))}
                </div>
              </ThreadPrimitive.Empty>
            )}
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

/**
 * The empty state shown in place of the greeting when no model key is
 * configured. Replaces (rather than joins) the "How can I help?" copy, since
 * a chat invite the composer can't act on is the wrong thing to lead with —
 * and there is now nowhere else in the surface that repeats this message.
 */
function NoModelSetup({ compact }: { compact: boolean }) {
  return (
    <div className="mb-6 flex flex-col items-center px-4 text-center">
      <div
        className={cn(
          "mb-3 flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          compact ? "size-8" : "size-10",
        )}
      >
        <KeyRound className={compact ? "size-4" : "size-5"} />
      </div>
      <h1
        className={cn(
          "animate-in fade-in slide-in-from-bottom-1 fill-mode-both font-semibold duration-200",
          compact ? "text-lg" : "text-2xl",
        )}
      >
        Set up the copilot
      </h1>
      <p
        className={cn(
          "mt-2 max-w-xs text-muted-foreground",
          compact ? "text-xs" : "text-sm",
        )}
      >
        Add a model key to start chatting. Set{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          ANTHROPIC_API_KEY
        </code>{" "}
        or{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          OPENROUTER_API_KEY
        </code>{" "}
        in{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">.env</code>, then
        restart.
      </p>
    </div>
  );
}

function ScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <Button
        variant="outline"
        size="icon"
        aria-label="Scroll to bottom"
        className="absolute -top-12 z-10 size-9 self-center rounded-full shadow-sm disabled:invisible"
      >
        <ArrowDown className="size-4" />
      </Button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

/**
 * The reference composer geometry: one soft-shadowed card, input on top,
 * controls underneath. Enter sends, shift+Enter breaks the line; while the
 * thread runs, Send swaps for Cancel.
 */
function Composer({
  models,
  model,
  onModelChange,
  hasModels,
}: {
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  /**
   * False when no provider key is configured. The input is disabled outright
   * rather than merely styled — `onNew` no-ops without a live provider
   * (experience/runtime-adapter.tsx), so a typeable-but-inert box would let
   * someone type a question, hit send, and watch it vanish with no feedback.
   */
  hasModels: boolean;
}) {
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <div
        className="flex w-full flex-col gap-2 rounded-[1.5rem] border border-border/60 bg-card p-2 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-border focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
        style={{ borderRadius: COMPOSER_RADIUS }}
      >
        <ComposerPrimitive.Input
          rows={1}
          autoFocus={hasModels}
          enterKeyHint="send"
          aria-label="Message input"
          disabled={!hasModels}
          placeholder={hasModels ? "Ask the copilot…" : "Add a model key to enable chat"}
          className="max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base caret-primary outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="relative flex items-center justify-between">
          {hasModels ? (
            <Select value={model} onValueChange={onModelChange}>
              <SelectTrigger
                aria-label="Model"
                title={model || undefined}
                // The base trigger clamps the value span with `line-clamp-1`, which
                // sets display:-webkit-box — and since the trigger is also
                // whitespace-nowrap the text is always one line, so the clamp never
                // fires and a long model id gets hard-cut mid-glyph. Force a plain
                // block + truncate so it ellipsises instead; important because the
                // two utilities set the same properties and stylesheet order, not
                // class order, would otherwise decide the winner.
                className="h-7 w-auto max-w-[240px] shrink gap-1 rounded-full border-transparent bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:bg-hover hover:text-foreground [&>span]:block! [&>span]:truncate!"
              >
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            // A static stand-in at the same trigger height, so the row doesn't
            // jump once a key lands and the real picker takes its place — not
            // a disabled Select, which would still paint hover/focus affordances
            // for a control with nothing to pick.
            <span className="flex h-7 shrink items-center gap-1.5 px-2.5 text-xs text-muted-foreground/70">
              <KeyRound className="size-3" />
              No model configured
            </span>
          )}

          {/* The row's meta side. The counter sits beside the send button
              rather than beside the model picker so the two things that grow
              with the conversation — the model id and the figure — cannot
              squeeze each other in a 320px dock. */}
          <div className="flex shrink-0 items-center gap-1">
            <TokenMeter />
            {hasModels ? (
              <>
                <AuiIf condition={(s) => !s.thread.isRunning}>
                  <ComposerPrimitive.Send asChild>
                    <IconButton tooltip="Send message" side="bottom" variant="primary" size="md">
                      <ArrowUp className="size-4" />
                    </IconButton>
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(s) => s.thread.isRunning}>
                  <ComposerPrimitive.Cancel asChild>
                    <IconButton tooltip="Stop generating" side="bottom" variant="primary" size="md">
                      <Square className="size-3 fill-current" />
                    </IconButton>
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </>
            ) : (
              <IconButton
                tooltip="Add a model key to send messages"
                side="bottom"
                variant="primary"
                size="md"
                disabled
              >
                <ArrowUp className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

/**
 * Assistant answers are prose on the page — no bubble, no avatar. The tool
 * pills and the native chart cards supply the structure instead.
 */
function AssistantMessage() {
  return (
    // The action bar lives inside the padding box and the negative margin
    // cancels that space in flow, so revealing it on hover cannot push the
    // messages below it (the reference Thread's trick).
    <MessagePrimitive.Root className="animate-in fade-in slide-in-from-bottom-1 relative -mb-7.5 pb-7.5 duration-150">
      <div className="px-2 leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            Reasoning: ReasoningBlock,
            tools: { Fallback: CapabilityToolUI },
          }}
        />
        <AuiIf condition={isThinking}>
          <ThinkingIndicator />
        </AuiIf>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            <ErrorPrimitive.Message className="line-clamp-2" />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
      {/* Only an answer gets the row. Reserving it on every message taxed the
          whole thread with 36px of blank per thinking line and per tool pill —
          and neither has anything to copy or regenerate. */}
      <AuiIf condition={isAnswer}>
        <div className="ms-2 flex min-h-7.5 items-center pt-1.5">
          <AssistantActionBar />
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
}

/**
 * The assistant is working and has not written anything yet. Covers both silent
 * windows: send → first part, and last tool result → first token of the answer.
 * Once text starts streaming the text itself is the progress signal.
 */
const isThinking = (s: AssistantState) =>
  s.thread.isRunning &&
  s.message.isLast &&
  !s.message.parts.some((p) => p.type === "text" && p.text.length > 0) &&
  // A streaming reasoning block is already saying "working on it", and says it
  // better — dots underneath would be the same claim twice.
  !s.message.parts.some((p) => p.type === "reasoning");

function ThinkingIndicator() {
  return (
    // The lead-in is deliberately generous: the dots follow either the user's
    // own bubble or a tool pill, and sitting tight under either read as part of
    // it rather than as the answer starting to arrive.
    <div className="flex items-center gap-1 pt-4 pb-1" aria-label="Assistant is working">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * react-markdown escapes raw HTML, so untrusted model text cannot inject
 * markup; `.chat-md` is the app's prose scale. GFM is on because the copilot
 * answers with tables constantly — without it a table streams through as raw
 * pipes — and those tables get their own renderer (see markdown-table.tsx).
 *
 * The one text the thread does NOT render as prose is an approval receipt:
 * the server writes it as a sentence plus a fenced `approval-outcome` block,
 * and it reads as a result card instead (see approval-receipt.tsx). Text that
 * does not carry the fence falls through here untouched.
 */
function AssistantText({ text }: TextMessagePartProps) {
  const receipt = parseApprovalReceipt(text);
  if (receipt) return <ApprovalReceiptCard receipt={receipt} />;
  return (
    <MarkdownTextPrimitive
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
      className="chat-md text-sm"
    />
  );
}

/**
 * Prose the user could copy or ask for again — the only kind of message the
 * action bar belongs under. A thinking line or a tool pill has nothing to copy
 * and nothing to regenerate on its own, and a receipt is a record of something
 * that already happened: "Regenerate" there would offer to re-run an executed
 * write.
 */
const isAnswer = (s: AssistantState) =>
  s.message.parts.some((p) => p.type === "text" && p.text.trim().length > 0) && !isReceipt(s);

const isReceipt = (s: AssistantState) =>
  s.message.parts.length > 0 &&
  s.message.parts.every((p) => p.type === "text" && parseApprovalReceipt(p.text) !== null);

/** `autohide="not-last"` keeps the actions permanently visible on the newest answer. */
function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="animate-in fade-in -ms-1 flex gap-1 text-muted-foreground duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <IconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <Check className="size-3.5" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <Copy className="size-3.5" />
          </AuiIf>
        </IconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <IconButton tooltip="Regenerate">
          <RefreshCw className="size-3.5" />
        </IconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

function UserMessage() {
  return (
    // A new question is the only real break in the thread, so the turn gap
    // lives here rather than between every message (`first:` keeps the top of
    // the thread flush with the viewport padding).
    <MessagePrimitive.Root className="animate-in fade-in slide-in-from-bottom-1 grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 pt-5 duration-150 first:pt-0 [&:where(>*)]:col-start-2">
      <div className="relative col-start-2 min-w-0">
        {/* User text stays literal — nobody's "*hi*" should turn italic. */}
        {/* 18px: half the composer's radius ladder, so the user's own words and
            the box they typed them in read as the same soft chat geometry. */}
        <div className="peer whitespace-pre-wrap rounded-[1.125rem] bg-selected px-4 py-2.5 text-sm leading-relaxed text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden">
          <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
            <ActionBarPrimitive.Edit asChild>
              <IconButton tooltip="Edit">
                <Pencil className="size-3.5" />
              </IconButton>
            </ActionBarPrimitive.Edit>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Editing re-runs the conversation from that message. It does NOT fork: the
 * store's `rewindToUserEntry` drops the question and everything it produced,
 * then re-sends (experience/runtime-adapter.tsx `onEdit`), so the previous
 * answer is replaced rather than kept alongside. That is also why there is no
 * branch picker here — assistant-ui's would never show a second branch without
 * a runtime that keeps a branch tree.
 */
function EditComposer() {
  return (
    <MessagePrimitive.Root className="flex flex-col px-2">
      <ComposerPrimitive.Root
        className="ms-auto flex w-full max-w-[85%] flex-col border border-border/60 bg-card shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none"
        style={{ borderRadius: COMPOSER_RADIUS }}
      >
        <ComposerPrimitive.Input
          autoFocus
          className="min-h-14 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-foreground outline-none"
        />
        <div className="mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

/**
 * The one button shape the thread uses: a 28px circle. `primary` is the
 * composer's send/stop; the default ghost is every hover action.
 */
function IconButton({
  tooltip,
  side = "top",
  variant = "ghost",
  size = "sm",
  children,
  className,
  ...props
}: ComponentProps<"button"> & {
  tooltip: string;
  side?: "top" | "bottom";
  variant?: "ghost" | "primary";
  /** `sm` (24px) is the action-bar size the ACTION_BAR_RESERVE is cut for. */
  size?: "sm" | "md";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            size === "md" ? "size-7" : "size-6",
            variant === "primary"
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
