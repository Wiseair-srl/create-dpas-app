# create-dpas-app

Scaffold a **Dual-Plane Agent Stack (DPAS)** application: an agentic device
operations dashboard where the assistant works through governed capabilities
— Agent Surface (`view:*`, browser), oRPC Agent (`domain:*`, server), an
application-owned Agent Host, Mastra, and assistant-ui.

```bash
pnpm create dpas-app my-agent-app
# npm create dpas-app@latest · yarn create dpas-app · bun create dpas-app
```

The generated app starts with **zero configuration** — press “Run guided
demo” for a deterministic end-to-end run of the golden scenario (filter →
select → confirm → disable → reconcile → inspect), no API key involved. Add
an Anthropic or OpenAI key later in `.env` for live chat.

Flags: `--yes`, `--package-manager <pnpm|npm|yarn|bun>`,
`--model-provider <demo|anthropic|openai>`, `--install/--no-install`,
`--git/--no-git`, `--example <name>`, `--help`, `--version`.

Full documentation, architecture guides, and the source of this scaffolder:
the repository README and `docs/` — plus the docs generated into every app.
