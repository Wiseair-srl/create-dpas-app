"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setSurfaceSession, type SurfaceUser } from "@/agent/surface/registry";
import type { Role } from "@/server/auth/session";

/**
 * Client mirror of the server-resolved session. The browser only ever READS
 * identity from GET /api/auth/session; role switches go through POST
 * /api/auth/role, which re-signs the cookie server-side.
 */

interface SessionContextValue {
  session: SurfaceUser | null;
  isLoading: boolean;
  switching: boolean;
  setRole: (role: Role) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  /** Test/preview escape hatch: skip the fetch and use this session. */
  initialSession?: SurfaceUser;
}) {
  const [session, setSession] = useState<SurfaceUser | null>(() => {
    if (initialSession) setSurfaceSession(initialSession);
    return initialSession ?? null;
  });
  const [isLoading, setIsLoading] = useState(!initialSession);
  const [switching, setSwitching] = useState(false);

  const apply = useCallback((user: SurfaceUser | null) => {
    setSurfaceSession(user);
    setSession(user);
  }, []);

  useEffect(() => {
    if (initialSession) return;
    let cancelled = false;
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { userId: string; name: string; role: Role; permissions: string[] }) => {
        if (cancelled) return;
        apply({ id: data.userId, name: data.name, role: data.role, permissions: data.permissions });
      })
      .catch(() => {
        if (!cancelled) apply(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply, initialSession]);

  const setRole = useCallback(
    async (role: Role) => {
      setSwitching(true);
      try {
        const res = await fetch("/api/auth/role", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        });
        if (!res.ok) throw new Error(`Role switch failed (${res.status})`);
        const data = (await res.json()) as {
          userId: string;
          name: string;
          role: Role;
          permissions: string[];
        };
        apply({ id: data.userId, name: data.name, role: data.role, permissions: data.permissions });
      } finally {
        setSwitching(false);
      }
    },
    [apply],
  );

  const value = useMemo(
    () => ({ session, isLoading, switching, setRole }),
    [session, isLoading, switching, setRole],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
