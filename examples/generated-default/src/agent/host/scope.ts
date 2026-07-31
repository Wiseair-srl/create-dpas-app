/**
 * Route → capability scope (W1).
 *
 * Scope bounds what the model DISCOVERS on a given route. It is not an
 * authority boundary: `invoke` never consults it on either plane, and a
 * capability outside the requested scope stays fully invocable by an
 * authorized actor. Use exposure or a policy to make something unreachable.
 *
 * One token scopes both planes, because both already declare it at the
 * feature:
 *
 *   - **view** — matched against the component `type` as a prefix, so
 *     `"devices"` covers `devices.table`, `devices.filters`, `devices.drawer`;
 *   - **domain** — matched against `meta.tags`, so `"devices"` covers every
 *     procedure tagged for the feature.
 *
 * Feature modules own their own token; a route only says which features it
 * mounts. Restating the capability list here instead would duplicate knowledge
 * that already exists next to the code and drift from it.
 */

/** Every scope token this application defines. One per feature module. */
export const SCOPES = ["devices"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * The server-side floor. A browser-supplied scope is intersected with the
 * route's entry here and can only narrow it, never widen it — the browser is
 * asking, not deciding.
 */
const ROUTE_SCOPES: Record<string, readonly Scope[]> = {
  "/dashboard": ["devices"],
};

/**
 * Empty means UNSCOPED — the full catalog — not "nothing". That is the right
 * default because scope is not an authority boundary: a route with no entry
 * gets a catalog that costs more and selects less accurately, never one that
 * exposes something authority would have withheld. It also keeps protocol v1,
 * which has no route at all, working unchanged through the migration.
 */
const UNSCOPED: readonly Scope[] = [];

export function scopeForRoute(pathname: string): readonly Scope[] {
  const exact = ROUTE_SCOPES[pathname];
  if (exact) return exact;
  // Nested routes inherit their section: /dashboard/devices/d-1 is still the
  // dashboard. The trailing slash keeps /dashboard-admin from matching.
  for (const [route, scope] of Object.entries(ROUTE_SCOPES)) {
    if (pathname.startsWith(`${route}/`)) return scope;
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
 * useless assistant. Narrowing to nothing is not a thing a caller needs.
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
  return narrowed.length > 0 ? narrowed : floor;
}
