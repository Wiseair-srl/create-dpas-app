---
layout: home

hero:
  name: create-dpas-app
  text: Agentic apps that operate the product, not the DOM
  tagline: Scaffold a Dual-Plane Agent Stack application — semantic capabilities on both sides of the network, an agent host you own, confirmations bound to the exact input, and a test suite that never needs a model.
  image:
    src: /logo.svg
    alt: create-dpas-app
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: The dual-plane model
      link: /concepts/dual-plane
    - theme: alt
      text: Security and confirmation
      link: /security/model

features:
  - icon: 🚀
    title: One command, zero configuration
    details: One command produces a running device-operations dashboard. No API key, no database, no setup — the guided demo drives the real pipeline end to end.
    link: /getting-started
  - icon: 🪟
    title: Two planes, never blurred
    details: View capabilities are registered by the components that own the state and execute in the browser. Domain capabilities are oRPC procedures, governed and re-authorized on the server.
    link: /concepts/dual-plane
  - icon: 🎯
    title: One operation, one model-visible path
    details: A contextual reference narrows a domain operation to what the user is looking at — bound input, locked fields, live availability. It can never widen exposure, and duplicate paths are rejected per turn.
    link: /guides/contextual-domain-actions
  - icon: ✋
    title: Confirmation bound to the exact input
    details: Minted per invocation for the effective input after binding, single-use, expiring, digest-bound. Change the selection after approving and execution fails — no bait-and-switch.
    link: /security/model
  - icon: 🧭
    title: An agent host you own
    details: The browser↔server protocol, per-turn catalog composition, executor routing, correlation ids and run limits are application modules you can read and change — not framework glue.
    link: /reference/host-protocol
  - icon: 🧪
    title: Deterministic tests, no LLM
    details: Capability contracts, governance and the host are unit-tested; Playwright drives a production build through the live pipeline under a scripted model. CI never needs credentials.
    link: /guides/testing
---

> **Status:** the CLI is `create-dpas-app` on npm; the generated app is built on the published `@agent-surface/*` and `@orpc-agent/*` packages, Mastra, and assistant-ui. Everything on this site describes the app the scaffolder actually generates — the same markdown ships inside it.

**Start here:** [Getting started](getting-started.md) · **The idea in one page:** [The dual-plane model](concepts/dual-plane.md) · **The centerpiece pattern:** [Contextual domain actions](guides/contextual-domain-actions.md) · **Follow one call through every layer:** [Tracing a tool call](guides/tracing-a-tool-call.md)

```bash
pnpm create dpas-app my-agent-app
cd my-agent-app && pnpm dev
```

Open `http://localhost:3000`, press **Run guided demo**, and watch this run through the production pipeline with no model attached:

> *“Show me the offline devices in Milan, select the visible devices, and disable them.”*

Filters apply. Rows select. `domain:devices.disable` becomes available *only because rows are selected*. A confirmation card names the exact devices. On approval the server executes, the table reconciles from fresh data, and the Agent Inspector shows the correlated trace. Deny it and nothing happens — reported honestly.

## Documentation map

### Introduction

| Page | Answers |
|---|---|
| [Getting started](getting-started.md) | Scaffold, run, and read the guided demo |
| [The dual-plane model](concepts/dual-plane.md) | Why two planes, what each may decide, the invariants |
| [Anatomy of a capability](concepts/capabilities.md) | Ids, wire names, availability, binding, confirmation, lifecycle |
| [Architecture](concepts/architecture.md) | Why each layer of the generated app exists |

### Guides

| Page | Answers |
|---|---|
| [Adding a view capability](guides/adding-a-view-capability.md) | Register an observation or action with the component that owns the state |
| [Adding a domain capability](guides/adding-a-domain-capability.md) | An oRPC procedure with agent metadata, and the exposure decision |
| [Contextual domain actions](guides/contextual-domain-actions.md) | Bind a mutation to live UI state, lock it, confirm it |
| [Tracing a tool call](guides/tracing-a-tool-call.md) | Every identifier and timeline event, mapped to the code |
| [Connecting a model](guides/connecting-a-model.md) | Demo, live and mock modes; keys from `.env` or the UI |
| [Testing without an LLM](guides/testing.md) | Contract tests, governance tests, e2e under a scripted model |
| [Deploying](guides/deploying.md) | What to replace before anyone else uses it |

### Reference

[CLI](reference/cli.md) · [Project structure](reference/project-structure.md) · [Configuration](reference/configuration.md) · [Host protocol](reference/host-protocol.md) · [Error codes](reference/errors.md)

### Security

[Security and confirmation](security/model.md) · [Scaffolder guarantees](security/scaffolder.md)

### Project

[Repository and gates](project/repository.md) · [Decision records](project/decisions.md) · [Contributing](project/contributing.md)

## Reading paths

- **“Show me what this is.”** — [Getting started](getting-started.md) → [The dual-plane model](concepts/dual-plane.md) → [Tracing a tool call](guides/tracing-a-tool-call.md)
- **“I'm adding my own capabilities.”** — [Anatomy of a capability](concepts/capabilities.md) → [view](guides/adding-a-view-capability.md) → [domain](guides/adding-a-domain-capability.md) → [contextual](guides/contextual-domain-actions.md) → [testing](guides/testing.md)
- **“I'm reviewing its security.”** — [Security and confirmation](security/model.md) → [Scaffolder guarantees](security/scaffolder.md) → [Host protocol](reference/host-protocol.md) → [Decision records](project/decisions.md)
- **“I'm putting it in front of real users.”** — [Connecting a model](guides/connecting-a-model.md) → [Configuration](reference/configuration.md) → [Deploying](guides/deploying.md)
