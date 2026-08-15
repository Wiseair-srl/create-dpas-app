# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security reports. Use GitHub's
private vulnerability reporting on this repository ("Security" → "Report a
vulnerability"). You will get an acknowledgement within a few days.

## Scope notes

- `create-dpas-app` runs locally at scaffold time; it never sends telemetry
  and never writes secrets (generated `.env` files contain provider selection
  only, with keys left commented).
- The generated application ships a **demo identity system** (signed local
  cookie, default secret). It is explicitly not production authentication and
  is documented as the seam to replace (`server/auth.ts` in generated apps).
- Security-relevant properties of the generated architecture (deny-by-default
  capability exposure, server re-authorization, server-side approvals for
  consequential operations, bound inputs removed from the advertised schema,
  one execution path per operation) are covered by deterministic tests;
  regressions there are treated as security bugs.

Vulnerabilities in the upstream capability providers belong to their own
trackers. See the SECURITY.md of
[`@agent-surface/core`](https://www.npmjs.com/package/@agent-surface/core) and
[`@orpc-agent/core`](https://www.npmjs.com/package/@orpc-agent/core)
(github.com/Wiseair-srl/orpc-agent).
