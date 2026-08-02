import { IconEye, IconShieldCheck } from "@tabler/icons-react";

import { SelectField } from "./ui/select";
import { useSession } from "@/lib/session";

/**
 * The demo identity switcher.
 *
 * Selecting a role asks the SERVER to re-sign the session cookie — the browser
 * never asserts authority. Watch the copilot's catalog while switching: as an
 * analyst, `issue-invoice` does not become disabled, it disappears. Authority
 * hides; state discloses.
 */
export function RoleSwitcher() {
  const { user, setRole } = useSession();
  if (!user) return null;

  return (
    <div className="flex items-center gap-1.5">
      {user.role === "controller" ? (
        <IconShieldCheck className="size-4 text-primary" aria-hidden />
      ) : (
        <IconEye className="size-4 text-muted-foreground" aria-hidden />
      )}
      <SelectField
        ariaLabel="Demo identity"
        value={user.role}
        onValueChange={(value) => void setRole(value as "analyst" | "controller")}
        options={[
          { value: "controller", label: "Carla — controller" },
          { value: "analyst", label: "Ada — analyst" },
        ]}
      />
    </div>
  );
}
