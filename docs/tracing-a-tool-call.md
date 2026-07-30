# Tracing a tool call

The end-to-end trace walkthrough — every identifier, every timeline event,
and the file that emits it — ships with each generated app:

[templates/default/docs/tracing-a-tool-call.md](../templates/default/docs/tracing-a-tool-call.md)

To see it live from this repo:

```bash
pnpm dev            # templates/default on :3000
```

Run the guided demo, approve the confirmation, then open
**Assistant → Inspector → Timeline**. One `turnId` groups the whole run;
`toolCallId` doubles as the Agent Surface `invocationId` (transport retries
can never double-execute); the confirmation id links the approval to the
exact effective input; and the `domain / devices.disabled` audit record is
the authoritative end of the chain.
