import { describe, expect, it, vi } from "vitest";
import { createAuditLog, createRingBufferBackend, type AuditEntry } from "./log";

/**
 * W0 — tenant isolation and boundedness in the audit stream.
 *
 * The log is process-wide and every concurrent user writes to it. These are
 * the properties that stop one tenant's activity reaching another's Inspector,
 * asserted rather than reviewed.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("audit log · tenant isolation", () => {
  it("gives two concurrent actors only their own entries", async () => {
    const log = createAuditLog();
    const forA: AuditEntry[] = [];
    const forB: AuditEntry[] = [];

    // The predicate the chat route applies: disclose an entry only when it is
    // positively attributable to this session's actor.
    const onlyFor = (actorId: string, sink: AuditEntry[], stepId: string) => (e: AuditEntry) => {
      const mine = e.source === "host" ? e.stepId === stepId : e.actorId === actorId;
      if (mine) sink.push(e);
    };

    const subA = log.subscribe(onlyFor("user_a", forA, "step_a"));
    const subB = log.subscribe(onlyFor("user_b", forB, "step_b"));

    // Both actors drive turns simultaneously against the shared log.
    log.record({ source: "domain", type: "devices.disabled", actorId: "user_a" });
    log.record({ source: "domain", type: "devices.disabled", actorId: "user_b" });
    log.record({ source: "orpc-agent", type: "capabilities.discovered", actorId: "user_b" });
    log.record({ source: "host", type: "catalog.collision", actorId: "user_b", stepId: "step_b" });
    log.record({ source: "orpc-agent", type: "runtime.tick" }); // unattributable

    await flush();
    subA.close();
    subB.close();

    // The acceptance criterion: zero frames in A carrying B's activity.
    expect(forA.map((e) => e.type)).toEqual(["devices.disabled"]);
    expect(forA.every((e) => e.actorId === "user_a")).toBe(true);
    expect(forB.map((e) => e.type)).toEqual([
      "devices.disabled",
      "capabilities.discovered",
      "catalog.collision",
    ]);
    // The unattributable entry reached neither.
    expect([...forA, ...forB].some((e) => e.type === "runtime.tick")).toBe(false);
  });

  it("scopes host entries to their own step, not merely their actor", async () => {
    const log = createAuditLog();
    const received: AuditEntry[] = [];
    // Same actor, a different concurrent step — e.g. two tabs.
    const sub = log.subscribe((e) => {
      if (e.source === "host" ? e.stepId === "step_1" : e.actorId === "user_a") received.push(e);
    });

    log.record({ source: "host", type: "catalog.undecodable", actorId: "user_a", stepId: "step_1" });
    log.record({ source: "host", type: "catalog.undecodable", actorId: "user_a", stepId: "step_2" });

    await flush();
    sub.close();
    expect(received.map((e) => e.stepId)).toEqual(["step_1"]);
  });

  it("excludes unattributed entries from an actor-scoped read", () => {
    const log = createAuditLog();
    log.record({ source: "domain", type: "devices.enabled", actorId: "user_a" });
    log.record({ source: "orpc-agent", type: "runtime.started" }); // no actorId

    expect(log.entries({ actorId: "user_a" }).map((e) => e.type)).toEqual(["devices.enabled"]);
    // Unfiltered reads still see everything — that is the server's own view.
    expect(log.entries()).toHaveLength(2);
  });

  it("never returns another actor's entries from a scoped read", () => {
    const log = createAuditLog();
    log.record({ source: "domain", type: "devices.disabled", actorId: "user_a" });
    log.record({ source: "domain", type: "devices.disabled", actorId: "user_b" });

    const forB = log.entries({ actorId: "user_b" });
    expect(forB).toHaveLength(1);
    expect(forB[0]?.actorId).toBe("user_b");
  });
});

describe("audit log · bounded subscriber", () => {
  it("drops past the queue limit and counts what it dropped", async () => {
    const log = createAuditLog();
    const received: AuditEntry[] = [];
    const sub = log.subscribe((entry) => received.push(entry), { maxQueue: 3 });

    // Recorded in one synchronous burst, so nothing drains in between.
    for (let i = 0; i < 10; i++) {
      log.record({ source: "domain", type: `event_${i}`, actorId: "user_a" });
    }

    expect(sub.dropped()).toBe(7);
    await flush();
    expect(received).toHaveLength(3);
    sub.close();
  });

  it("does not let a throwing subscriber break the audited path", () => {
    const log = createAuditLog();
    const sub = log.subscribe(() => {
      throw new Error("inspector blew up");
    });

    expect(() => log.record({ source: "domain", type: "devices.reset", actorId: "u" })).not.toThrow();
    expect(log.entries()).toHaveLength(1);
    sub.close();
  });

  it("delivers queued entries on close instead of discarding them", () => {
    const log = createAuditLog();
    const received: AuditEntry[] = [];
    const sub = log.subscribe((entry) => received.push(entry));

    // Recorded and closed within the same tick — the microtask has not run.
    log.record({ source: "host", type: "step-start", actorId: "u" });
    sub.close();

    expect(received.map((e) => e.type)).toEqual(["step-start"]);
  });

  it("stops delivering once closed", async () => {
    const log = createAuditLog();
    const received: AuditEntry[] = [];
    const sub = log.subscribe((entry) => received.push(entry));
    sub.close();

    log.record({ source: "domain", type: "devices.enabled", actorId: "u" });
    await flush();
    expect(received).toEqual([]);
  });
});

describe("audit log · backend", () => {
  it("bounds the ring buffer and keeps the newest entries", () => {
    const log = createAuditLog(createRingBufferBackend(3));
    for (let i = 0; i < 6; i++) {
      log.record({ source: "domain", type: `event_${i}`, actorId: "u" });
    }

    expect(log.entries().map((e) => e.type)).toEqual(["event_3", "event_4", "event_5"]);
  });

  it("writes through to a custom backend", () => {
    const append = vi.fn();
    const log = createAuditLog({ append, recent: () => [] });
    log.record({ source: "host", type: "catalog.collision", actorId: "u", stepId: "step_1" });

    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      source: "host",
      type: "catalog.collision",
      stepId: "step_1",
    });
  });
});
