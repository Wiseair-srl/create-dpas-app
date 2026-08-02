# ADR-0004 — Zero-configuration embedded data store: JSON file

**Status:** accepted · 2026-07-30

The directive requires a zero-configuration embedded store and forbids
requiring an external database for first start. Options considered:

- **better-sqlite3 / libsql** — real SQL, but native builds are the single most
  common `create-*` install failure (platform prebuilds, Node ABI drift).
- **In-memory only** — loses state across restarts; makes "the mutation
  persisted" unverifiable.
- **JSON file store** (chosen) — `server/db/` keeps the invoice ledger in memory,
  seeds deterministically on first run, and writes through to `.data/db.json`
  atomically. Zero native deps, zero config, survives restarts, resettable
  (`POST /api/demo/reset`), and completely transparent to a
  reader tracing a mutation.

The store is intentionally boring: the DPAS demonstration lives in the
capability planes, not the persistence layer. `docs/architecture.md` in the
generated app documents the swap path (the oRPC procedures are the only code
that touches the store).
