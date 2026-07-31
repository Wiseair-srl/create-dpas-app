# Testing without an LLM

> **This page:** how the generated app proves its behaviour — including the agent path — with no model provider, no network and no flake. Nothing in `pnpm test` or `pnpm test:e2e` needs a key.

A model is a terrible test oracle: it is non-deterministic, costs money, and can pass a suite for the wrong reason. So the model is the *only* thing these tests replace. Everything else — capability registration, availability, binding, confirmation, governance, the host protocol, the browser dispatch — is exercised for real.

## The three levels

### 1. Contract tests — `pnpm test`

Vitest, jsdom, no HTTP, no browser, no model.

**View capabilities** through `@agent-surface/testing` — mount the component tree, then talk to the surface the way an agent would (`src/features/devices/capabilities.test.tsx`):

```tsx
const { surface } = await mount();
expect(surface).toExpose("view:devices.table.selectRows");
expect(await surface.invoke("view:devices.table.selectRows", { ids, mode: "replace" })).toBeOk();
expect(await surface.observe("view:devices.table.readState")).toMatchObject({ selectedIds: ids });
```

**Domain capabilities** through `@orpc-agent/testing` — the governed runtime, not the raw handler (`src/server/domain.test.ts`):

```ts
const { runtime } = runtimeFor("operator");
const result = await runtime.invoke("devices.disable", { deviceIds: ["d-mi-01"] });
expect(result.status).toBe("completed");
```

**The host** in isolation (`src/agent/host/host.test.ts`, `server-compose.test.ts`): wire-name round-tripping, catalog composition, duplicate-path rejection, orphaned server calls, protocol validation.

Also covered here: the demo scenario runner, the runtime model-config store and its production guard, the config routes' *never echo the key* contract, and the reasoning-channel sanitizer.

### 2. End-to-end — `pnpm test:e2e`

Playwright against a **production build** on port 3100, in scripted-model mode (`MODEL_PROVIDER=mock`). A hand-written `LanguageModelV2` emits a fixed sequence of tool calls, so the *entire live path* — route handler, Mastra loop, NDJSON frames, browser dispatch, confirmation, oRPC execution, reconciliation — runs in CI with zero credentials ([ADR-0006](../adr/0006-scripted-model-for-live-path-ci.md)).

The specs: `guided-demo`, `live-mock`, `dashboard`, `roles`, `model-settings`, `a11y` (axe scans) and `mobile` (iPhone viewport).

### 3. Governance you should assert for anything you add

When you add a capability, copy the shape of the existing tests rather than only testing the happy path:

| Assert | Because |
|---|---|
| exposed / **not** exposed per identity | authority hides — a viewer must not see it at all |
| unavailable with a reason in the wrong state | state discloses — the reason is the model's next step |
| invalid input rejected before the handler runs | validation is the pipeline's job, not yours |
| locked/bound fields cannot be overridden | this is what stops a hijacked model re-aiming a call |
| confirmation: approve · deny · expiry · **mismatch** | mismatch is the bait-and-switch test |
| the typed error and its `retry` hint | the model reads these; regressions here are silent |

`src/features/devices/capabilities.test.tsx` covers every row above for `domain:devices.disable`. It is the file to copy.

## The surface snapshot is API

`src/features/devices/__snapshots__/` holds the committed semantic surface — every capability, description and schema the agent can see. **Review its diffs like API diffs**: a changed description is a changed prompt, and a removed capability breaks plans a model may already be making.

## Commands

```bash
pnpm test          # contract + governance + host units
pnpm test:watch    # the same, watching
pnpm test:e2e      # Playwright over a production build, scripted model
pnpm lint
pnpm typecheck
```

In this repository (not the generated app) two more gates run: `pnpm check:example` compares the committed example against current generator output byte-for-byte, and `pnpm test:scaffold` generates a fresh app in a temp directory and runs *its* gates. See [Repository and gates](../project/repository.md).

## Rules that keep the suite honest

- **No test may require a model provider or an API key.** If a change makes one necessary, the change is wrong.
- **Test through the agent-facing surface**, not through internals: if a capability is only reachable in a test by calling the component's props, the agent cannot reach it either.
- **Failures are results, not exceptions.** Assert the code and the `retry` hint, not that something threw.
