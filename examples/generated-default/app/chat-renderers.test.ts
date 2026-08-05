import { describe, expect, it } from "vitest";

import { registry } from "../capabilities/registry";
import { rendererKey } from "./agent/host/wire-names";
import { CHAT_RENDERERS } from "./chat-renderers";

/**
 * A renderer keyed off the registry fails SILENTLY: tool-ui.tsx's rendererKey
 * lookup misses, the native card never draws, and the thread falls back to the
 * payload viewer with no error anywhere. The key is the bare capability id (the
 * registry key), not the `domain:`-prefixed wire name the tool pill shows.
 */
describe("chat renderers", () => {
  it("keys every renderer by a capability id in the registry", () => {
    const ids = registry.ids();
    for (const key of Object.keys(CHAT_RENDERERS)) {
      expect(ids).toContain(key);
    }
  });

  // Membership alone would still pass if the LOOKUP changed sides — a
  // rendererKey that stopped stripping `domain:` leaves every key valid and
  // every card dead. So resolve the canonical id the thread actually hands the
  // lookup — `domain:<id>` — back to the map.
  it("resolves a call on a rendered capability back to its renderer key", () => {
    for (const key of Object.keys(CHAT_RENDERERS)) {
      expect(rendererKey(`domain:${key}`)).toBe(key);
      expect(CHAT_RENDERERS[rendererKey(`domain:${key}`)]).toBeDefined();
    }
  });

  // The approval receipt reads its id from the approval record, which is the
  // bare registry key — no prefix to strip. Same map, second door.
  it("takes the approval receipt's bare capability id unchanged", () => {
    for (const key of Object.keys(CHAT_RENDERERS)) {
      expect(rendererKey(key)).toBe(key);
    }
  });
});
