---
"create-dpas-app": patch
---

Move the template to `@agent-surface/*@^0.5.0`.

It was pinned at `^0.3.0`, and caret on a `0.x` range does not cross a minor —
so two releases of the library the template is built on had shipped without it
picking either up. 0.4.0 in particular fixed two meta-mode gaps this template
had reported: `surface_discover` now marks a refused scope with
`scopeRejected: {prefixes}`, so an empty payload is distinguishable from a
surface with nothing mounted, and all seven meta parameters carry descriptions.

0.5.0 removes the D28 compatibility flags rather than flipping them —
`AgentToolsetOptions.descriptionIncludesState`,
`RegistryOptions.snapshotMergesContextualNote`, and `stableDescriptionOf` are
gone, and the split composition is the only one. **No behavior change here**:
the template set both flags to `false` when D28 landed, so it was already on
what is now the sole path. The migration is deletion — five call sites and the
comments that explained why the flags were set. `stableDescriptionOf` was never
used.

The reason the flags mattered is unchanged and still load-bearing, so the
comments say it without naming a flag: tool definitions sit at the front of the
provider's cached prompt prefix, so anything volatile folded into `description`
invalidates the whole conversation behind it on every step. Availability and
contextual notes ride in `AgentTool.state` and
`AgentProcedureDescriptor.contextualNote`, and the host renders them after the
messages — which is what `catalog.ts` builds `frontendState` for. Hosts that
were on the *defaults* rather than the flags have real work to do at 0.5; this
one does not.

`@orpc-agent/*` was already at `^2.0.0`, which is current.
