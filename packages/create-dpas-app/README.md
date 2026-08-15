# create-dpas-app

Scaffold a **Dual-Plane Agent Stack (DPAS)** application: an agentic
receivables console where the assistant works through governed capabilities:
Agent Surface (`view:*`, browser), oRPC Agent (`domain:*`, server), an
application-owned Agent Host, Mastra, and assistant-ui.

```bash
pnpm create dpas-app my-agent-app
# npm create dpas-app@latest · yarn create dpas-app · bun create dpas-app
```

The generated app starts with **zero configuration**: the ledger, the three
screens, the governed approval flow and the MCP endpoint all work on first run,
with no database and no key. Add an `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`
to `.env` when you want the docked copilot (⌘J) to think.

Flags: `--yes`, `--package-manager <pnpm|npm|yarn|bun>`,
`--model-provider <none|anthropic|openrouter>`, `--install/--no-install`,
`--git/--no-git`, `--example <name>`, `--help`, `--version`.

Full documentation, architecture guides, and the source of this scaffolder:
the repository README and `docs/`, plus the docs generated into every app.
