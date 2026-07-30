---
"create-dpas-app": patch
---

Give DOM tests room to start up. They mount the real feature tree in jsdom;
the assertions take milliseconds, but standing up the environment on a cold
or busy machine can exceed vitest's 5s default and fail a passing test. The
generated app now sets an explicit 30s timeout for DOM tests and 20s for node
tests.
