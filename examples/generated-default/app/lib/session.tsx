import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import type { SurfaceUser } from "@/agent/surface/registry";

/**
 * Who this tab is acting as, read from the server.
 *
 * The browser never asserts an identity — it asks `/api/session` and renders
 * what comes back. Switching the demo role POSTs a request and the server
 * re-signs the cookie; the browser's copy is a cache of a server decision,
 * which is why the switcher below refetches rather than setting state.
 */

export interface SessionInfo {
  user: SurfaceUser;
  models: string[];
  defaultModel: string;
}

const SessionContext = createContext<{
  session: SessionInfo | null;
  user: SurfaceUser | null;
  setRole: (role: "analyst" | "controller") => Promise<void>;
}>({ session: null, user: null, setRole: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionInfo> => {
      const response = await fetch("/api/session", { credentials: "include" });
      if (!response.ok) throw new Error("Could not read the session.");
      return response.json();
    },
    staleTime: Infinity,
  });

  const setRole = async (role: "analyst" | "controller") => {
    await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role }),
    });
    // Everything is refetched, not just the session: the catalog an analyst
    // sees is a different catalog, and a stale table beside a fresh identity is
    // the bug this line exists to prevent.
    await queryClient.invalidateQueries();
  };

  return (
    <SessionContext.Provider
      value={{ session: query.data ?? null, user: query.data?.user ?? null, setRole }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
