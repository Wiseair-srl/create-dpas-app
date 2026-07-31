# create-dpas-app

## 0.2.0

### Minor Changes

- 8fb7de7: Initial release: scaffold a Dual-Plane Agent Stack application.

  Generates a device operations dashboard demonstrating all four DPAS layers —
  Agent Surface (`view:*`), oRPC Agent (`domain:*`), an application-owned Agent
  Host with a versioned browser/server protocol, and Mastra — with assistant-ui
  as the replaceable experience layer. The generated app runs a deterministic
  guided demo of the golden scenario with zero configuration, and ships
  contract tests, Playwright e2e (including a credential-free live-pipeline
  run), docs, and an Agent Inspector.

- 4898f39: Connect an OpenRouter key from the assistant panel, and restore pointer
  cursors on interactive elements.

  The generated app can now go live without editing `.env`: paste a key in the
  assistant's model settings and pick any OpenRouter model. The key is held in
  the server process's memory only — never written to disk, never returned to
  the browser (a masked hint is), never in a client bundle. Runtime entry is
  enabled in development and disabled in production builds unless
  `ALLOW_RUNTIME_MODEL_KEY=true`, because one process shares the key with every
  visitor.

  Also restores `cursor: pointer` on buttons, tabs, selects, checkboxes and
  links (Tailwind v4 dropped it from preflight), with `not-allowed` on disabled
  controls and `col-resize` on the assistant panel separator.

- 421e873: Show what a conversation costs: an input/output token counter in the assistant
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
  belong to. Reasoning bills _as_ output and is already inside `outputTokens`;
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

### Patch Changes

- 421e873: Move the template to `@agent-surface/*@^0.5.0`.

  It was pinned at `^0.3.0`, and caret on a `0.x` range does not cross a minor —
  so two releases of the library the template is built on had shipped without it
  picking either up. 0.4.0 in particular fixed two meta-mode gaps this template
  had reported: `surface_discover` now marks a refused scope with
  `scopeRejected: {prefixes}`, so an empty payload is distinguishable from a
  surface with nothing mounted, and all seven meta parameters carry descriptions.

  0.5.0 removes the D28 compatibility flags rather than flipping them —
  `AgentToolsetOptions.descriptionIncludesState`,
  `RegistryOptions.snapshotMergesContextualNote`, and `stableDescriptionOf` are
  gone, and the split composition is the only one. **No behavior change here**:
  the template set both flags to `false` when D28 landed, so it was already on
  what is now the sole path. The migration is deletion — five call sites and the
  comments that explained why the flags were set. `stableDescriptionOf` was never
  used.

  The reason the flags mattered is unchanged and still load-bearing, so the
  comments say it without naming a flag: tool definitions sit at the front of the
  provider's cached prompt prefix, so anything volatile folded into `description`
  invalidates the whole conversation behind it on every step. Availability and
  contextual notes ride in `AgentTool.state` and
  `AgentProcedureDescriptor.contextualNote`, and the host renders them after the
  messages — which is what `catalog.ts` builds `frontendState` for. Hosts that
  were on the _defaults_ rather than the flags have real work to do at 0.5; this
  one does not.

  `@orpc-agent/*` was already at `^2.0.0`, which is current.

- f55fe09: Give DOM tests room to start up. They mount the real feature tree in jsdom;
  the assertions take milliseconds, but standing up the environment on a cold
  or busy machine can exceed vitest's 5s default and fail a passing test. The
  generated app now sets an explicit 30s timeout for DOM tests and 20s for node
  tests.
- 2e8aca8: Fix OpenRouter model routing: send the vendor-qualified id upstream.

  Mastra's model router strips the leading provider segment, so a bare
  `anthropic/claude-sonnet-4.5` reached OpenRouter as `claude-sonnet-4.5` — not
  a valid id there — and every run failed with "No endpoints found that support
  tool use". Model ids are now normalized to the gateway form
  (`openrouter/anthropic/claude-sonnet-4.5`), which sends
  `anthropic/claude-sonnet-4.5` upstream. Both the UI-connected and
  `MODEL_PROVIDER=openrouter` paths were affected; users may type either form.

  "Test key" now also verifies the chosen model exists on OpenRouter and
  supports tool calling, so this failure is diagnosed before a conversation
  rather than during one.

- 421e873: Bound a turn that is going wrong: loop detection over both planes, and a
  message history that stays replayable when a turn stops early.

  The host already had a breaker — `MAX_IDENTICAL_FAILURES = 3`, keyed on
  `canonicalId` plus the exact arguments. It catches the classic loop, where the
  model retries one call unchanged. It catches nothing else, and the run that
  prompted this was nothing else.

  A model whose output degenerated mid-turn does not retry. It emits a _fresh_
  malformed call each time, so an identity-keyed counter sits at 1 forever: one
  `surface_act` against `view:devices.filters.set` rejected as `INVALID_INPUT`,
  then a `surface_act` with no arguments at all that crashed the meta handler,
  then more. Every entry unique, the counter never advancing, the turn bounded
  only by `MAX_STEPS_PER_TURN` — and in practice by the user pressing stop. The
  inactivity watchdog does not help either: `modelTimeoutMs` waits for silence,
  and a degenerating model is loud.

  `loop-guard.ts` now counts three shapes of stuck instead of one. **Identical**
  is the old counter, kept, and now keyed on arguments sorted rather than
  `JSON.stringify` order, so shuffled keys read as a repeat instead of a new
  attempt. **Consecutive** trips after four failures back to back regardless of
  what failed, which is the one that catches varied garbage; any success resets
  it, so a turn making progress can still fail occasionally. **Refused** trips on
  the second call of something that already answered `retry: "no"` — the
  instructions tell the model that "no" means do not retry, and this is what
  enforces it.

  Server-plane results feed the same guard. They were never counted before, so a
  domain tool failing in a loop was unbounded in a way a view tool was not, for
  no reason other than which side executed it. `tool-result` frames carry no
  input, so the guard's key is rebuilt from the matching `tool-call` frame.

  A third gap, found the hard way: `dispatchFrontendToolCall` awaited
  `tool.execute` with no `try`. The surface contract says invocation failures
  come back as typed results and never throw, so on paper that await cannot
  reject — but when something below the contract breaks it (a library defect, or
  a dev probe that throws out of `invoke()` by design), the rejection escaped
  `runTurn`, escaped `startLiveTurn`'s `try/finally`, and became an unhandled
  rejection. One bad tool call took the entire run with it: no result, no
  history, no audit entry, and a console `TypeError` as the only trace. It is now
  contained and reported as `EXECUTION_FAILED { retry: "no" }`, so the model gets
  something it can act on, the loop guard counts it, and the Inspector records a
  settled dispatch instead of a hole. The defect still surfaces — console error,
  failed card — it just no longer decides the fate of the turn.

  The other half is history. A turn that stops mid-step still persists what it
  has, and `runTurn` returned with the frontend calls it never executed left
  unanswered — an assistant `tool-call` with no matching `tool-result`, which
  most providers reject outright. The _next_ turn would then fail to start, for a
  reason belonging entirely to the previous one. Every early exit now answers the
  calls it is not going to run with `TOOL_NOT_EXECUTED`, the same code and
  wording `settleOrphanedServerCalls` already uses server-side for the same fact.
  That includes cancellation, which had the bug before this change: pressing stop
  during a step could leave the conversation unable to take another turn.

- 421e873: Fix meta mode: give the model instructions that describe the catalog it was
  actually handed.

  `ASSISTANT_INSTRUCTIONS` was a single constant written for the direct
  projection — "Tools prefixed `view_` … Tools prefixed `domain_` …" — and
  `buildAssistantAgent()` took no mode, even though `catalogMode` already
  arrived on every step-request and was echoed back on `step-start`. Under
  `meta` those tool names do not exist: there are three verbs
  (`surface_discover`, `surface_read`, `surface_act`) and a discovery
  round-trip.

  The failure that exposed it was total rather than degraded. Primed to expect a
  `view_` namespace, the model called `surface_discover({scope:["view_"]})` and
  then `{scope:["*"]}`. Neither token intersects the route's scope floor, and a
  disjoint scope returns an empty surface rather than falling back to the floor —
  `AS-META-002`, decided and pinned upstream, and the correct behavior. But an
  empty snapshot is byte-identical to a surface with nothing mounted, so the
  model concluded the dashboard had no capabilities and stopped. Calling
  `surface_discover` with no arguments at all would have returned everything.

  `domain:devices.disable` is what made it fatal. It is `expose.aiSdk: false` on
  purpose, so it never appears as a direct server tool and reaches the model only
  as a contextual procedure in the surface snapshot. In direct mode that
  procedure sits in the frontend tool block and the prompt bug is invisible; in
  meta mode, blanking the snapshot removes the operation's only path and "disable
  the offline devices in Turin" becomes unanswerable.

  `assistantInstructions(mode)` now composes a shared preamble and shared
  guidelines with a mode-specific description of the projection. The meta text
  names the three verbs, states the discovery loop, tells the model to call
  `surface_discover` with no arguments and never to invent a scope token, and
  says plainly that an empty surface means the scope was wrong rather than that
  the page is empty. The shared guidelines moved from tool-name wording to plane
  wording, so they read correctly in both modes.

  A second, milder version of the same mistake shows up once discovery works:
  the model names the right capability and then flattens that capability's
  arguments next to `capabilityId`, instead of nesting them under `input`.
  `req.input` is `undefined`, the capability rejects an empty payload, and
  `INVALID_INPUT` reads as "wrong capability" rather than "wrong envelope". The
  meta text now carries a worked `surface_act` call showing the nesting, and says
  what flattening produces. Naming the parameter in a signature line was not
  enough; one concrete example is.

  Both libraries are conformant here — prompting is the host's job, and the
  adapter contract says nothing about system prompts. Two upstream ergonomics
  gaps made the mistake easy to fall into and impossible to recover from, and are
  worth reporting rather than working around: `surface_discover`'s `scope`
  property carries no description and no enum, so valid tokens cannot be learned
  from the tool definition; and the blank payload carries no marker, unlike the
  `truncated` marker that budget truncation rides on for exactly the reason that
  a silent reduction is invisible to the party affected by it.

- fa91bba: Render assistant answers as markdown, and give model reasoning its own place.

  Answers arrived as plain text, so emphasis and inline code showed their
  syntax (`**turin-vanchiglia-01**`). They now render through react-markdown,
  which builds a React tree rather than injecting HTML.

  Model reasoning now streams on its own protocol frame and renders as a
  collapsed "Model reasoning" block instead of being mixed into the answer.
  Models that leak their channel format into visible text (`<|channel|>analysis`,
  a bare `thought` line) are cleaned before display; ordinary prose, including
  the word "thought" in a sentence, is untouched.

- 06c8d51: Keep the assistant transcript pinned to the newest content, and stop yanking
  the reader back when they scroll away.

  A turn's answer arrives under several tool cards, and the transcript was
  leaving it below the fold beneath a half-clipped card. assistant-ui's
  auto-scroll watches the viewport for resize — a box whose height never changes
  — so growth reached it only through its MutationObserver, which reads
  `scrollHeight` the instant a node is appended, before that card has laid out
  (markdown, monospace ids, the Input/Result `<details>`). It scrolled to an
  already-stale height and landed short. Its `isAtBottom` flag also only updates
  on a narrow set of scroll transitions, so once stale it stayed `true` and every
  later growth pulled the reader back down — wheel and trackpad scrolling never
  fire `pointerdown`, so its cancel path missed them too.

  The generated app now owns this: a ResizeObserver on the content box (the thing
  that actually grows, and which fires when layout settles) re-pins only while
  the reader is within 120px of the bottom, and "at bottom" is derived from the
  live scroll position on every scroll event. The viewport's own auto-scroll
  props are off, so nothing competes. A "Jump to latest" pill appears whenever
  the newest content is out of view.
