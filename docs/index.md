---
layout: home

hero:
  name: create-dpas-app
  text: Agentic apps that operate the product, not the DOM
  tagline: Scaffold a Dual-Plane Agent Stack application — semantic capabilities on both sides of the network, an agent host you own, server-side approvals for what matters, and a test suite that never needs a model.
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
      text: Security model
      link: /security/model

features:
  - icon: 🚀
    title: One command, zero configuration
    details: One command produces a running receivables console — ledger, three screens, a docked copilot, an approval flow and an MCP endpoint. No database, no API key, no setup.
    link: /getting-started
  - icon: 🪟
    title: Two planes, never blurred
    details: View capabilities are registered by the components that own the state and execute in the browser. Domain capabilities are oRPC procedures, governed and re-authorized on the server.
    link: /concepts/dual-plane
  - icon: 🎯
    title: Bind for context, gate for consequence
    details: A mutation that must target what the user sees is bound to it, with the field removed from the schema. One whose risk is what it does stays a governed tool behind a server-side approval. Picking the wrong shape is the expensive mistake.
    link: /adr/0010-approvals-over-confirmations
  - icon: 🧭
    title: An agent host you own
    details: The browser↔server protocol, per-request catalog composition, executor routing, correlation ids and run limits are application modules you can read and change — not framework glue.
    link: /reference/host-protocol
  - icon: 🔌
    title: One registry, several transports
    details: The same capabilities serve the UI over oRPC, the copilot through the host, and external clients over MCP. Nothing is re-declared, and `expose` decides what each one sees.
    link: /concepts/capabilities
  - icon: 🧪
    title: Deterministic tests, no LLM
    details: Governance and capability contracts are unit-tested; Playwright drives a production build through the live pipeline under a scripted model; a committed surface baseline is diffed like an API. CI never needs credentials.
    link: /guides/testing
---

> **Status:** the CLI is `create-dpas-app` on npm; the generated app is built on the published `@agent-surface/*` and `@orpc-agent/*` packages, Mastra, and assistant-ui. Everything on this site describes the app the scaffolder actually generates — the same markdown ships inside it.

**Start here:** [Getting started](getting-started.md) · **The idea in one page:** [The dual-plane model](concepts/dual-plane.md) · **The centerpiece decision:** [Approvals over confirmations](adr/0010-approvals-over-confirmations.md) · **How the layers fit:** [Architecture](concepts/architecture.md)

```bash
pnpm create dpas-app my-agent-app
cd my-agent-app && pnpm dev
```

Open `http://localhost:3000`. Filter, sort and hide columns — all URL-synced, so a narrowed view is shareable. Open a chase dialog and record a reminder. Switch identity in the header: as **Ada — analyst**, `issue-invoice` does not grey out, it *disappears*, and asking the server for it directly answers `Capability not found`.

Add a provider key, press ⌘J, and ask:

> *Which invoices are overdue, and by how much?*

The copilot reads the ageing ladder on the server, narrows the table in your browser, reads the rows back, and answers from what it read. The table moves because the agent called the same setter your toolbar calls — it has no privileged channel into the UI.

Then ask it to issue a draft. It will not: a model-initiated `issue-invoice` comes back as an approval card, and nothing moves until you decide.

## Documentation map

### Introduction

| Page | Answers |
|---|---|
| [Getting started](getting-started.md) | Scaffold, run, and find the load-bearing files |
| [The dual-plane model](concepts/dual-plane.md) | Why two planes, what each may decide, the invariants |
| [Anatomy of a capability](concepts/capabilities.md) | Ids, wire names, exposure, availability, binding, lifecycle |
| [Architecture](concepts/architecture.md) | Why each layer of the generated app exists |

### Guides

| Page | Answers |
|---|---|
| [Adding a capability](guides/adding-a-capability.md) | Domain, view, and contextual — and how to choose |
| [Connecting a model](guides/connecting-a-model.md) | Keys, allowlists, run limits, and what the model receives |
| [Testing without an LLM](guides/testing.md) | Governance tests, surface contracts, e2e, the baseline gate |
| [Deploying](guides/deploying.md) | The four seams to replace before anyone else uses it |

### Reference

[CLI](reference/cli.md) · [Project structure](reference/project-structure.md) · [Configuration](reference/configuration.md) · [Host protocol](reference/host-protocol.md) · [Error codes](reference/errors.md)

### Security

[Security model](security/model.md) · [Scaffolder guarantees](security/scaffolder.md)

### Project

[Repository and gates](project/repository.md) · [Decision records](project/decisions.md) · [Contributing](project/contributing.md)

## Reading paths

- **“Show me what this is.”** — [Getting started](getting-started.md) → [The dual-plane model](concepts/dual-plane.md) → [Architecture](concepts/architecture.md)
- **“I'm adding my own capabilities.”** — [Anatomy of a capability](concepts/capabilities.md) → [Adding a capability](guides/adding-a-capability.md) → [Testing](guides/testing.md)
- **“I'm reviewing its security.”** — [Security model](security/model.md) → [Scaffolder guarantees](security/scaffolder.md) → [Host protocol](reference/host-protocol.md) → [Decision records](project/decisions.md)
- **“I'm putting it in front of real users.”** — [Connecting a model](guides/connecting-a-model.md) → [Configuration](reference/configuration.md) → [Deploying](guides/deploying.md)
