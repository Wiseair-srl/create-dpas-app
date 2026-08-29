# Testing without an LLM

> **This page:** how the generated app proves its behaviour, including the agent path, with no model provider, no network and no flake. Nothing in `pnpm test` or `pnpm test:e2e` needs a key.

A model is a terrible test oracle: it is non-deterministic, costs money, and can pass a suite for the wrong reason. So the model is the *only* thing these tests replace. Everything else (capability registration, availability, binding, approvals, governance, the host protocol, the browser dispatch) is exercised for real.

## The five levels

### 1. Governance · `capabilities/governance.test.ts`

The governed runtime, not the raw handlers. No HTTP, no browser, no model.

```ts
// Authority hides: an analyst's catalog simply lacks it…
const ids = (await runtime.describe("aiSdk", analyst)).map((t) => t.id);
expect(ids).not.toContain("issue-invoice");

// …and invoking it by name is NOT FOUND, not forbidden.
const denied = await runtime.invoke("issue-invoice", { id: 5 }, { ...analyst, surface: "direct" });
expect(denied.error.code).toBe("CAPABILITY_NOT_FOUND");

// Gate for consequence: a model-initiated call suspends, and nothing moves.
const pending = await runtime.invoke("issue-invoice", { id: 5 }, { ...controller, surface: "aiSdk" });
expect(pending.status).toBe("approval-required");
expect(getInvoiceRow(5)?.status).toBe("draft");
```

The same file asserts the other half of the rule: the identical call on `surface: "direct"`, a person clicking a button, completes ungated.

### 2. Presentation contracts · `app/features/invoices/capabilities.test.tsx`

The REAL screen mounts against the app's own registry, with a captured fake at the exact seam where HTTP would begin.

```tsx
const surface = await mount();
expect(surface).toExpose("view:invoices.pending.setFilters");
expect(await surface.invoke("view:invoices.pending.setFilters", { due: "overdue" })).toBeOk();

const after = await surface.observe("view:invoices.pending.readState");
expect(after.rowCount).toBe(7);
expect(after.totalRows).toBe(13);   // what it narrowed away, so the model can widen
```

And the contextual binding's real guarantee, that the bound field is not merely ignored but **absent**:

```tsx
const procedure = surface
  .snapshot()
  .procedures.find((p) => p.procedureId === "domain:update-collection-status");
expect(procedure.boundFields.find((f) => f.path === "invoiceId")?.locked).toBe(true);
```

### 3. End to end · `pnpm test:e2e`

Playwright against a **production build** on port 3210, in scripted-model mode (`MODEL_PROVIDER=mock`). A hand-written `LanguageModelV2` emits a fixed sequence of tool calls, so the *entire live path* (the Hono route, the Mastra loop, NDJSON frames, client-tool suspension, browser dispatch, oRPC execution, reconciliation) runs in CI with zero credentials ([ADR-0006](../adr/0006-scripted-model-for-live-path-ci.md)).

The script deliberately batches a **server tool and a client tool in one message**, because that is the case that suspends the run mid-step and makes the host answer the server call itself. Keeping it in the script means CI exercises `settleOrphanedServerCalls` on every run.

`e2e/copilot.spec.ts` asserts what a demo would only show: both planes ran, the table actually narrowed, the URL moved with it, and the answer's figures match the KPI, because both come from one function in `capabilities/model.ts`.

### 4. The compiled contract · `pnpm view:check`

Compiles the capability contract from the production module graph and diffs it against the committed `.agent-surface/contract.json`. It fails when the two disagree, and reports each change as **widening**, **narrowing** or **neutral**. A widening diff is a bigger prompt and a bigger blast radius, and is meant to be argued for in review.

```
AGENT SURFACE CHECK · PASS
Contract      e13fd0d4…
Completeness  proven
Capabilities  36

SOURCE ↔ SNAPSHOT (0) · widening 0 · narrowing 0 · neutral 0
```

There is nothing to reach and nothing to allow-list. Capabilities are declared statically in `app/agent/surface/contracts.ts`, so the contract covers all of them whether or not a screen ever mounts, which is what `Completeness proven` means. Regenerate with `pnpm view:snapshot` and commit the result; treat the diff like an API diff, because it is one.

### 5. The domain inventory · `pnpm domain:check`

The same bargain for the other plane, and the reason the two commands are named after planes rather than after the libraries behind them. It reads the `governance` export of `server/runtime.ts` (registry plus runtime policies, without building a runtime) and fails when it disagrees with the committed `capabilities.snapshot.json`. `pnpm domain:inspect` prints it as a table. Regenerate with `pnpm domain:snapshot`.

```
10 capabilities · 10 exposed
risk 5 low · 3 medium · 2 high · declared gates: 0 approval · 6 policy-scoped capabilities · 2 runtime policies
```

Read `declared gates` carefully: `0 approval` is a statement about `meta.approval`, never on its own a statement that nothing is gated. The `POLICIES` cells include `runtime:gate-model-writes` and `runtime:analyst-hides-writes` wherever their authoritative scopes match. That is candidate coverage, not a verdict: the real surface, actor, input, and context still determine approval, hiding, or allowing at level 1.

## What to assert for anything you add

Copy the shape of the existing tests rather than only the happy path:

| Assert | Because |
|---|---|
| exposed / **not** exposed per identity | authority hides: an analyst must not see it at all |
| `CAPABILITY_NOT_FOUND`, not `FORBIDDEN` | "forbidden" tells a prober the capability is real |
| unavailable with a reason in the wrong state | state discloses: the reason is the model's next step |
| invalid input rejected before the handler runs | validation is the pipeline's job, not yours |
| bound fields absent from the advertised schema | this is what stops a hijacked model re-aiming a call |
| gated: suspends, and **the data does not move** | an approval that acts first is not an approval |
| gated: rejecting changes nothing | the denial path is the one that matters |
| the typed error and its `retry` hint | the model reads these; regressions here are silent |

## Commands

```bash
pnpm test            # governance, contracts, the experience layer
pnpm test:watch
pnpm test:e2e        # Playwright over a production build, scripted model
pnpm view:inspect    # the view plane: look at what you changed
pnpm view:check      # …and its gate
pnpm domain:inspect  # the domain plane: same two questions
pnpm domain:check
pnpm lint · typecheck
```

In this repository (not the generated app) two more gates run: `pnpm check:example` compares the committed example against current generator output byte-for-byte, and `pnpm test:scaffold` generates a fresh app in a temp directory and runs *its* gates. See [Repository and gates](../project/repository.md).

## Rules that keep the suite honest

- **No test may require a model provider or an API key.** If a change makes one necessary, the change is wrong.
- **Test through the agent-facing surface**, not through internals: if a capability is only reachable in a test by calling the component's props, the agent cannot reach it either.
- **Failures are results, not exceptions.** Assert the code and the `retry` hint, not that something threw.
- **A capability the contract does not declare does not exist.** Add it to `app/agent/surface/contracts.ts` first, then bind behaviour to it; the registry refuses anything else.
