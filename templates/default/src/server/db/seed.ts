import type { Device } from "@/features/devices/schemas/device";

/**
 * Deterministic seed data. Offsets are fixed; timestamps are computed relative
 * to seed time so "last seen" reads naturally without any randomness that
 * would break snapshot-style tests.
 */

type SeedRow = [
  id: string,
  name: string,
  status: Device["status"],
  city: string,
  lastSeenMinutesAgo: number,
  firmwareVersion: string,
];

const ROWS: SeedRow[] = [
  ["d-mi-01", "milan-duomo-01", "online", "Milan", 2, "2.4.1"],
  ["d-mi-02", "milan-duomo-02", "online", "Milan", 5, "2.4.1"],
  ["d-mi-03", "milan-navigli-01", "offline", "Milan", 60 * 26, "2.3.9"],
  ["d-mi-04", "milan-isola-01", "online", "Milan", 1, "2.4.1"],
  ["d-mi-05", "milan-isola-02", "offline", "Milan", 60 * 4, "2.4.0"],
  ["d-mi-06", "milan-lambrate-01", "online", "Milan", 12, "2.4.1"],
  ["d-mi-07", "milan-bovisa-01", "offline", "Milan", 60 * 51, "2.2.7"],
  ["d-mi-08", "milan-citylife-01", "online", "Milan", 3, "2.4.1"],
  ["d-to-01", "turin-lingotto-01", "online", "Turin", 7, "2.4.1"],
  ["d-to-02", "turin-lingotto-02", "online", "Turin", 4, "2.4.1"],
  ["d-to-03", "turin-vanchiglia-01", "offline", "Turin", 60 * 9, "2.4.0"],
  ["d-to-04", "turin-crocetta-01", "online", "Turin", 9, "2.4.1"],
  ["d-to-05", "turin-aurora-01", "online", "Turin", 15, "2.3.9"],
  ["d-rm-01", "rome-testaccio-01", "online", "Rome", 6, "2.4.1"],
  ["d-rm-02", "rome-trastevere-01", "online", "Rome", 11, "2.4.1"],
  ["d-rm-03", "rome-esquilino-01", "offline", "Rome", 60 * 2, "2.4.1"],
  ["d-rm-04", "rome-ostiense-01", "online", "Rome", 8, "2.4.0"],
  ["d-rm-05", "rome-prati-01", "online", "Rome", 13, "2.4.1"],
  ["d-bo-01", "bologna-bolognina-01", "online", "Bologna", 10, "2.4.1"],
  ["d-bo-02", "bologna-saragozza-01", "offline", "Bologna", 60 * 30, "2.3.2"],
  ["d-bo-03", "bologna-santo-stefano-01", "online", "Bologna", 5, "2.4.1"],
  ["d-ge-01", "genoa-molo-01", "online", "Genoa", 4, "2.4.1"],
  ["d-ge-02", "genoa-castelletto-01", "online", "Genoa", 18, "2.4.0"],
  ["d-ge-03", "genoa-albaro-01", "offline", "Genoa", 60 * 14, "2.4.0"],
];

export function seedDevices(now: Date = new Date()): Device[] {
  return ROWS.map(([id, name, status, city, minutesAgo, firmwareVersion]) => ({
    id,
    name,
    status,
    city,
    lastSeenAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    firmwareVersion,
    disabled: false,
  }));
}
