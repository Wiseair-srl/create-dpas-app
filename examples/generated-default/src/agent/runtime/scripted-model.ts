import type { LanguageModelV2, LanguageModelV2CallOptions } from "@ai-sdk/provider";

/**
 * A deterministic LanguageModelV2 that follows the golden scenario
 * (ADR-0006). It exists so the ENTIRE live pipeline — route, per-turn
 * composition, Mastra loop, client-tool suspension, browser dispatch,
 * confirmation, oRPC execution — can run in CI with zero credentials.
 *
 * This is not the guided demo (which needs no model at all); it is a
 * scripted stand-in for a real provider, selected with MODEL_PROVIDER=mock.
 */

type StreamPart = Record<string, unknown>;

/**
 * `reasoningTokens` and `cachedInputTokens` are SUBSETS of output and input,
 * exactly as a real provider reports them — this model streams reasoning, so
 * it bills some, and the numbers stay inside their parents so anything that
 * adds them instead of nesting them shows up as wrong.
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

function isErrorValue(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "error" in (value as object));
}

let callCounter = 0;

function nextParts(options: LanguageModelV2CallOptions): StreamPart[] {
  const results = collectToolResults(options.prompt);
  const finish = (reason: string): StreamPart => ({ type: "finish", finishReason: reason, usage });
  const call = (name: string, input: unknown): StreamPart[] => [
    toolCallPart(`stc_${++callCounter}`, name, input),
    finish("tool-calls"),
  ];

  const last = results.at(-1);

  // Step 1 — narrate, then call a SERVER tool and a CLIENT tool in the same
  // message. Real models batch tool calls like this, and it is the case that
  // suspends the run mid-step: Mastra executes the domain read but drops its
  // result, so the Agent Host has to answer that call itself. Keeping it in
  // the script means CI exercises that path on every run.
  if (!results.some((r) => r.toolName === "view_devices__filters__set")) {
    return [
      // Reasoning is streamed separately from the answer, and some models
      // leak channel markers into text — both are exercised here so the
      // experience layer's handling stays covered.
      { type: "reasoning-start", id: `rs${callCounter}` },
      {
        type: "reasoning-delta",
        id: `rs${callCounter}`,
        delta: "<|channel|>analysis Filter to Milan, then read the table.",
      },
      { type: "reasoning-end", id: `rs${callCounter}` },
      ...textParts(
        `t${++callCounter}`,
        "Checking the fleet and filtering to **offline** devices in `Milan`.\n",
      ),
      toolCallPart(`stc_${++callCounter}`, "domain_devices__list", {
        status: "offline",
        city: "Milan",
      }),
      toolCallPart(`stc_${++callCounter}`, "view_devices__filters__set", {
        status: "offline",
        city: "Milan",
      }),
      finish("tool-calls"),
    ];
  }

  // Step 2 — read what became visible.
  if (!results.some((r) => r.toolName === "view_devices__table__readState")) {
    return call("view_devices__table__readState", {});
  }

  // Step 3 — select the visible rows the read reported.
  if (!results.some((r) => r.toolName === "view_devices__table__selectRows")) {
    const read = results.findLast((r) => r.toolName === "view_devices__table__readState");
    const visible =
      read && typeof read.value === "object" && read.value !== null
        ? ((read.value as { visibleRows?: Array<{ id?: string }> }).visibleRows ?? [])
        : [];
    const ids = visible.map((row) => row.id).filter((id): id is string => typeof id === "string");
    if (ids.length === 0) {
      return [
        ...textParts(
          `t${++callCounter}`,
          "There are no offline devices in Milan right now, so there is nothing to disable.",
        ),
        finish("stop"),
      ];
    }
    return call("view_devices__table__selectRows", { ids, mode: "replace" });
  }

  // Step 4 — the destructive contextual call. Its input is bound and locked;
  // only fields still in the schema may be sent.
  if (!results.some((r) => r.toolName === "domain_devices__disable")) {
    if (!hasTool(options, "domain_devices__disable")) {
      return [
        ...textParts(
          `t${++callCounter}`,
          "I selected the offline devices in Milan, but disabling devices is not available " +
            "to the current identity — an operator has to do this part.",
        ),
        finish("stop"),
      ];
    }
    return call("domain_devices__disable", { reason: "Offline in Milan (agent-assisted sweep)" });
  }

  // Step 5 — summarize honestly, based on the disable result.
  if (last && isErrorValue(last.value)) {
    const code = (last.value as { error?: { code?: string } }).error?.code ?? "ERROR";
    const text =
      code === "CONFIRMATION_INVALID"
        ? "You declined the confirmation, so I did not disable anything. The selection is unchanged."
        : `The disable call did not complete (${code}). No devices were changed.`;
    return [...textParts(`t${++callCounter}`, text), finish("stop")];
  }
  const disabled =
    last && typeof last.value === "object" && last.value !== null
      ? ((last.value as { disabled?: number }).disabled ?? 0)
      : 0;
  return [
    ...textParts(
      `t${++callCounter}`,
      `Done — **${disabled}** offline device${disabled === 1 ? "" : "s"} in Milan ${
        disabled === 1 ? "is" : "are"
      } now disabled. The table reflects the change.`,
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
