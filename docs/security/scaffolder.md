# Scaffolder guarantees

> **This page:** what `create-dpas-app` itself promises, and which security-relevant properties of the generated app are pinned by tests rather than by prose. The generated app's own model is [Security and confirmation](model.md).

## The scaffolder

- **It writes no secrets.** The generated `.env` selects a provider; every API key stays commented, with a pointer to where it goes.
- **It makes no network calls and sends no telemetry.** The only network access at scaffold time is the package manager's install, which you can decline with `--no-install`.
- **It never overwrites.** A destination that exists and is non-empty is refused (`.git` and `.DS_Store` excepted). Generation happens in a temp directory and is moved into place only when complete, so a failed run leaves nothing behind.
- **It runs no shell.** Install and `git init` are direct process spawns with argument arrays, never a shell string.
- **Templating is name substitution.** The project name in `package.json` and `README.md`, plus `.env` creation. Nothing else is rewritten, so what you read in the template is what you get.

## What is tested, not asserted

These properties of the generated app are covered by deterministic tests, re-run on every generated project by the scaffold smoke gate. Regressions in them are treated as security bugs:

| Property | Where |
|---|---|
| Deny-by-default exposure on both planes | `src/server/domain.test.ts`, `src/features/devices/capabilities.test.tsx` |
| Viewer/operator authority — hidden, not disabled | `capabilities.test.tsx`, `roles.spec.ts` |
| Bound fields locked against override | `capabilities.test.tsx` |
| Confirmation: approve · deny · expiry · **mismatch** | `capabilities.test.tsx` |
| One operation, one model-visible path | `src/agent/host/server-compose.test.ts` |
| Server re-authorization independent of the browser | `src/server/domain.test.ts` |
| Runtime model key: production guard, masking, never echoed | `src/server/model-config.test.ts`, `src/app/api/config/config-routes.test.ts` |

None of these tests needs a model provider or an API key — see [Testing without an LLM](../guides/testing.md).

## The demo identity is a demo

The generated app ships a server-signed session cookie with a **default secret** so it runs with zero configuration. It is not authentication: there is no login, and the header switcher re-signs a cookie for either demo user by design.

`src/server/auth/session.ts` is marked in the app's README and `SECURITY.md` as the seam to replace before any shared deployment, and it is the only authority for identity — role claims in request bodies or tool inputs are never read anywhere. See [Deploying](../guides/deploying.md) and [ADR-0007](../adr/0007-demo-identity-signed-cookie.md).

## Honest non-claims

- The stack does not claim a model cannot be manipulated. It bounds what manipulation can achieve — see the prompt-injection section of [Security and confirmation](model.md).
- Frontend confirmation is a safety and comprehension mechanism for the human at the page. It is **not** server authorization; the procedure's own middleware is.
- The embedded JSON store, the in-memory audit ring and the demo identity are zero-configuration conveniences, and each is documented as a seam rather than a solution.

## Reporting

Please do not open a public issue for security reports — use GitHub's private vulnerability reporting on the repository. Full policy: [Security policy](../project/security-policy.md).
