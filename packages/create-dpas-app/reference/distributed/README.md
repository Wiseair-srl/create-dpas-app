# Three-runtime DPAS reference

Run `pnpm install`, then `pnpm dev`. Open `http://127.0.0.1:4310`.
Backend:4311, Mastra host:4312, browser/Vite:4310. No cloud/model credentials.

Try Read invoice, Pay invoice → Approve, Highlight in this tab. With processes
running, `pnpm test` checks the real remote and browser-session paths.

The backend creates a fresh governed runtime per request and owns approvals.
The host owns Mastra Memory, suspension and persisted call correlation. The
browser alone executes its live capabilities. The scripted model is deterministic;
the gateway, Mastra loop and Agent Surface adapters are real.

Development stores are in memory and auth is a fixed local credential. Ports bind
to loopback. Use application auth, Postgres approvals/invocation journal/audit,
`createPgHostCallStore` + `HOST_CALLS_DDL`, persistent Mastra storage and a run
ownership strategy before deployment. Pending UI calls need a shared
`SurfaceCallStore` if hosts can be replaced. The reference validates call receipts
and suspended continuations; it does not implement rolling-task run recovery.

Full guide: https://github.com/Wiseair-srl/create-dpas-app/blob/main/templates/default/docs/distributed.md
