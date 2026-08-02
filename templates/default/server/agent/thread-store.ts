import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { ModelMessage } from "ai";

import { NO_STEP_USAGE, sumStepUsage, type StepUsage } from "../../app/agent/host/protocol";

/**
 * Thread persistence under the host protocol.
 *
 * The protocol is stateless by design — "the messages are the state", carried
 * by the browser and re-posted every step. But a reload should not lose the
 * conversation, and the dock's history menu needs something to list, so
 * something has to write.
 *
 * That something is deliberately NOT the agent's own memory. Memory would
 * RECALL the thread and prepend it to the history the protocol already carries,
 * so every message would reach the model twice, and it would re-save the whole
 * input on each of the up-to-eight steps in a turn. Persisting explicitly keeps
 * one copy of each message and one writer.
 *
 * What gets written:
 *   - step 0 only — the user message that opened the turn. Later steps re-post
 *     the same history; saving it again would duplicate it.
 *   - every step — the messages the model produced (text, tool calls, tool
 *     results), which is what makes a reloaded thread show its tool trail.
 *   - every step — what it cost. Token counts are the one thing here that
 *     cannot be re-derived from the transcript, so a thread that does not
 *     write them loses them for good the moment the browser moves on.
 *
 * Failures here never fail the turn: a thread that did not persist is a lost
 * rail entry, not a lost answer. Swap this file for Mastra Memory over
 * Postgres and nothing above it changes.
 */

export interface StoredThread {
  id: string;
  resourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ModelMessage[];
  /**
   * Tokens across every step-request this thread has run.
   *
   * Optional, and absent rather than zeroed when nothing was measured: a
   * thread written before this field existed, one run against the guided demo,
   * and one run against a provider that reports no usage all genuinely have
   * nothing to show — and the counter renders that as nothing at all, which is
   * the honest reading. A zero here would claim a measurement nobody made.
   */
  usage?: StepUsage;
}

interface ThreadFile {
  threads: StoredThread[];
}

/** Keeps the on-disk file from growing without bound in a long demo session. */
const MAX_THREADS = 50;

function dataFile(): string {
  return path.join(process.env.DPAS_DATA_DIR ?? path.join(process.cwd(), ".data"), "threads.json");
}

function load(): ThreadFile {
  const file = dataFile();
  if (!existsSync(file)) return { threads: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ThreadFile;
    return Array.isArray(parsed.threads) ? parsed : { threads: [] };
  } catch {
    return { threads: [] };
  }
}

function persist(state: ThreadFile) {
  const file = dataFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, file);
}

const globalKey = "__dpasThreads" as const;

function state(): ThreadFile {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = load();
  return g[globalKey] as ThreadFile;
}

/** First line of the user's message, clipped — the rail's default title. */
function titleFrom(message: ModelMessage | undefined): string {
  if (!message || message.role !== "user") return "";
  const { content } = message;
  const text =
    typeof content === "string"
      ? content
      : content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join(" ")
          .trim();
  return text.split("\n")[0]?.slice(0, 80) ?? "";
}

export interface PersistStepArgs {
  /** The conversation id doubles as the thread id. */
  threadId: string;
  /** The signed-in user's email — threads are listed per resource. */
  resourceId: string;
  stepIndex: number;
  /** The full history this step posted; only the trailing user turn is new. */
  inputMessages: ModelMessage[];
  /** What the model produced this step. */
  responseMessages: ModelMessage[];
  /**
   * What this step-request cost, when the provider reported anything. Summed
   * into the thread the same way the browser sums it into its counter, one
   * `step-finish` at a time, so the restored figure and the live one agree.
   */
  usage?: StepUsage;
}

export function persistStep(args: PersistStepArgs): void {
  const { threadId, resourceId, stepIndex, inputMessages, responseMessages, usage } = args;
  try {
    const newUserMessage =
      stepIndex === 0 ? inputMessages.filter((m) => m.role === "user").at(-1) : undefined;
    // Usage alone is enough to write: a step-request that timed out or errored
    // may have produced no messages, but those tokens were still spent, and a
    // total that quietly skips the expensive failures is worse than none.
    if (!newUserMessage && responseMessages.length === 0 && !usage) return;

    const file = state();
    let thread = file.threads.find((t) => t.id === threadId);
    if (!thread) {
      const now = new Date().toISOString();
      thread = {
        id: threadId,
        resourceId,
        title: titleFrom(newUserMessage) || "Untitled thread",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      file.threads.unshift(thread);
      // Oldest first out. The cap exists so a demo left running overnight does
      // not turn .data/ into a transcript archive.
      if (file.threads.length > MAX_THREADS) file.threads.length = MAX_THREADS;
    }
    if (newUserMessage) thread.messages.push(newUserMessage);
    thread.messages.push(...responseMessages);
    // Absent stays absent until something is actually reported, so a silent
    // provider leaves the field off rather than writing a measured-looking 0.
    if (usage) thread.usage = sumStepUsage(thread.usage ?? NO_STEP_USAGE, usage);
    thread.updatedAt = new Date().toISOString();
    persist(file);
  } catch (error) {
    // Diagnostics only — the turn already answered the user.
    console.error("[thread-store] persist failed", error);
  }
}

export function listThreads(resourceId: string): Array<Omit<StoredThread, "messages">> {
  return state()
    .threads.filter((thread) => thread.resourceId === resourceId)
    .map(({ messages: _messages, ...rest }) => rest)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getThread(resourceId: string, threadId: string): StoredThread | undefined {
  // Scoped by resource, not just by id: a thread id is a guessable string, and
  // "who asked" is the only thing that makes it theirs.
  return state().threads.find((t) => t.id === threadId && t.resourceId === resourceId);
}

export function deleteThread(resourceId: string, threadId: string): boolean {
  const file = state();
  const index = file.threads.findIndex((t) => t.id === threadId && t.resourceId === resourceId);
  if (index === -1) return false;
  file.threads.splice(index, 1);
  persist(file);
  return true;
}
