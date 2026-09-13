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

## Existing projects and separate deployments

Install `create-dpas-app` and import `create-dpas-app/host`,
`create-dpas-app/host/mastra`, `create-dpas-app/host/postgres` or the browser-safe
`create-dpas-app/host/transport`. The kit composes remote governed capabilities
with live browser tools, persists invocation/approval correlation and supports
Mastra-owned memory with AI SDK 5/6. The package includes a runnable
`reference/distributed` example; see the repository distributed deployment guide.
