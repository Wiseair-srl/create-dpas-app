# Contributing

Thanks for helping make the DPAS scaffolder better.

## Setup

```bash
pnpm install
pnpm dev                # run the template app (templates/default)
```

Node >= 22.13 and pnpm 10 (via corepack) are required.

## Repository layout

- `templates/default`: the golden application. **This is the product.** It is
  a normal workspace app: run it, test it, change it directly.
- `packages/create-dpas-app`: the CLI. Its build step copies the template
  into the package (`scripts/sync-template.mjs`).
- `examples/generated-default`: a committed generator artifact. Never edit it
  by hand; run `pnpm regen:example` after template changes (CI enforces this
  with `pnpm check:example`).
- `docs/`: the documentation site (VitePress) and ADRs. Run it with
  `pnpm docs:dev`; `pnpm docs:build` also fails on dead links. Architectural
  decisions get an ADR. The guides that ship inside generated apps live in
  `templates/default/docs/` and are `@include`d by the site. Edit them there,
  never twice.

## Quality gates (all must pass)

```bash
pnpm lint
pnpm typecheck
pnpm test            # template contract tests + CLI unit tests, no LLM
pnpm build
pnpm test:e2e        # Playwright against a production build, scripted model
pnpm test:scaffold   # generate a fresh app in /tmp and run ITS gates
pnpm check:example   # committed generator output ↔ current output
pnpm view:check      # the view plane ↔ its committed contract
pnpm domain:check    # the domain plane ↔ its committed snapshot
```

After changing the template run `pnpm regen:example`; after changing a
capability run `pnpm view:snapshot` and/or `pnpm domain:snapshot` in
`templates/default` and commit the artifact.

The rules that keep this project honest:

- No test may require a model provider or API key.
- **Both committed inventories are agent-facing API**:
  `templates/default/.agent-surface/contract.json` for the view plane and
  `capabilities.snapshot.json` for the domain plane. Review their diffs like API
  diffs: a changed description is a changed prompt.
- One domain operation, one model-visible path: if you add a capability,
  decide direct vs contextual, never both (the host refuses to offer it twice
  anyway, but the decision belongs in review).
- The template must start with zero configuration after `create`.

## Making a release

We use [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset          # describe your change (patch/minor/major)
pnpm version-packages   # (maintainers) apply versions
pnpm release            # (maintainers/CI) build + publish with provenance
```

Only `create-dpas-app` is published; the template ships inside it.
