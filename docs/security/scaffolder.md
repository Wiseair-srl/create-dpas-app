# Scaffolder guarantees

> **This page:** what `create-dpas-app` itself promises, and which security-relevant properties of the generated app are pinned by tests rather than by prose. The generated app's own model is [Security model](model.md).

## The scaffolder

- **It writes no secrets.** A generated `.env` is a form to fill in: the chosen provider's key line is uncommented and empty, every other stays commented.
- **It makes no network calls and sends no telemetry.** The only network access at scaffold time is the package manager's install, which you can decline with `--no-install`.
- **It never overwrites.** A destination that exists and is non-empty is refused (`.git` and `.DS_Store` excepted). Generation happens in a temp directory and is moved into place only when complete, so a failed run leaves nothing behind.
- **It runs no shell.** Install and `git init` are direct process spawns with argument arrays, never a shell string.
- **Templating is name substitution.** The project name in `package.json` and `README.md`, plus `.env` creation. Nothing else is rewritten, so what you read in the template is what you get.

## What is tested, not asserted

These properties of the generated app are covered by deterministic tests, re-run on every generated project by the scaffold smoke gate. Regressions in them are treated as security bugs:

| Property | Where |
|---|---|
| Deny-by-default exposure per surface | `capabilities/governance.test.ts` |
| Authority hides: `CAPABILITY_NOT_FOUND`, not `FORBIDDEN` | `capabilities/governance.test.ts` |
| A gated call suspends, and the data does not move | `capabilities/governance.test.ts` |
| Rejecting an approval changes nothing | `capabilities/governance.test.ts` |
| The same call is ungated on the direct surface | `capabilities/governance.test.ts` |
| Bound fields removed from the advertised schema | `app/features/invoices/capabilities.test.tsx` |
| A hidden row cannot be selected by the agent | `app/features/invoices/capabilities.test.tsx` |
| No session ⇒ every capability hidden | `app/features/invoices/capabilities.test.tsx` |
| Role authority visible in the UI | `e2e/receivables.spec.ts` |
| Both planes execute, and the screen reconciles | `e2e/copilot.spec.ts` |

None of these tests needs a model provider or an API key. See [Testing without an LLM](../guides/testing.md).

## The demo identity is a demo

The generated app ships a server-signed session cookie with a **default secret** so it runs with zero configuration. It is not authentication: there is no login, and the header switcher re-signs a cookie for either demo user by design.

`server/auth.ts` is marked in the app's README as the seam to replace before any shared deployment, and it is the only authority for identity: role claims in request bodies or tool inputs are never read anywhere. See [Deploying](../guides/deploying.md) and [ADR-0007](../adr/0007-demo-identity-signed-cookie.md).

## Honest non-claims

- The stack does not claim a model cannot be manipulated. It bounds what manipulation can achieve; see the prompt-injection section of [Security model](model.md).
- A contextual binding is a *targeting* guarantee, not an authority one. It stops a model aiming an operation somewhere the user is not looking; it does not stop the operation. That is what approvals are for ([ADR-0010](../adr/0010-approvals-over-confirmations.md)).
- The embedded JSON store, the in-memory approval coordinator, the in-memory audit tap and the demo identity are zero-configuration conveniences. Each is documented as a seam rather than a solution, and the in-memory approval coordinator is why the template ships `strict: false`: audit-before-effect is a promise only a durable sink can keep.
- `/mcp` trusts the same demo cookie as the app. A deployment puts real authorization in front of it.

## Reporting

Please do not open a public issue for security reports. Use GitHub's private vulnerability reporting on the repository. Full policy: [Security policy](../project/security-policy.md).
