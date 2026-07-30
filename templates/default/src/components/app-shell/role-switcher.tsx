"use client";

import { ShieldCheck, Eye } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useSession } from "@/lib/session";
import type { Role } from "@/server/auth/session";

/**
 * Demo role switcher. Selecting a role asks the SERVER to re-sign the session
 * cookie — the browser never asserts authority. Watch the Agent Inspector
 * when switching: as a viewer, `domain:devices.disable` disappears entirely
 * (authority hides) instead of erroring.
 */
export function RoleSwitcher() {
  const { session, switching, setRole } = useSession();

  if (!session) return null;

  return (
    <div className="flex items-center gap-2">
      {session.role === "operator" ? (
        <ShieldCheck aria-hidden className="h-4 w-4 text-accent" />
      ) : (
        <Eye aria-hidden className="h-4 w-4 text-muted-foreground" />
      )}
      <Select
        ariaLabel="Demo identity"
        value={session.role}
        onValueChange={(value) => {
          void setRole(value as Role);
        }}
        options={[
          { value: "operator", label: "Olivia — operator" },
          { value: "viewer", label: "Vik — viewer" },
        ]}
        className={switching ? "opacity-60" : undefined}
      />
    </div>
  );
}
