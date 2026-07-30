// React 19 + @testing-library/react: mark this environment as act-capable so
// the agent-surface test harness can flush effects deterministically.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { matchers, type AgentSurfaceMatchers } from "@agent-surface/testing/matchers";
import { expect } from "vitest";

expect.extend(matchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T> extends AgentSurfaceMatchers<T> {}
}
