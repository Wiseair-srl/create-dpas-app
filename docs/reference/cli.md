# CLI reference

> **This page:** every flag, prompt and exit code of `create-dpas-app`, and exactly what it writes.

```bash
pnpm create dpas-app [project-name] [options]
npm  create dpas-app@latest [project-name] -- [options]
yarn create dpas-app [project-name] [options]
bun  create dpas-app [project-name] [options]
```

## Options

| Flag | Values | Default | Notes |
|---|---|---|---|
| `[project-name]` | package name | `my-dpas-app` | Also the directory name. Scoped names (`@scope/name`) create `name/` |
| `-y, --yes` | — | off | Accept every default; no prompts. For CI and scripts |
| `--package-manager` | `pnpm` · `npm` · `yarn` · `bun` | detected from `npm_config_user_agent`, else `pnpm` | Used for install and for the printed next steps |
| `--model-provider` | `none` · `anthropic` · `openrouter` | `none` | Uncomments that provider's key line in `.env`, empty. **Never writes a key** |
| `--install` / `--no-install` | — | install | `--no-install` prints the install command instead |
| `--git` / `--no-git` | — | init | `--git` initializes a repo on `main` and makes one unsigned initial commit |
| `--example <name>` | `default` | `default` | Template to generate |
| `-h, --help` | — | — | Print help and exit 0 |
| `-v, --version` | — | — | Print the CLI version and exit 0 |

`--model-provider` accepts `openrouter` only through `.env` after generation — the prompt offers the three above. See [Connecting a model](../guides/connecting-a-model.md).

## The prompts

With no flags, one linear path — name → package manager → model mode → install → git — and every step has a flag that skips it. Cancelling at any prompt exits `130` and creates nothing.

## Name rules

Lowercase; at most 214 characters; no leading dot or underscore; letters, digits, `.`, `-`, `_`, `~`, optionally `@scope/`. Names that would break `package.json`, imports or the filesystem are rejected before anything is written.

## What generation does

1. **Copies the template** — excluding `node_modules`, `.next`, `.data`, `coverage`, `test-results`, `playwright-report`, `.env`, `next-env.d.ts` and build info.
2. **Restores `.gitignore`** — npm strips it from published packages, so the template ships it as `gitignore` and the CLI renames it back.
3. **Replaces the project name** in `package.json` and `README.md`. That is the whole templating: no placeholder language, no code generation.
4. **Writes `.env` from `.env.example`**, with the chosen provider's key line uncommented and empty, and **every other key left commented**. The app decides which provider to use from which key is set, so there is no separate switch to keep in agreement.

Everything is materialized in a temp directory and moved into place only when complete, so a failed run never leaves a half-generated project. The CLI refuses a destination that exists and is non-empty (`.git` and `.DS_Store` excepted) rather than overwriting anything.

It makes **no network calls** of its own and sends **no telemetry**; the only network access is the package manager's install, which you can decline.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (also `--help`, `--version`) |
| `1` | Unexpected failure |
| `2` | Bad arguments, invalid name, unknown template, or an unsafe destination |
| `130` | Cancelled at a prompt |

Failures **after** generation degrade instead of aborting: if `install` fails you get a warning plus the command to run yourself, and a failed initial commit leaves the repository initialized.

## Recipes

```bash
# fully non-interactive, no install, no git — what CI does
pnpm create dpas-app smoke-app --yes --no-install --no-git

# npm, with Anthropic selected (key still goes in .env yourself)
npm create dpas-app@latest ops-console -- --package-manager npm --model-provider anthropic
```
