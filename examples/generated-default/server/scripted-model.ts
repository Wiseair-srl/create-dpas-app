import type { LanguageModelV2, LanguageModelV2CallOptions } from "@ai-sdk/provider";

/**
 * A deterministic `LanguageModelV2` that follows a golden scenario, selected
 * with `MODEL_PROVIDER=mock`.
 *
 * It exists so the ENTIRE live pipeline — route, per-request composition,
 * Mastra loop, client-tool suspension, browser dispatch, oRPC execution,
 * reconciliation — can run in CI with zero credentials. It is a stand-in for a
 * provider, not a stand-in for the architecture: every layer below it is the
 * real one.
 *
 * The script deliberately batches a SERVER tool and a CLIENT tool in the first
 * message, because that is the case that suspends the run mid-step: Mastra
 * executes the domain read and then drops its result, so the Agent Host has to
 * answer that call itself. Keeping it in the script means CI exercises
 * `settleOrphanedServerCalls` on every run.
 */

type StreamPart = Record<string, unknown>;

/**
 * `reasoningTokens` and `cachedInputTokens` are SUBSETS of output and input,
 * exactly as a real provider reports them — this model streams reasoning, so it
 * bills some, and the numbers stay inside their parents so anything that adds
 * them instead of nesting them shows up as wrong.
 */
const usage = {
  inputTokens: 16,
  outputTokens: 16,
  totalTokens: 32,
  reasoningTokens: 4,
  cachedInputTokens: 8,
};

function streamOf(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function textParts(id: string, text: string): StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

function toolCallPart(toolCallId: string, toolName: string, input: unknown): StreamPart {
  return { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) };
}

interface PromptToolResult {
  toolName: string;
  value: unknown;
}

/** Collect tool results from the conversation, in order. */
function collectToolResults(prompt: unknown): PromptToolResult[] {
  const results: PromptToolResult[] = [];
  if (!Array.isArray(prompt)) return results;
  for (const message of prompt) {
    if (message?.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "tool-result") {
        const output = part.output as { type?: string; value?: unknown } | undefined;
        results.push({
          toolName: String(part.toolName ?? ""),
          value: output?.type === "json" ? output.value : output?.value,
        });
      }
    }
  }
  return results;
}

function hasTool(options: LanguageModelV2CallOptions, name: string): boolean {
  return (options.tools ?? []).some((tool) => tool.name === name);
}

let callCounter = 0;

function nextParts(options: LanguageModelV2CallOptions): StreamPart[] {
  const results = collectToolResults(options.prompt);
  const finish = (reason: string): StreamPart => ({ type: "finish", finishReason: reason, usage });
  const call = (name: string, input: unknown): StreamPart[] => [
    toolCallPart(`stc_${++callCounter}`, name, input),
    finish("tool-calls"),
  ];

  // Step 1 — narrate, then call a SERVER tool and a CLIENT tool in the same
  // message. See the note above: this is the suspension case.
  if (!results.some((r) => r.toolName === "view_invoices__pending__setFilters")) {
    return [
      // Reasoning streams separately from the answer, and some models leak
      // channel markers into visible text — both are exercised here so the
      // experience layer's handling stays covered.
      { type: "reasoning-start", id: `rs${callCounter}` },
      {
        type: "reasoning-delta",
        id: `rs${callCounter}`,
        delta: "<|channel|>analysis Read the ageing, then narrow the table to what is overdue.",
      },
      { type: "reasoning-end", id: `rs${callCounter}` },
      ...textParts(`t${++callCounter}`, "Checking the **ageing ladder** and narrowing to `overdue`.\n"),
      toolCallPart(`stc_${++callCounter}`, "domain_collections-aging", {}),
      toolCallPart(`stc_${++callCounter}`, "view_invoices__pending__setFilters", { due: "overdue" }),
      finish("tool-calls"),
    ];
  }

  // Step 2 — read back what became visible.
  if (!results.some((r) => r.toolName === "view_invoices__pending__readState")) {
    return call("view_invoices__pending__readState", {});
  }

  // Step 3 — summarize from the rows the read actually returned.
  const read = results.findLast((r) => r.toolName === "view_invoices__pending__readState");
  const rows =
    read && typeof read.value === "object" && read.value !== null
      ? ((read.value as { visibleRows?: Array<{ amount?: number }> }).visibleRows ?? [])
      : [];
  const total = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  if (rows.length === 0) {
    return [
      ...textParts(`t${++callCounter}`, "Nothing is overdue right now — the ledger is clean."),
      finish("stop"),
    ];
  }

  // Formatted from the cents the tool returned, never from a number invented
  // here: the scripted script has to model an HONEST summary too.
  const euros = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(total / 100));

  const canIssue = hasTool(options, "domain_issue-invoice");
  return [
    ...textParts(
      `t${++callCounter}`,
      `**${rows.length}** invoice${rows.length === 1 ? " is" : "s are"} overdue, worth ${euros}. ` +
        (canIssue
          ? "Open a row's chase dialog and I can record the reminder against it."
          : "Issuing and deleting are not available to this identity, so I stopped at reading."),
    ),
    finish("stop"),
  ];
}

export function createScriptedModel(): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "dpas-scripted",
    modelId: "golden-scenario",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("The scripted model only supports streaming.");
    },
    async doStream(options) {
      const parts: StreamPart[] = [
        { type: "stream-start", warnings: [] },
        {
          type: "response-metadata",
          id: `scripted-${++callCounter}`,
          modelId: "golden-scenario",
          timestamp: new Date(),
        },
        ...nextParts(options),
      ];
      return { stream: streamOf(parts) } as Awaited<ReturnType<LanguageModelV2["doStream"]>>;
    },
  };
}
