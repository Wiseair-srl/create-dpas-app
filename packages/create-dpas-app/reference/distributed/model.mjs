import { MockLanguageModelV3 } from "ai/test";
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
export function scriptedModel() {
  return new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const latestUser = [...prompt].reverse().find((message) => message.role === "user");
      const text = JSON.stringify(latestUser?.content ?? "").toLowerCase();
      const last = prompt.at(-1);
      const finished = last?.role === "tool";
      const name = text.includes("highlight")
        ? "highlight_invoice"
        : text.includes("pay")
          ? "pay_invoice"
          : "read_invoice";
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            if (!finished)
              controller.enqueue({
                type: "tool-call",
                toolCallId: crypto.randomUUID(),
                toolName: name,
                input: JSON.stringify(name === "pay_invoice" ? { id: "invoice-1" } : {}),
              });
            else {
              controller.enqueue({ type: "text-start", id: "text" });
              controller.enqueue({
                type: "text-delta",
                id: "text",
                delta:
                  Array.isArray(last.content) &&
                  last.content.some((part) => part.toolName === "highlight_invoice")
                    ? `Browser result: ${JSON.stringify(last.content)}`
                    : "Done.",
              });
              controller.enqueue({ type: "text-end", id: "text" });
            }
            controller.enqueue({
              type: "finish",
              finishReason: { unified: finished ? "stop" : "tool-calls", raw: undefined },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  });
}
