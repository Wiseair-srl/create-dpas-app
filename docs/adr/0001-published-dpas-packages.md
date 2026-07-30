# ADR-0001 — Consume published `@agent-surface/*` and `@orpc-agent/*`

**Status:** accepted · 2026-07-30

## Context

The build directive says to inspect the local Agent Surface implementation and
configure a workspace workflow "if Agent Surface is a local workspace package
rather than a published dependency". Inspection showed both libraries are
published to npm at versions identical to the local checkouts:
`@agent-surface/{core,react,orpc,testing}@0.1.0` and
`@orpc-agent/{core,ai-sdk,testing,...}@1.0.0`.

## Decision

The template and generated apps depend on the published packages with caret
ranges (`^0.1.0`, `^1.0.0`). No workspace linking, no vendoring. The local
checkouts remain the API reference used while writing the template.

## Consequences

- Generated apps install anywhere without registry tricks.
- `@agent-surface/*` is 0.x: minor bumps may break. The scaffolder pins with
  caret-on-0.x (`^0.1.0` ≡ `>=0.1.0 <0.2.0`), which is the safe range.
- If a future agent-surface 0.2 changes APIs, the template must be revalidated
  before widening the range (tracked by the scaffold smoke test, which installs
  fresh versions).
