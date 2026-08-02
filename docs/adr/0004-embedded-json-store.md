# ADR-0004 — Zero-configuration embedded data store: a JSON file

**Status:** accepted · 2026-07-30

## Context

The app has to run immediately after `create`, with no database to install and
no connection string to fill in — while still being honest that a mutation
*persisted*, because "the approval was decided and the ledger moved" is the
thing a reader is trying to verify. Options considered:

- **better-sqlite3 / libsql** — real SQL, but native builds are the single most
  common `create-*` install failure (platform prebuilds, Node ABI drift).
- **In-memory only** — zero install risk, but loses state across restarts, which
  makes exactly that verification impossible.

## Decision

A JSON file store. `server/db/` keeps the invoice ledger in memory, seeds
deterministically on first run, and writes through to `.data/db.json`
atomically. Zero native dependencies, zero configuration, survives restarts,
resettable (`POST /api/demo/reset`), and completely transparent to a reader
tracing a mutation.

## Consequences

- It is a single-process store, and will not survive serverless scale-out or
  multiple instances. [Deploying](../guides/deploying.md) names it as one of the
  four seams to replace.
- The capabilities call the store's exported functions and nothing else, so
  swapping in Postgres is a change to one file.
- The store is deliberately boring. What this template demonstrates lives in the
  capability planes, not in the persistence layer.
