# Contextual domain actions

Some backend operations should only be reachable through the live UI: the
user is looking at specific rows, and the operation must target exactly those
rows. That is a **contextual domain reference** — the most valuable pattern
in this stack, and the one `domain:devices.disable` demonstrates.

The rule it preserves: **one operation, one model-visible path.** A contextual
reference NARROWS domain exposure (binding, availability, confirmation); it
can never widen it — the server still re-authorizes everything.

## The three declarations

**1. The server procedure is not a direct model tool.**
[src/server/orpc/procedures.ts](../src/server/orpc/procedures.ts):

```ts
expose: { aiSdk: false, test: true },   // reachable contextually only
sideEffect: "destructive",
```

**2. The frontend manifest admits it — the exposure ceiling.**
[src/features/devices/domain/manifest.ts](../src/features/devices/domain/manifest.ts):

```ts
export const domainManifest: OrpcAgentManifest = {
  tools: {
    "devices.disable": {
      description: "Disable the given devices. Destructive: …",
      inputSchema: toJsonSchema(DisableDevicesInputSchema),
      effect: "destructive",
    },
  },
};
```

A component cannot reference a procedure the manifest does not list.

**3. The component that owns the state binds it.**
[src/features/devices/components/devices-table.tsx](../src/features/devices/components/devices-table.tsx):

```tsx
useAgentProcedure(getDomainRefs().devices.disable, {
  when: () => selectedIds.length > 0,
  unavailableReason: "Select at least one device first",
  bind: () => ({ deviceIds: selectedIds }),      // captured at EXECUTION time
  confirmation: "required",
  describe: () => `Currently bound to the ${selectedIds.length} selected device(s).`,
  policies: [hasPermission("devices:disable", ...)],
});
```

## What the model experiences

- The tool's advertised input schema has `deviceIds` REMOVED — bound keys are
  locked. Supplying one anyway returns
  `INVALID_INPUT { lockedFields: ["deviceIds"] }`: the model cannot aim the
  operation anywhere the user is not looking.
- With nothing selected: `CAPABILITY_NOT_AVAILABLE` with the reason string —
  planning fuel, not a dead end.
- On invoke: the binding evaluates against the LIVE selection, a confirmation
  is minted for that exact effective input, and the user decides. Approval
  evidence is single-use and input-bound; if the selection changed after
  approval, execution fails with `CONFIRMATION_INVALID { reason: "mismatch" }`.
- On approve: the call rides the app's authenticated oRPC client — the same
  transport as the toolbar button — carrying the invocation and confirmation
  ids as audit metadata. The server re-checks role and input as it would for
  any client.

## When to use which exposure

| Use a **direct tool** (`expose.aiSdk: true`) | Use a **contextual reference** |
|---|---|
| meaningful with no page open | only meaningful against live UI state |
| model-chosen input is fine | input must come from what the user sees |
| read or low-risk compute | mutations targeting selected/viewed entities |
| `domain:devices.list` | `domain:devices.disable` |

Declaring both for one operation is a configuration error the host rejects
per turn (`CATALOG_COLLISION`, HTTP 409) — see
[server-compose.ts](../src/agent/host/server-compose.ts).

## Tests to copy

[capabilities.test.tsx](../src/features/devices/capabilities.test.tsx) covers
the full contract: hidden for viewers, unavailable without selection, bound
execution with evidence, locked-field smuggling, denial, expiry, and the
bait-and-switch mismatch — all without a model.
