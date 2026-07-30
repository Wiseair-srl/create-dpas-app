# Repository architecture

This repo produces one publishable artifact — the `create-dpas-app` CLI — and
the application it generates.

```
packages/create-dpas-app/    the CLI (prompts, flags, safe generation)
templates/default/           the golden app — a real, tested workspace member
examples/generated-default/  committed generator output, drift-gated in CI
docs/                        this documentation + ADRs
scripts/                     example regen/drift-check + scaffold smoke test
```

## The template-first rule

`templates/default` is a **normal, running application**, not a bag of files
with placeholders. It has its own tests (46 unit/contract tests, 17 Playwright
tests), lint, and build. The CLI's build step copies it verbatim into the
package (renaming `.gitignore` → `gitignore` for npm), and generation is
token replacement of the project name plus `.env` creation — nothing more.
Anything the generated app can do, the template can do in this repo, which is
what keeps the scaffolder honest.

The architecture of the generated application itself — the four DPAS layers,
the host protocol, the confirmation model — is documented where its users
will find it: [templates/default/docs/architecture.md](../templates/default/docs/architecture.md)
(shipped with every generated app), with a live tour at `/architecture` in
the running app.

## Verification pyramid

1. **Contract tests** (`pnpm test`) — capability discovery/lifecycle/
   staleness/binding/confirmation, domain governance, host protocol units.
   No model, no network, no browser.
2. **E2E** (`pnpm test:e2e`) — a production build driven by Playwright: the
   guided demo (approve + deny), the LIVE pipeline under a scripted
   `LanguageModelV2` (`MODEL_PROVIDER=mock`), roles, accessibility scans,
   mobile.
3. **Scaffold smoke** (`pnpm test:scaffold`) — builds the CLI, generates a
   fresh app in a temp dir, installs standalone, and runs THAT app's lint,
   typecheck, tests, build, and deterministic browser tests.
4. **Drift gate** (`pnpm check:example`) — the committed example must equal
   current generator output byte-for-byte.

Decision records live in [docs/adr/](adr/): published-package strategy,
the host-protocol-over-react-ai-sdk decision, AI SDK v5 pinning, the embedded
JSON store, confirmation topology, the scripted model, and demo identity.
