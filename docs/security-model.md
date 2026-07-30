# Security model

The generated application's security model — trust boundaries, identity,
confirmation vs approval, prompt-injection containment — is documented where
its developers will read it:

[templates/default/docs/security-and-confirmation.md](../templates/default/docs/security-and-confirmation.md)

Repo-level commitments on top of that:

- **The scaffolder writes no secrets.** Generated `.env` files select a
  provider; API keys stay commented. No telemetry, no network calls at
  scaffold time (beyond the package manager the user invoked).
- **The security-relevant invariants are tested deterministically** in the
  template and re-verified on every generated app by the scaffold smoke test:
  deny-by-default exposure on both planes, viewer/operator authority,
  single-use + input-bound confirmation (approve / deny / expiry / mismatch),
  locked bindings, duplicate-path rejection, server re-authorization.
- **The demo identity is a demo.** A server-signed cookie with a default
  secret makes the app runnable with zero configuration; the generated README
  and `SECURITY.md` mark `src/server/auth/session.ts` as the seam for real
  authentication before any shared deployment.

Report vulnerabilities per [SECURITY.md](../SECURITY.md).
