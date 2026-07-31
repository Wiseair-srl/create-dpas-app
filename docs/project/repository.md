# Repository and gates

> **This page:** how the scaffolder repository is organized and what keeps it honest. For the anatomy of a *generated* app, see [Project structure](../reference/project-structure.md).

This repository produces one publishable artifact — the `create-dpas-app` CLI — and the application it generates.

```
packages/create-dpas-app/    the CLI (prompts, flags, safe generation)
templates/default/           the golden app — a real, tested workspace member
examples/generated-default/  committed generator output, drift-gated in CI
docs/                        this documentation + ADRs
scripts/                     example regen/drift check + scaffold smoke test
```

## The template-first rule

`templates/default` is a **normal, running application**, not a bag of files with placeholders. It has its own tests, lint, typecheck and build, and it is a workspace member you can `pnpm dev` directly. The CLI's build step copies it verbatim into the package (renaming `.gitignore` → `gitignore`, which npm would otherwise strip), and generation is name substitution plus `.env` creation — nothing more.

That is the property that keeps the scaffolder honest: anything the generated app can do, the template can do here, in this repository, with the same tests.

## Verification pyramid

1. **Contract tests** — `pnpm test`. Capability discovery, lifecycle, staleness, binding, confirmation; domain governance; host protocol units; CLI unit tests. No model, no network, no browser.
2. **End-to-end** — `pnpm test:e2e`. Playwright against a production build: the guided demo (approve *and* deny), the live pipeline under a scripted `LanguageModelV2` (`MODEL_PROVIDER=mock`), roles, accessibility scans, mobile.
3. **Scaffold smoke** — `pnpm test:scaffold`. Builds the CLI, generates a fresh app in a temp directory, installs it standalone, and runs **that** app's lint, typecheck, tests, build and deterministic browser tests.
4. **Drift gate** — `pnpm check:example`. The committed `examples/generated-default` must equal current generator output byte-for-byte. After changing the template, run `pnpm regen:example`.

CI runs all four on Node 22 and 24, and additionally installs a generated app with **npm** to catch pnpm-only assumptions.

## Working on the template

```bash
pnpm install
pnpm dev                # templates/default on :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e
pnpm test:scaffold
pnpm regen:example      # after any template change
```

Two review habits carry unusual weight here:

- **The surface snapshot is API.** `templates/default/src/features/devices/__snapshots__/` records the semantic surface the agent sees. Review its diffs like API diffs — a changed description is a changed prompt.
- **Exposure is an architectural decision, not a flag.** If you add a domain operation, decide *direct tool* or *contextual reference* and never both; the host rejects the catalog either way, but the decision belongs in review.

## Documentation

The guides that ship inside every generated app live in `templates/default/docs/` and are the single source for the corresponding pages on this site — [Architecture](../concepts/architecture.md), the three capability guides, [Tracing a tool call](../guides/tracing-a-tool-call.md) and [Security and confirmation](../security/model.md) are `@include`d from there, so app and site can never drift.

Everything else — this page, the concepts, the reference and the ADRs — lives in `docs/`.

```bash
pnpm docs:dev       # local docs site with hot reload
pnpm docs:build     # static build (also checks for dead links)
pnpm docs:preview   # serve the built site
```

Architectural decisions get an ADR: [Decision records](decisions.md). Contribution workflow and release process: [Contributing](contributing.md).
