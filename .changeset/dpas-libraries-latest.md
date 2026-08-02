---
"create-dpas-app": patch
---

Move the template to the current `@agent-surface/*` and `@orpc-agent/*`.

`@agent-surface/{core,orpc,react,cli,compiler,testing}` all go to `^0.22.0`, and
`@orpc-agent/{core,ai-sdk,mcp,testing}` to `^2.0.2` with `@orpc-agent/cli` at
`^2.1.0`. Nothing in the generated app needed adjusting: the only library change
in either line is a metadata patch pointing `homepage` and the package READMEs at
the documentation domains (`agent-surface.dev`, `orpc-agent.dev`).

The one behavioural change is in the two CLIs, and it is presentation only. Both
add `--verbosity min|normal|detail` and align the two inventories on one look —
compact by default, colour graded by effect and reach, `--detail` for the grouped
inventory with descriptions and provenance. `--json` is byte-identical, and the
plain renderer colours only when attached to a terminal, so piped, under `CI` or
with `NO_COLOR` the bytes are what they were. `pnpm view:check` and `pnpm
domain:check` read that output, so both gates are unaffected — the compiled
contract and the domain snapshot are unchanged and neither committed artifact
needed regenerating.

**Why agent-surface lands on 0.22.0 rather than 0.21.0.** `cli@0.21.0` shipped
alone while its six siblings stayed at 0.20.1. Upstream has since called that a
release failure and repaired it: there is no 0.21.0 of `core`, `compiler`,
`orpc`, `react`, `testing` or `webmcp` on npm, 0.22.0 puts all seven back on one
line with no code change outside `cli`, and a new `check:versions` gate blocks
the release when they diverge. The hazard was specific — internal dependencies
publish as carets, and a caret on a `0.x` version pins the minor, so
`cli@0.21.0` asks for `core@^0.20.1` and would have refused `core@0.21.0`. A
consumer pairing them would have resolved **two copies of `core`**, and since
authority identity lives in module-level `WeakMap`s, a capability minted by one
copy is rejected by the other. `pnpm why @agent-surface/core` now reports a
single `0.22.0` on every path through the template's graph.

The same shape in `@orpc-agent` is not the same hazard and needs no repair: it is
past 1.0, where `cli@2.1.0` depending on `core@^2.0.2` is an ordinary wide range
rather than a minor pin. That graph also resolves to one copy of `core`.

ADR-0001 requires a template on widened ranges to be revalidated by the scaffold
smoke test rather than against the workspace's own `node_modules`, since that
test installs the published versions fresh into a temp directory and runs *that*
app's gates. It passes: install, both inventory gates, build, and all 11
Playwright tests.
