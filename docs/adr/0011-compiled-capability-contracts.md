# ADR-0011 · The agent surface is compiled from source, not discovered at runtime

**Status:** accepted · 2026-08-02

## Context

Until `agent-surface@0.15`, "what can the model do in this app" was a question
only a running app could answer. Capabilities were constructed inside
`useAgentComponent` at render time, so their descriptions, schemas and even
their *existence* were functions of props. `useTableAgentComponent` leaned on
that: it built a filter-key hint from whatever keys the screen passed, and
spread `readFilters` / `setFilters` / `clearFilters` into the registration only
when a screen supplied a `filters` object.

Reviewing that surface therefore meant reproducing it. The template shipped an
`agent-surface.config.tsx` of ~250 lines: a jsdom harness with route/session
scenarios, a refusing fetch stub, `matchMedia` and `ResizeObserver` shims and a
two-macrotask settle, whose only job was to mount every screen so the CLI could
write down what appeared. Coverage was a real risk with a real allow-list
(`.agent-surface/coverage-allow.json`): a screen nobody wrote a scenario for was
a screen nobody reviewed, and a capability nothing mounted was invisible.

`agent-surface@0.16` replaced discovery with a compiler, `0.17` made its
authority mandatory at registration, and `0.18` added consumer authorization for
dependency-contributed contracts (contract format v5).

## Decision

Declare every capability statically in `app/agent/surface/contracts.ts`, and let
components supply behaviour only.

The compiler (`@agent-surface/compiler`, a Vite plugin) reads the contract
declarations out of the **production module graph**, hashes each one, and emits
`.agent-surface/contract.json`. The registry is constructed with that artifact
as its `authority` and refuses to register or invoke anything it cannot prove.
A component's runtime binding may supply `read`, `execute`, `when`,
`unavailableReason` and `precondition`, never a description, a schema or an
effect.

Three consequences follow, and all three are the point:

- **Contracts must be statically evaluable.** A top-level `export const`,
  literal values, literal JSON Schema through `fromJsonSchema`. No template
  interpolation, no concatenation, no function calls, no zod. A description that
  varies at runtime is not a contract.
- **The three tables get three contracts.** A shared factory cannot produce
  them, and their capability sets genuinely differ: only `invoices.pending` has
  a row selection. `useTableAgentComponent` survives as the shared *behaviour*,
  taking the contract as a parameter.
- **Coverage stops being a question.** The contract covers every declared
  capability whether or not a screen ever mounts, which is what the artifact's
  `completeness: proven` records.

## Consequences

`agent-surface.config.tsx` is deleted, along with the seven per-scenario
baselines and `coverage-allow.json`; one `contract.json` replaces them.
`pnpm view:check` now diffs source against that artifact and classifies each
change as widening, narrowing or neutral. `pnpm surface:static` is gone, and
`--depth` no longer exists, because there is no longer a shallower answer.

The scripts are named after the **planes**, not the libraries: `view:inspect` /
`view:check` over `@agent-surface/cli`, and `domain:inspect` / `domain:check`
over `@orpc-agent/cli`. That matches the capability ids themselves (`view:…`,
`domain:…`), keeps the two halves visibly symmetric, and means swapping a library
does not rename a command every contributor has in muscle memory. There is
deliberately no bare `view` script: `pnpm view` is a built-in registry command,
so it would be silently shadowed.

Two things got better rather than merely different. Per-column filter formats
are now documented per property in each table's `setColumnFilters` schema
instead of as one prose blob, and `additionalProperties: false` turns an unknown
filter key into a schema error the model can read off the schema, where it used
to be a runtime precondition it could only discover by being rejected.

One thing got worse, and is worth stating plainly: the dynamic hints are gone.
`sort` no longer names its sortable columns from a live accessor map; each
contract spells them out. When a screen's filters or columns change, its
contract must change with it, and nothing but review enforces that they agree.

The role-based scenarios the old harness carried (`pending-as-analyst`,
`signed-out`) moved into `app/features/invoices/capabilities.test.tsx`, where
they are assertions rather than baselines.

This requires `@agent-surface/*` ≥ 0.19.1. 0.19.0's compiler ran only during a
production build, which left `pnpm dev` and any test that mounts a registering
component with no authority at all.
