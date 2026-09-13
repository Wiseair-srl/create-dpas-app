import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDomainHost,
  type HostCallRecord,
  type DomainOutcome,
  type RemoteDomainClient,
} from "./domain.js";
import { HOST_CALLS_DDL, createPgHostCallStore } from "./postgres.js";

const db = new PGlite();
const query = (sql: string, params: unknown[]) => db.query<Record<string, unknown>>(sql, params);
const store = () => createPgHostCallStore({ query });
const call = { sessionId: "user-1", runId: "run-1", toolCallId: "call-1" };
const record = (): HostCallRecord => ({
  ...call,
  invocationId: "invocation-1",
  capabilityId: "draft.edit",
  inputFingerprint: "input-1",
  revision: 0,
});

beforeEach(async () => {
  await db.exec(HOST_CALLS_DDL);
  await db.exec("TRUNCATE dpas_host_calls");
});
afterAll(async () => {
  await db.close();
});

describe("Postgres host call store", () => {
  it("arbitrates simultaneous reservations and survives store replacement", async () => {
    const [first, second] = await Promise.all([
      store().reserve(record()),
      store().reserve(record()),
    ]);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await store().get(call)).toEqual(record());
  });

  it("isolates identical run/tool IDs across authenticated sessions", async () => {
    await store().reserve(record());
    expect(await store().get({ ...call, sessionId: "user-2" })).toBeNull();
    expect((await store().reserve({ ...record(), sessionId: "user-2" })).created).toBe(true);
  });

  it("permits only one writer for a revision and never changes identity", async () => {
    await store().reserve(record());
    const next = {
      ...record(),
      revision: 1,
      outcome: { status: "completed" as const, output: "saved" },
    };
    expect(await store().compareAndSet({ ...next, inputFingerprint: "changed" }, 0)).toBe(false);
    expect(await store().compareAndSet({ ...next, invocationId: "changed" }, 0)).toBe(false);
    expect(await store().compareAndSet({ ...next, contractDigest: "changed" }, 0)).toBe(false);
    const results = await Promise.all([
      store().compareAndSet(next, 0),
      store().compareAndSet(next, 0),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await store().get(call)).toEqual(next);
    await expect(store().compareAndSet({ ...next, revision: 3 }, 1)).rejects.toThrow(/exactly one/);
  });

  it("round-trips typed results and object keys without JSON type loss", async () => {
    await store().reserve(record());
    const output = {
      date: new Date("2026-09-13T00:00:00Z"),
      number: 3n,
      absent: undefined,
      zero: -0,
      array: [undefined, null, { date: "literal" }],
      object: Object.fromEntries([["__proto__", { marker: true }]]),
    };
    await store().compareAndSet(
      { ...record(), revision: 1, outcome: { status: "completed", output } },
      0,
    );
    expect((await store().get(call))?.outcome?.output).toEqual(output);
    expect(Object.prototype).not.toHaveProperty("marker");
  });

  it("rejects unsupported outcomes before mutating the receipt", async () => {
    await store().reserve(record());
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const output of [new Error("private"), cyclic, NaN, new Map()]) {
      await expect(
        store().compareAndSet(
          { ...record(), revision: 1, outcome: { status: "completed", output } },
          0,
        ),
      ).rejects.toThrow();
    }
    expect((await store().get(call))?.revision).toBe(0);
  });

  it("requires parameterized identifiers and rejects invalid initial state", async () => {
    for (const table of ["x; DROP TABLE users", 'a"b', "a.b.c", "1bad", ""]) {
      expect(() => createPgHostCallStore({ query, table })).toThrow(/identifier/);
    }
    expect(() => createPgHostCallStore({ query, table: "agent.host_calls" })).not.toThrow();
    await expect(store().reserve({ ...record(), revision: 1 })).rejects.toThrow(/revision 0/);
    await expect(
      store().reserve({ ...record(), outcome: { status: "completed" } }),
    ).rejects.toThrow(/no outcome/);
  });

  it("reconstructs a host after a lost response without repeating a domain effect", async () => {
    let effects = 0;
    let receipt: DomainOutcome | undefined;
    const client: RemoteDomainClient = {
      async invoke(_id, _input, options) {
        effects++;
        receipt = {
          status: "completed",
          invocationId: options.invocationId,
          output: { version: 2 },
        };
        throw new Error("response connection lost after commit");
      },
      async getInvocation() {
        return receipt ? { outcome: receipt } : null;
      },
      async resumeApproval() {
        throw new Error("unused");
      },
    };
    const first = createDomainHost({ client, store: store() });
    expect(
      (await first.invoke({ ...call, capabilityId: "draft.edit", input: { draft: 1 } })).status,
    ).toBe("outcome-unknown");
    const replacement = createDomainHost({ client, store: store() });
    expect(
      await replacement.invoke({ ...call, capabilityId: "draft.edit", input: { draft: 1 } }),
    ).toEqual(receipt);
    expect(effects).toBe(1);
  });

  it("keeps an unresolved dispatch reserved across replacement", async () => {
    let attempts = 0;
    const client: RemoteDomainClient = {
      async invoke() {
        attempts++;
        throw new Error("unknown");
      },
      async getInvocation() {
        return null;
      },
      async resumeApproval() {
        throw new Error("unused");
      },
    };
    const invoke = () =>
      createDomainHost({ client, store: store() }).invoke({
        ...call,
        capabilityId: "draft.edit",
        input: {},
      });
    expect((await invoke()).status).toBe("outcome-unknown");
    expect((await invoke()).status).toBe("outcome-unknown");
    expect(attempts).toBe(1);
  });
});
