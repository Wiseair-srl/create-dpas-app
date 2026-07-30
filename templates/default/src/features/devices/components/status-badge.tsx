import { Badge } from "@/components/ui/badge";
import type { Device } from "@/features/devices/schemas/device";

/** Status communicated with text + color, never color alone. */
export function StatusBadge({ device }: { device: Pick<Device, "status" | "disabled"> }) {
  if (device.disabled) {
    return <Badge variant="neutral">Disabled</Badge>;
  }
  if (device.status === "online") {
    return <Badge variant="success">Online</Badge>;
  }
  return <Badge variant="warning">Offline</Badge>;
}
