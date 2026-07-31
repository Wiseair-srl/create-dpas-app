---
"create-dpas-app": patch
---

Bound a turn that is going wrong: loop detection over both planes, and a
message history that stays replayable when a turn stops early.

The host already had a breaker — `MAX_IDENTICAL_FAILURES = 3`, keyed on
`canonicalId` plus the exact arguments. It catches the classic loop, where the
model retries one call unchanged. It catches nothing else, and the run that
prompted this was nothing else.

A model whose output degenerated mid-turn does not retry. It emits a *fresh*
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
most providers reject outright. The *next* turn would then fail to start, for a
reason belonging entirely to the previous one. Every early exit now answers the
calls it is not going to run with `TOOL_NOT_EXECUTED`, the same code and
wording `settleOrphanedServerCalls` already uses server-side for the same fact.
That includes cancellation, which had the bug before this change: pressing stop
during a step could leave the conversation unable to take another turn.
