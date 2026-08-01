import { renderAgentSurface, type RenderedAgentSurface } from "@agent-surface/testing/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOST_CONSUMER } from "@/agent/host/identity";
import { createFixture, FixtureProviders } from "@/test/devices-fixture";
import { NavRail } from "./nav-rail";

/**
 * The navigation capability's settlement contract (D23, agent-surface
 * `docs/03` §lifecycle): a `navigation` action settles when the router COMMITS
 * the transition, not when `push` returns.
 *
 * This is not a nicety. The host loop projects the next catalog as soon as the
 * call settles, so an action that resolves on `push` reports success while the
 * destination is still unmounted — the agent navigates and is then told the
 * page it asked for has no capabilities.
 */

/** A router whose commit this test drives by hand, as Next's does eventually. */
const router = vi.hoisted(() => ({
  path: "/architecture",
  pushed: [] as string[],
  listeners: new Set<() => void>(),
}));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (onChange: () => void) => {
    router.listeners.add(onChange);
    return () => router.listeners.delete(onChange);
  };
  const read = () => router.path;
  return {
    usePathname: () => useSyncExternalStore(subscribe, read, read),
    useRouter: () => ({
      push: (path: string) => {
        router.pushed.push(path);
      },
    }),
  };
});

// The rail's links need only to render; App Router context is not the subject.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

let fixture: ReturnType<typeof createFixture> | undefined;
let surface: RenderedAgentSurface | undefined;

afterEach(() => {
  surface?.dispose();
  surface = undefined;
  fixture?.cleanup();
  fixture = undefined;
  router.path = "/architecture";
  router.pushed.length = 0;
  router.listeners.clear();
});

async function mount() {
  fixture = createFixture();
  surface = await renderAgentSurface(<NavRail />, {
    registry: fixture.registry,
    wrapper: ({ children }) => <FixtureProviders user={fixture!.user}>{children}</FixtureProviders>,
  });
  return surface;
}

/** What Next does when the transition lands. */
function commitRoute(path: string) {
  act(() => {
    router.path = path;
    for (const notify of [...router.listeners]) notify();
  });
}

/** Whether a promise has settled, without waiting on it. */
function settled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
}

describe("view:app.navigation.goTo · settles on commit", () => {
  it("stays in flight until the route actually changes", async () => {
    const rendered = await mount();

    const call = rendered.registry.invoke(
      { capabilityId: "view:app.navigation.goTo", input: { path: "/dashboard" } },
      { consumer: HOST_CONSUMER },
    );

    // The call has NOT reported success on the strength of `push` returning…
    expect(await settled(call)).toBe(false);
    // …though the push itself did happen.
    expect(router.pushed).toEqual(["/dashboard"]);

    commitRoute("/dashboard");

    const result = await call;
    expect(result.status).toBe("ok");
  });

  it("resolves at once when the app is already on that route", async () => {
    const rendered = await mount();

    const result = await rendered.registry.invoke(
      { capabilityId: "view:app.navigation.goTo", input: { path: "/architecture" } },
      { consumer: HOST_CONSUMER },
    );

    expect(result.status).toBe("ok");
    // Idempotent: no transition to wait for means no transition to start.
    expect(router.pushed).toEqual([]);
  });

  it("fails the call rather than hanging when the transition is abandoned", async () => {
    const rendered = await mount();

    const controller = new AbortController();
    const call = rendered.registry.invoke(
      { capabilityId: "view:app.navigation.goTo", input: { path: "/dashboard" } },
      { consumer: HOST_CONSUMER, signal: controller.signal },
    );
    expect(await settled(call)).toBe(false);

    // The user cancels the turn while the router is still in transit.
    controller.abort();

    const result = await call;
    expect(result.status).toBe("error");
    // Reported as cancelled, not as a failed navigation (D23).
    expect(result.status === "error" && result.error.code).toBe("CANCELLED");
  });
});
