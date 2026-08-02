/**
 * Route → capability scope.
 *
 * Scope bounds what the model DISCOVERS on a given route. It is not an
 * authority boundary: `invoke` never consults it on either plane, and a
 * capability outside the requested scope stays fully invocable by an
 * authorized actor. Use exposure or a policy to make something unreachable.
 *
 * One token scopes both planes, because both already declare it at the feature:
 *
 *   - **view** — matched against the component `type` as a PREFIX, so
 *     `"invoices"` covers `invoices.pending`, `invoices.all`, …;
 *   - **domain** — matched against `meta.tags`, so `"invoices"` covers every
 *     capability tagged for the vertical.
 *
 * This app is small enough that an unscoped catalog would fit. The map is here
 * anyway because it is the thing that stops being optional at thirty
 * capabilities, and a template that only shows you the easy case has not shown
 * you the mechanism.
 */

/**
 * Every scope token this application defines: one per capability vertical, plus
 * `app` for the shell.
 *
 * `app` is not a vertical. It covers what the shell registers on every screen —
 * `app.navigation`, `app.session` — which belongs to no feature and is as
 * relevant on one route as on another. Scope matches component type as a
 * prefix, so without a token of their own they fall outside every route entry
 * below, and a model on a scoped screen can neither see where it is nor move
 * anywhere else. It reports that as "I have no navigation tool", which is
 * accurate and exactly the wrong answer: navigating to the screen that has the
 * capability is the intended move.
 */
export const SCOPES = ["app", "invoices", "clients", "reporting", "collections"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * The server-side floor, keyed by the routes in app/nav-config.ts. A
 * browser-supplied scope is intersected with the route's entry here and can
 * only narrow it, never widen it — the browser is asking, not deciding.
 */
const ROUTE_SCOPES: Record<string, readonly Scope[]> = {
  // The collections working set: invoices, the ageing report behind the KPIs,
  // and `collections` because the chase dialog registers as
  // `collections.chase` — the view half matches on component-type PREFIX, so a
  // component named after itself rather than after its section is invisible
  // without a token of its own.
  "/receivables/pending": ["invoices", "reporting", "collections"],
  "/receivables/all": ["invoices", "reporting"],
  // The clients screen reads invoices too — "what does Aurora owe us" is a
  // question asked from here.
  "/receivables/clients": ["clients", "invoices"],
  "/architecture": ["app"],
};

/**
 * Empty means UNSCOPED — the full catalog — not "nothing". That is the right
 * default because scope is not an authority boundary: a route with no entry
 * gets a catalog that costs more and selects less accurately, never one that
 * exposes something authority would have withheld.
 */
const UNSCOPED: readonly Scope[] = [];

/** The shell's token. Rides along with every narrowed scope, never alone. */
const SHELL: Scope = "app";

function withShell(scope: readonly Scope[]): readonly Scope[] {
  return scope.includes(SHELL) ? scope : [SHELL, ...scope];
}

export function scopeForRoute(pathname: string): readonly Scope[] {
  const exact = ROUTE_SCOPES[pathname];
  if (exact) return withShell(exact);
  // Nested routes inherit their section. The trailing slash keeps
  // /receivables/pending-archive from matching /receivables/pending.
  for (const [route, scope] of Object.entries(ROUTE_SCOPES)) {
    if (pathname.startsWith(`${route}/`)) return withShell(scope);
  }
  return UNSCOPED;
}

/**
 * Intersect what the browser asked for with what the route allows. The result
 * can only narrow the floor, never widen it.
 *
 * An intersection that comes out empty falls back to the floor rather than to
 * nothing: the browser asking for a token this route does not have is a bug or
 * a stale tab, and blanking the catalog would turn that into a silently
 * useless assistant.
 */
export function resolveScope(
  pathname: string,
  requested: readonly string[] | undefined,
): readonly Scope[] {
  const floor = scopeForRoute(pathname);
  if (floor.length === 0) return UNSCOPED;
  if (!requested || requested.length === 0) return floor;
  const asked = new Set(requested);
  const narrowed = floor.filter((token) => asked.has(token));
  // The shell rides along even when the browser forgot to ask for it — a tab
  // running last deploy's token list must not talk itself out of navigation.
  return narrowed.length > 0 ? withShell(narrowed) : floor;
}
