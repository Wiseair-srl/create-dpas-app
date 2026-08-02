import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import type { SortDirection, SortState } from "@/components/ui/table";

/**
 * URL-synced filter/search state. Each key maps to a query param so a filtered
 * view is bookmarkable, shareable, and survives a refresh. Values equal to the
 * provided default are omitted from the URL (clean links), and writes use
 * `replace` so typing/filtering doesn't spam browser history.
 *
 * Values are strings (the URL's native type); callers encode booleans as
 * "1"/"0", selects as their option value, dates as ISO strings, etc.
 *
 * ```ts
 * const { values, set } = useFilterState({ q: "", category: "all", type: "all" });
 * set("category", "personnel");        // ?category=personnel
 * values.q                             // current search text
 * ```
 */
export function useFilterState<T extends Record<string, string>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Freeze defaults on first render so memo/callback identities stay stable
  // even when the caller passes an inline object literal. `useState`'s initial
  // value rather than a ref: a ref read during render is exactly what
  // react-hooks/refs objects to, and the frozen value is state by nature —
  // it is read while rendering and never written.
  const [def] = useState(defaults);

  const values = useMemo(() => {
    const out = { ...def };
    for (const key of Object.keys(def) as (keyof T)[]) {
      const raw = searchParams.get(key as string);
      if (raw != null) out[key] = raw as T[keyof T];
    }
    return out;
  }, [searchParams, def]);

  const set = useCallback(
    (key: keyof T, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === "" || value === def[key]) next.delete(key as string);
          else next.set(key as string, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, def],
  );

  /**
   * Set several keys at once, in a single URL update. Use this instead of two
   * back-to-back `set` calls: react-router's functional `setSearchParams` reads
   * a ref that isn't refreshed between synchronous calls, so the second call's
   * `prev` is missing the first's change and the last write wins (silently
   * dropping the earlier key). The date-range picker hits exactly this with its
   * paired from/to update.
   */
  const setMany = useCallback(
    (patch: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of Object.keys(patch) as (keyof T)[]) {
            const value = patch[key];
            if (value === undefined) continue;
            if (value === "" || value === def[key]) next.delete(key as string);
            else next.set(key as string, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, def],
  );

  const reset = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of Object.keys(def)) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, def]);

  const isDefault = useMemo(
    () => (Object.keys(def) as (keyof T)[]).every((k) => values[k] === def[k]),
    [values, def],
  );

  return { values, set, setMany, reset, isDefault };
}

/**
 * URL-synced table sort, designed to plug into {@link useTableSort}'s controlled
 * mode. Encodes as `?<param>=<key>.<asc|desc>`; the default sort is omitted and
 * the explicit "unsorted" state is `?<param>=none`.
 *
 * ```ts
 * const sort = useUrlSort("sort", { key: "date", direction: "desc" });
 * const { sorted, getSortProps } = useTableSort(rows, accessors, undefined, sort);
 * ```
 */
export function useUrlSort(param: string, initial: SortState) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param);

  let sort: SortState | null;
  if (raw == null) sort = initial;
  else if (raw === "none") sort = null;
  else {
    const dot = raw.lastIndexOf(".");
    const key = dot > 0 ? raw.slice(0, dot) : "";
    const dir = dot > 0 ? raw.slice(dot + 1) : "";
    sort = key && (dir === "asc" || dir === "desc") ? { key, direction: dir as SortDirection } : initial;
  }

  const onSortChange = useCallback(
    (next: SortState | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next == null) params.set(param, "none");
          else if (next.key === initial.key && next.direction === initial.direction) params.delete(param);
          else params.set(param, `${next.key}.${next.direction}`);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, param, initial.key, initial.direction],
  );

  return { sort, onSortChange };
}
