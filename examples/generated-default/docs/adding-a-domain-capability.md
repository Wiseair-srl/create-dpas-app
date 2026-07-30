# Adding a domain capability

A `domain:` capability is an oRPC procedure with agent metadata. The
procedure stays the single implementation for the UI, the agent, and tests;
the metadata declares — explicitly, deny-by-default — where agents may reach
it.

Worked example: let the model rename a device.

## 1. Write (or find) the procedure

In [src/server/orpc/procedures.ts](../src/server/orpc/procedures.ts):

```ts
export const renameDevice = operatorOnly
  .meta({
    agent: {
      description: "Rename a device. The new name must be unique.",
      expose: { aiSdk: true, test: true },   // deny-by-default: only what you list
      sideEffect: "write",                   // none | read | write | destructive | external
      risk: "medium",                        // low | medium | high | critical
    },
  })
  .errors({ NAME_TAKEN: { message: "That name is already in use." } })
  .input(z.object({ deviceId: z.string(), name: z.string().min(3).max(40) }))
  .output(DeviceSchema)
  .handler(({ input, context, errors }) => {
    // your middleware (authn, role) already ran — same as every other caller
    ...
  });
```

Then add it to the router in [router.ts](../src/server/orpc/router.ts). The
capability id is its router path: `devices.rename` → `domain:devices.rename`
→ wire name `domain_devices__rename`.

## 2. Decide the exposure — this is the architectural decision

- **`expose.aiSdk: true`** → a *direct server tool*: Mastra can call it inside
  the loop with model-chosen input. Right for operations that make sense with
  no page open (list, get, compute). The host adds it to every turn's catalog
  for authorized actors.
- **`expose.aiSdk: false` + a contextual reference** → the model reaches it
  only through the live UI, with bound input and confirmation. Right for
  mutations that must target exactly what the user is looking at. See
  [contextual-domain-actions.md](contextual-domain-actions.md).

Never both: the host rejects a catalog where one operation has two
model-visible paths (`CATALOG_COLLISION` — try it, the test in
[server-compose.test.ts](../src/agent/host/server-compose.test.ts) does).

## 3. Policies, if authority differs by actor

[src/server/agent/runtime.ts](../src/server/agent/runtime.ts) shows the
pattern: `viewer-hides-writes` HIDES write capabilities from non-operators at
discovery AND at invocation — for a viewer the capability does not exist,
which is exactly what a probing model should learn (nothing).

## 4. Test governance deterministically

In [src/server/domain.test.ts](../src/server/domain.test.ts), through
`@orpc-agent/testing` (no HTTP, no model):

```ts
it("renames for operators", async () => {
  const { runtime } = runtimeFor("operator");
  const result = await runtime.invoke("devices.rename", { deviceId: "d-mi-01", name: "duomo-alpha" });
  expect(result.status).toBe("completed");
});
```

Assert the failure branches too: viewer (hidden), invalid input
(`INPUT_INVALID` before your handler runs), domain errors (typed, sanitized).

## Things the pipeline already does for you

Every invocation — regardless of adapter — passes the same 15-stage pipeline:
exposure check, input validation, policy evaluation, execution under YOUR
middleware, output validation, redaction, audit. Errors reach the model in
exactly two shapes (a public code/message, or a generic `INTERNAL_ERROR`);
stack traces and internals never do.
