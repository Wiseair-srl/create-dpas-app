import { matchers, type AgentSurfaceMatchers } from "@agent-surface/testing/matchers";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom setup for the surface contract tests.
 *
 * `@agent-surface/testing/matchers` adds `toExpose`, `toBeOk`, `toFailWith`
 * and friends — the vocabulary that lets a test talk to the surface the way an
 * agent does, rather than reaching into React internals.
 */

expect.extend(matchers);

// `Assertion`, not `Matchers`: vitest declares `Matchers` with its own type
// parameters, and re-declaring it with different ones is a merge conflict
// rather than an augmentation.
declare module "vitest" {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type --
     an empty extending interface IS the augmentation; there is nothing to add. */
  interface Assertion<T = any> extends AgentSurfaceMatchers<T> {}
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
}

afterEach(() => {
  cleanup();
});

// jsdom implements neither, and both are read on mount by the UI kit: the
// table measures its own width, and the dock asks whether the viewport is
// desktop-sized before deciding to render at all.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
