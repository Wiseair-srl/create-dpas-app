import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query, re-rendering when it starts/stops matching. Mirrors
 * {@link useReducedMotion}'s idiom (synchronous initial read so there's no
 * first-paint flicker, then a `change` listener). SSR-safe: the initial read is
 * guarded, so the server renders the non-matching branch.
 *
 * Use for layout that JS must branch on — e.g. swapping the desktop sidebar for
 * a drawer. Prefer plain Tailwind `lg:`/`sm:` classes whenever CSS alone can do
 * the job; reach for this only when a component's *behaviour* (not just styling)
 * differs by viewport.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True at the `lg` breakpoint (≥1024px) — the line where the app shell switches
 *  from the mobile drawer to the persistent two-rail desktop layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
