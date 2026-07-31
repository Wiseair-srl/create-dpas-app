import { describe, expect, it } from "vitest";
import {
  CATALOG_LIMITS,
  catalogTooLargeMessage,
  normalizeChatStep,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  ChatStepRequestSchema,
} from "./protocol";
import { resolveScope, scopeForRoute, SCOPES } from "./scope";

/**
 * W1 — scope resolution and protocol v2. Scope shapes DISCOVERY only; the
 * server treats a browser-supplied scope as a request and never widens it.
 */

describe("scope · route floor", () => {
  it("scopes the dashboard to its feature", () => {
    expect(scopeForRoute("/dashboard")).toEqual(["devices"]);
  });

  it("lets nested routes inherit their section", () => {
    expect(scopeForRoute("/dashboard/devices/d-mi-01")).toEqual(["devices"]);
  });

  it("leaves an unlisted route unscoped", () => {
    // Empty means "no narrowing", not "nothing" — scope is not authority, so
    // the fallback costs tokens rather than leaking anything.
    expect(scopeForRoute("/architecture")).toEqual([]);
    expect(scopeForRoute("/")).toEqual([]);
  });

  it("does not treat a prefix collision as a match", () => {
    // "/dashboard-admin" must not inherit "/dashboard".
    expect(scopeForRoute("/dashboard-admin")).toEqual([]);
  });
});

describe("scope · intersection with the browser request", () => {
  it("falls back to the floor when the browser asks for nothing", () => {
    expect(resolveScope("/dashboard", undefined)).toEqual(["devices"]);
    expect(resolveScope("/dashboard", [])).toEqual(["devices"]);
  });

  it("narrows to the intersection", () => {
    expect(resolveScope("/dashboard", ["devices"])).toEqual(["devices"]);
  });

  it("never widens beyond the route floor", () => {
    // An unscoped route stays unscoped however much the browser asks for.
    expect(resolveScope("/architecture", ["devices"])).toEqual([]);
  });

  it("falls back to the floor when the browser asks for a token this route lacks", () => {
    // A stale tab must not be able to blank the catalog.
    expect(resolveScope("/dashboard", ["billing"])).toEqual(["devices"]);
  });

  it("declares every token used by a route", () => {
    for (const token of scopeForRoute("/dashboard")) {
      expect(SCOPES).toContain(token);
    }
  });
});

describe("protocol · versions served side by side", () => {
  const v1 = {
    protocolVersion: 1,
    conversationId: "cnv",
    turnId: "trn",
    stepIndex: 0,
    messages: [{ role: "user" as const, content: "hi" }],
    frontendTools: [],
  };

  const v2 = {
    protocolVersion: 2,
    conversationId: "cnv",
    turnId: "trn",
    stepIndex: 0,
    pathname: "/dashboard",
    messages: [{ role: "user" as const, content: "hi" }],
    catalog: { mode: "direct" as const, scope: ["devices"], frontendTools: [] },
  };

  it("accepts both", () => {
    expect(ChatStepRequestSchema.safeParse(v1).success).toBe(true);
    expect(ChatStepRequestSchema.safeParse(v2).success).toBe(true);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([1, 2]);
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it("normalises v1 to an unscoped direct catalog", () => {
    const parsed = ChatStepRequestSchema.parse(v1);
    const step = normalizeChatStep(parsed);
    expect(step).toMatchObject({
      protocolVersion: 1,
      pathname: "",
      catalogMode: "direct",
      requestedScope: undefined,
    });
  });

  it("normalises v2 with its route and scope", () => {
    const parsed = ChatStepRequestSchema.parse(v2);
    const step = normalizeChatStep(parsed);
    expect(step).toMatchObject({
      protocolVersion: 2,
      pathname: "/dashboard",
      catalogMode: "direct",
      requestedScope: ["devices"],
    });
  });

  it("rejects a catalog over the frontend limit", () => {
    const tooMany = {
      ...v2,
      catalog: {
        mode: "direct" as const,
        frontendTools: Array.from({ length: CATALOG_LIMITS.maxFrontendTools + 1 }, (_, i) => ({
          wireName: `view_t${i}`,
          canonicalId: `view:t${i}`,
          plane: "view" as const,
          description: "d",
          inputSchema: { type: "object" },
          effect: "read",
          confirmation: "never" as const,
          available: true,
        })),
      },
    };
    expect(ChatStepRequestSchema.safeParse(tooMany).success).toBe(false);
  });

  it("names plane, count and limit when a catalog is too large", () => {
    const message = catalogTooLargeMessage("domain", 300, 128);
    expect(message).toContain("domain");
    expect(message).toContain("300");
    expect(message).toContain("128");
    // Never reports a legal-but-large catalog as malformed.
    expect(message.toLowerCase()).not.toContain("malformed");
  });
});
