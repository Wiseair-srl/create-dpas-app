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
2. **End-to-end** — `pnpm test:e2e`. Playwright against a production build: the live pipeline under a scripted `LanguageModelV2` (`MODEL_PROVIDER=mock`), URL-synced narrowing, the chase dialog, and role authority.
3. **Scaffold smoke** — `pnpm test:scaffold`. Builds the CLI, generates a fresh app in a temp directory, installs it standalone, and runs **that** app's lint, typecheck, tests, build and deterministic browser tests.
4. **Drift gate** — `pnpm check:example`. The committed `examples/generated-default` must equal current generator output byte-for-byte. After changing the template, run `pnpm regen:example`.
5. **View gate** — `pnpm view:check`. The capability contract compiled from the template's source must equal the committed `.agent-surface/contract.json`, and each difference is reported as widening, narrowing or neutral. `pnpm view:inspect` prints the same contract to read rather than to gate. After changing a capability, run `pnpm view:snapshot` in `templates/default` and commit the artifact.
6. **Domain gate** — `pnpm domain:check`. The same bargain for the other plane: the inventory read from `server/runtime.ts`'s `governance` export must equal the committed `capabilities.snapshot.json`. `pnpm domain:inspect` prints it as a table, runtime policies included. Update with `pnpm domain:snapshot`.

Review a diff in either artifact like an API diff, because it is one — a changed description is a changed prompt, and a capability that gains a surface has gained an audience. What the domain gate does **not** do is evaluate policies: it reports that `gate-model-writes` and `analyst-hides-writes` exist and in which phases, never which capabilities they gate. A `0` in its APPROVAL column is a statement about metadata, not about reachability.

CI runs all six on Node 22 and 24, and additionally installs a generated app with **npm** to catch pnpm-only assumptions.

## Working on the template

```bash
pnpm install
pnpm dev                # templates/default on :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e
pnpm test:scaffold
pnpm view:inspect       # what an agent can reach in the view plane
pnpm view:check         # …and whether the committed contract still says so
pnpm domain:inspect     # the same two questions for the domain plane
pnpm domain:check
pnpm regen:example      # after any template change
```

Two review habits carry unusual weight here:

- **Both inventories are API.** `templates/default/.agent-surface/contract.json` records the view plane and `capabilities.snapshot.json` the domain plane; `pnpm view:check` and `pnpm domain:check` gate them. Review their diffs like API diffs — a changed description is a changed prompt.
- **Exposure is an architectural decision, not a flag.** If you add a domain operation, decide *direct tool* or *contextual reference* and never both; the host rejects the catalog either way, but the decision belongs in review.

## Documentation

The guides that ship inside every generated app live in `templates/default/docs/` and are the single source for the corresponding pages on this site — [Architecture](../concepts/architecture.md), the three capability guides, [Tracing a tool call](../concepts/architecture.md) and [Security and confirmation](../security/model.md) are `@include`d from there, so app and site can never drift.

Everything else — this page, the concepts, the reference and the ADRs — lives in `docs/`.

```bash
pnpm docs:dev       # local docs site with hot reload
pnpm docs:build     # static build (also checks for dead links)
pnpm docs:preview   # serve the built site
```

Architectural decisions get an ADR: [Decision records](decisions.md). Contribution workflow and release process: [Contributing](contributing.md).
