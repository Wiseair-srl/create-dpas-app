---
"create-dpas-app": minor
---

Show what a conversation costs: an input/output token counter in the assistant
chat.

The host protocol reserved a `usage` field on `step-finish` and never filled
it, so the generated app could run an entire agentic turn without ever saying
what it spent. It now reports `inputTokens`, `outputTokens`, `totalTokens` and
`reportedSteps` per step-request, summed across the turn and the conversation.

At rest it is one small badge beside the Copy button reading `48.2k↑ · 1,240↓`;
hovering or focusing it opens the full breakdown for both the conversation and
the current turn, so the numbers cost no permanent room in the chat. The badge
carries the whole reading as its accessible label, because a panel revealed by
hover reaches nobody who cannot hover.

The badge shows the two directions and **never their sum**. Output bills at
several times input, so a combined figure corresponds to no rate — this counts
tokens, not money, and nothing in the template applies a price.

`cachedInputTokens` and `reasoningTokens` ride along when the provider reports
them, and the panel shows both as indented "of which" rows under the line they
belong to. Reasoning bills *as* output and is already inside `outputTokens`;
cached input is already inside `inputTokens`. Adding either would produce a
number nobody is charged, so they are labelled as subsets everywhere they
appear — panel, accessible label, Inspector event and conversation report — and
each stays absent when the provider said nothing, since no reported reasoning
is not proof the model did none.

Counting per step-request rather than per model call is the point. A turn
loops — filter, read, select, act — and every step resends the conversation so
far, so the input side grows with the turn and dwarfs the output side. That is
what gets billed, and it is the cost this architecture is shaped around: it is
why the volatile half of the catalog is rendered after the conversation instead
of into the cached tool block.

The counter is absent until something is actually measured. Two ordinary cases
would otherwise show a confident zero — the guided demo runs no model at all,
and some providers report no usage — and neither of them is "0 tokens". Each
step's usage also reaches the Agent Inspector as a `model.usage` event on the
runtime lane, and the copyable conversation report carries the totals or says
they were not reported.

Mastra reports usage twice, once per model step and again as a run total on its
closing chunk; the host reconciles the two rather than adding them, and keeps
the running sum when a run ends at a timeout or an error before any total
arrives.
