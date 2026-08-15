# ADR-0001 · Consume published `@agent-surface/*` and `@orpc-agent/*`

**Status:** accepted · 2026-07-30

## Context

Both capability providers exist as local checkouts *and* as npm packages, at
identical versions. A scaffolder could vendor them, link them through the
workspace, or depend on the published releases. Only one of the three survives
contact with a generated app: a project created in someone else's directory has
no workspace to link into, and a vendored copy is a fork nobody asked for.

## Decision

The template and generated apps depend on the published packages with caret
ranges. No workspace linking, no vendoring. The local checkouts stay what they
were: the API reference used while writing the template.

## Consequences

- Generated apps install anywhere without registry tricks.
- `@agent-surface/*` is 0.x, where a minor bump may break. Caret-on-0.x
  (`^0.19.1` ≡ `>=0.19.1 <0.20.0`) is the safe range, and the template must be
  revalidated before widening it, which the scaffold smoke test surfaces, since
  it installs fresh versions into a temp directory and runs *that* app's gates.
- The template can only use APIs that are actually released. Something that
  exists in a local checkout and not on npm does not exist here.
