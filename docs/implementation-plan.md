# create-dpas-app — implementation plan

Status: living document, written before Phase 2 per the DPAS build directive.

## What is being built

A `create-t3-app`-style scaffolder for the Dual-Plane Agent Stack:

- `packages/create-dpas-app` — the CLI (`pnpm create dpas-app`).
- `templates/default` — a production-quality Device Operations Dashboard that
  demonstrates all four DPAS layers plus assistant-ui as the experience layer.
- `examples/generated-default` — checked-in generated output, drift-checked in CI.
- `docs/` — architecture and how-to guides copied into generated apps.

## Verified dependency matrix

Verified against npm and the local `agent-surface` / `orpc-agent` checkouts on
2026-07-30. The two DPAS libraries are published and identical to their local
sources.

| Layer | Package | Version | Notes |
|---|---|---|---|
| Presentation provider | `@agent-surface/core,react,orpc,testing` | 0.1.0 | registry, hooks, oRPC refs, LLM-free test harness |
| Domain provider | `@orpc-agent/core,ai-sdk,testing` | 1.0.0 | governed runtime over oRPC; AI SDK v5 tools |
| oRPC | `@orpc/server,client,tanstack-query` | 1.14.13 | pinned by orpc-agent peer `^1.14.10` |
| Agent runtime | `@mastra/core` | 1.54.0 | Node >= 22.13; model-version agnostic (v5/v6/v7 providers) |
| AI SDK | `ai` | 5.0.x | **v5 line**: required by `@orpc-agent/ai-sdk` peer `^5` |
| Experience layer | `@assistant-ui/react` | 0.15.1 | headless primitives + external-store runtime |
| App framework | `next` 16.2.x, `react` 19.2.x, `tailwindcss` 4.3.x, `zod` 4.4.x, TS 5.9.x | | |
| Testing | `vitest` 4.1.x, `@playwright/test` 1.62.x, `@testing-library/react` 16.3.x, `@axe-core/playwright` 4.12.x | | |
| CLI | `@clack/prompts` 1.7.x | | args via `node:util` `parseArgs` |

Deliberately **not** used: `@assistant-ui/react-ai-sdk` (current line depends on
`ai@^7`, conflicting with the `ai@^5` requirement above — see ADR-0002) and
`@mastra/ai-sdk` (not needed once the host protocol maps Mastra chunks itself).

## Architecture of the generated app

One sentence per DPAS layer:

- **Agent Surface** owns `view:*` (filters, table, drawer, navigation) plus the
  *contextual* `domain:devices.disable` reference (bound + locked selection,
  required confirmation), registered from the components that own the state.
- **oRPC Agent** owns `domain:*`: `devices.list` / `devices.get` exposed as
  direct server tools (`expose.aiSdk: true`); `devices.disable` is **not**
  aiSdk-exposed — its only model-visible path is the contextual reference.
- **The Agent Host** is application code in `src/agent/host/*`: a versioned
  step-loop NDJSON protocol between the browser half (surface toolset,
  dispatch, confirmation wait) and the server half (per-turn domain toolset,
  Mastra invocation, chunk→frame mapping, collision detection, correlation).
- **Mastra** runs the loop server-side: `agent.stream(modelMessages,
  { toolsets: { domain }, clientTools, maxSteps })`. Client tools end the run
  with `finishReason: "tool-calls"`; the browser executes them through Agent
  Surface and re-POSTs with tool results appended (verified by spike).
- **assistant-ui** renders both modes through one external-store runtime; tool
  renderers visually distinguish VIEW / DOMAIN / CONFIRMATION / ERROR.

Two modes, one pipeline:

- **Live agent** (`MODEL_PROVIDER=anthropic|openai`): Mastra + model.
- **Guided demo** (default): a deterministic scenario runner drives the *same*
  surface toolset, host dispatch, confirmation controller, oRPC procedures,
  reconciliation, and inspector — no model, clearly labelled.
- A test-only scripted `LanguageModelV2` exercises the full live path
  (route → Mastra → toolsets/clientTools → browser dispatch) in CI with no
  credentials (ADR-0006).

## Build order

1. **Phase 2 — golden app first** in `templates/default` (this is the bulk):
   shell → devices feature → domain plane → view plane → host → runtime →
   experience → demo → identity → inspector → reconciliation → tests.
2. **Phase 3 — template extraction**: tokenize (`package.json` name), generate
   `examples/generated-default`, add drift check.
3. **Phase 4 — CLI**: prompts, flags, safe copy via temp dir, env generation,
   install/git steps, polished output, unit tests.
4. **Phase 5 — hardening**: scaffold smoke test, CI, changesets, docs,
   accessibility pass, screenshots, final report.

## Definition of done

`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e &&
pnpm test:scaffold` green from a clean clone, plus the checklist in the build
directive (§22). ADRs record every significant deviation or interpretation.
