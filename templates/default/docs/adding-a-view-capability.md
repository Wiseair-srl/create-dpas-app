# Adding a view capability

A `view:` capability is a semantic description of something the currently
mounted page can observe or do. It lives WITH the component that owns the
state — when the component unmounts, the capability is gone.

Worked example: let the agent read and toggle a "compact rows" preference on
the table.

## 1. Define the schemas

In [src/features/devices/capabilities/schemas.ts](../src/features/devices/capabilities/schemas.ts):

```ts
export const DensityStateSchema = z.object({
  compact: z.boolean(),
});
export const DensitySetSchema = z.object({
  compact: z.boolean().describe("true for compact rows, false for comfortable"),
});
```

Keep observations minimal: expose what an agent needs to plan with, not your
whole state tree.

## 2. Register with the owning component

Wherever the state lives (here, the table component), extend the existing
`useAgentComponent` call:

```tsx
useAgentComponent({
  type: "devices.table",
  description: "Table of devices matching the active filters",
  observations: {
    // ...existing observations
    readDensity: observation({
      description: "Current row density",
      output: zs(DensityStateSchema),
      read: () => ({ compact }),
    }),
  },
  actions: {
    // ...existing actions
    setDensity: action({
      description: "Switch between compact and comfortable rows",
      input: zs(DensitySetSchema),
      effect: "local-state",        // or "navigation" — nothing else exists
      idempotent: true,
      execute: ({ compact }) => setCompact(compact),
    }),
  },
});
```

That's the whole integration. The capability ids become
`view:devices.table.readDensity` / `view:devices.table.setDensity`; they join
the next turn's catalog automatically (the host snapshots the live surface
per step) and appear in the Inspector's catalog tab immediately.

Useful options you get for free:

- `when: () => boolean` + `unavailableReason` — the capability stays visible
  but unavailable, with a reason the model can act on ("state discloses");
- `precondition(input)` — reject semantically invalid input with details
  (see `selectRows` in
  [devices-table.tsx](../src/features/devices/components/devices-table.tsx));
- `confirmation: "required"` — for view actions worth a human pause;
- `policies: [...]` — e.g. `hasPermission(...)` to hide it from some
  identities entirely ("authority hides").

## 3. Test it — no LLM anywhere

In [src/features/devices/capabilities.test.tsx](../src/features/devices/capabilities.test.tsx):

```tsx
it("toggles density", async () => {
  const { surface } = await mount();
  expect(surface).toExpose("view:devices.table.setDensity");
  expect(await surface.invoke("view:devices.table.setDensity", { compact: true })).toBeOk();
  expect(await surface.observe("view:devices.table.readDensity")).toEqual({ compact: true });
});
```

Run `pnpm test`. The committed surface snapshot will change — review the diff
like any API change: it IS your agent-facing API.

## What NOT to do

- Don't expose `click`, `type`, `focus`, or element selectors. If you are
  reaching for those, the missing piece is a semantic capability.
- Don't fetch or mutate server data in a view action — that is the domain
  plane's job (see [adding-a-domain-capability.md](adding-a-domain-capability.md)).
- Don't register the same state from two components; one owner per capability.
