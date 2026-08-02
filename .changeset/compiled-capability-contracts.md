---
"create-dpas-app": minor
---

Upgrade the template to `agent-surface@0.19`: the agent surface is now compiled from source instead of discovered at runtime.

`agent-surface@0.16` replaced runtime surface discovery with a build-time
compiler, `0.17` made its authority mandatory at registration, and `0.18`
introduced contract format v5. The generated app follows
([ADR-0011](https://github.com/pbWise/create-dpas-app/blob/main/docs/adr/0011-compiled-capability-contracts.md)):

- Every capability is declared statically in `app/agent/surface/contracts.ts`.
  `@agent-surface/compiler`'s Vite plugin reads them out of the production
  module graph and emits `.agent-surface/contract.json`; the registry takes that
  artifact as its authority and refuses anything it cannot prove.
- Components supply behaviour only — `read`, `execute`, `when`, `precondition`.
  `useAgentComponent(contract, bindings)` and `useAgentProcedure(contract, ref,
  config)` both take the contract first.
- `useTableAgentComponent` keeps the shared table plane but takes a `contract`
  instead of `type` / `description` / `filterLabels`; the three table screens
  each own a contract, because their capability sets genuinely differ.
- `agent-surface.config.tsx` is deleted, along with the seven per-scenario
  baselines and `coverage-allow.json`. One `contract.json` replaces them, and
  `pnpm view:check` diffs source against it, classifying each change as
  widening, narrowing or neutral. `pnpm surface:static` is gone — `--depth` no
  longer exists.

Two improvements fell out of the move. Per-column filter formats are now
documented per property on each table's `setColumnFilters` schema rather than as
one prose blob, and `additionalProperties: false` makes an unknown filter key a
schema error the model can read off the schema instead of discovering by
rejection. The cost is that descriptions no longer interpolate runtime values:
`sort` names its sortable columns as literal text per contract.

Requires `@agent-surface/*` ≥ 0.19.1.
