import {
  createAgentRuntime,
  createInMemoryApprovalCoordinator,
  defineGovernance,
  type Actor,
  type AuditSink,
} from "@orpc-agent/core";

import type { AppContext } from "../capabilities/base";
import { analystHidesWrites, gateModelWrites } from "../capabilities/policies";
import { registry } from "../capabilities/registry";
import { takeAuditFields } from "../capabilities/audit";
import type { SessionUser } from "./auth";
import { getAuditLog } from "./agent/audit-tap";

export function actorFor(user: SessionUser): Actor {
  return { id: user.email, kind: "user", displayName: user.name };
}

const TERMINAL = new Set(["capability.completed", "capability.failed", "capability.cancelled"]);

/**
 * Merge the human-readable target/summary (stashed per execution by the
 * `auditFields` middleware) into the terminal event. `capability.started`
 * passes through untouched, so the audit-before-effect guarantee is exactly
 * what the adapter documents.
 */
function decorateSink(sink: AuditSink): AuditSink {
  return (event) => {
    if (TERMINAL.has(event.type) && event.executionId) {
      const fields = takeAuditFields(event.executionId);
      if (fields && (fields.target || fields.summary)) {
        const decorated = { ...event, data: { ...event.data, ...fields } };
        return sink(decorated as unknown as typeof event);
      }
    }
    return sink(event);
  };
}

/**
 * The governed surface as one declared value: registry + runtime-level
 * policies. Module scope and exported on purpose — `orpc-agent inspect|check`
 * reads this WITHOUT building a runtime, so the inventory reports the policy
 * list the runtime actually evaluates rather than a hopeful copy of it.
 */
export const governance = defineGovernance({
  registry,
  policies: [gateModelWrites, analystHidesWrites],
});

/**
 * Approvals are in-memory here, which is the honest zero-config choice: they
 * live for the life of the process and a restart forgets the pending ones.
 * A deployment swaps in `createPgApprovalCoordinator({ query })` from
 * @orpc-agent/postgres and changes nothing else.
 *
 * `rejectSelfApproval` is off: this app is requester-confirmed by design — the
 * person who asked the agent to act is the person who clicks Approve.
 *
 * `strict: false` matches the in-memory sink. Strict mode guarantees
 * audit-before-effect, which is a promise only a durable sink can keep; a
 * finance deployment turns it on together with the Postgres sink.
 */
export const runtime = createAgentRuntime<AppContext>({
  governance,
  approvals: {
    coordinator: createInMemoryApprovalCoordinator(),
    rejectSelfApproval: false,
  },
  audit: { sinks: [decorateSink(getAuditLog().sink)], strict: false },
});
